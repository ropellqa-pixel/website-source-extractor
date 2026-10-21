import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import WasmHevcPlayer from '@/components/cameras/WasmHevcPlayer';
import HlsPlayer from '@/components/cameras/HlsPlayer';
import SnapshotView from '@/components/cameras/SnapshotView';
import { camerasCall, type Camera } from '@/lib/camerasApi';
import { detectEngine, downgradeEngine, type CamEngine } from '@/lib/hevc/engine';
import { useCamSnapshot } from '@/lib/camStream';

/**
 * Полноэкранный просмотр одной камеры для программы АБИЗ на экране входа (без входа на сайт).
 * Программа передаёт токен ПК в адресе (#t=...), страница сразу убирает его из адреса.
 * Параметр name — начало названия камеры (например «Зал»).
 */
export default function CamView() {
  const [params] = useSearchParams();
  const [cam, setCam] = useState<Camera | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [fresh, setFresh] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [engine, setEngine] = useState<CamEngine>(() => detectEngine(true));
  const poster = useCamSnapshot(cam?.id, true);

  useEffect(() => {
    const m = /[#&]t=([^&]+)/.exec(location.hash);
    if (m) {
      try { sessionStorage.setItem('abiz_device_token', decodeURIComponent(m[1])); } catch { /* */ }
      history.replaceState(null, '', location.pathname + location.search);
    }
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const prefix = (params.get('name') || '').toLowerCase();
    camerasCall<{ cameras?: Camera[] }>({ action: 'list' }).then((r) => {
      const list = r.cameras || [];
      const found = list.find(c => c.name.toLowerCase().startsWith(prefix)) || list.find(c => c.is_default) || list[0];
      if (!found) { setError(r.error || 'Камеры не найдены'); return; }
      setCam(found);
    });
  }, [params]);

  useEffect(() => {
    if (!cam) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    camerasCall<{ url?: string; error?: string }>({ action: 'live', id: cam.id, quality: 'sd', fresh: fresh > 0 }).then((r) => {
      if (cancelled) return;
      if (r.url) { setSrc(r.url); setEpoch((e) => e + 1); setError(null); }
      else { setError(r.error || 'Камера недоступна'); retry = setTimeout(() => setFresh(f => f + 1), 4000); }
    });
    return () => { cancelled = true; if (retry) clearTimeout(retry); };
  }, [cam, fresh]);

  const onFatal = useCallback(() => setFresh(f => f + 1), []);
  const onUnsupported = useCallback(() => setEngine((e) => (e === 'snapshot' ? e : downgradeEngine(e))), []);

  return (
    <div className="fixed inset-0 bg-black text-white">
      {engine === 'wasm' ? (
        <WasmHevcPlayer key={`w-${cam?.id}`} src={src} epoch={epoch} error={error} poster={poster} onFatal={onFatal} onUnsupported={onUnsupported} />
      ) : engine === 'native' ? (
        <HlsPlayer key={`n-${cam?.id}`} src={src} epoch={epoch} error={error} poster={poster} onFatal={onFatal} onUnsupported={onUnsupported} />
      ) : cam ? (
        <SnapshotView key={`s-${cam.id}`} cameraId={cam.id} poster={poster} note={false} />
      ) : null}
      <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-3 rounded-xl bg-black/60 px-3 py-1.5">
        <span className="text-lg font-semibold">{cam?.name || 'Камера'}</span>
        <span className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold">LIVE</span>
      </div>
      <div className="pointer-events-none absolute right-4 top-4 text-lg font-semibold text-white/85">
        {clock.toLocaleTimeString('ru-RU')}
      </div>
    </div>
  );
}
