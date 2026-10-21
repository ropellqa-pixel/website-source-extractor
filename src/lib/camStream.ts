import { useCallback, useEffect, useRef, useState } from 'react';
import { camerasCall } from '@/lib/camerasApi';

export const STALL_MS = 5000;

export function useStreamState() {
  const [hasFrame, setHasFrame] = useState(false);
  const [stalled, setStalled] = useState(false);
  const lastRef = useRef(Date.now());
  const frameRef = useRef(false);

  useEffect(() => {
    const t = window.setInterval(() => {
      const s = frameRef.current && !document.hidden && Date.now() - lastRef.current > STALL_MS;
      setStalled((p) => (p === s ? p : s));
    }, 1000);
    const onVis = () => { lastRef.current = Date.now(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const progress = useCallback(() => {
    lastRef.current = Date.now();
    if (!frameRef.current) { frameRef.current = true; setHasFrame(true); }
  }, []);
  const touch = useCallback(() => { lastRef.current = Date.now(); }, []);
  const idleMs = useCallback(() => (document.hidden ? 0 : Date.now() - lastRef.current), []);

  return { hasFrame, stalled, progress, touch, idleMs };
}

export function preloadImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') { resolve(false); return; }
    const img = new Image();
    let done = false;
    const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
    img.onload = () => {
      if (typeof img.decode === 'function') img.decode().then(() => finish(true), () => finish(true));
      else finish(true);
    };
    img.onerror = () => finish(false);
    img.src = url;
    setTimeout(() => finish(false), 10000);
  });
}

const lastShot = new Map<string, string>();

export async function fetchSnapshot(cameraId: string): Promise<{ url?: string; error?: string }> {
  const r = await camerasCall<{ url?: string }>({ action: 'snapshot', id: cameraId });
  if (!r.url) return { error: r.error || 'Нет снимка' };
  const ok = await preloadImage(r.url);
  if (!ok) return { error: 'Снимок не загрузился' };
  lastShot.set(cameraId, r.url);
  return { url: r.url };
}

export function useCamSnapshot(cameraId: string | null | undefined, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(() => (cameraId ? lastShot.get(cameraId) || null : null));

  useEffect(() => {
    setUrl(cameraId ? lastShot.get(cameraId) || null : null);
    if (!cameraId || !enabled) return;
    let alive = true;
    fetchSnapshot(cameraId).then((r) => { if (alive && r.url) setUrl(r.url); });
    return () => { alive = false; };
  }, [cameraId, enabled]);

  return url;
}
