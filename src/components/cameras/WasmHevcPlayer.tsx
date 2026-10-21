import { useEffect, useRef, useState } from 'react';
import StreamOverlay from '@/components/cameras/StreamOverlay';
import { YuvCanvas } from '@/lib/hevc/yuvCanvas';
import { useStreamState } from '@/lib/camStream';

interface Props {
  src: string | null;
  epoch?: number;
  loading?: boolean;
  error?: string | null;
  poster?: string | null;
  onFatal?: () => void;
  onUnsupported?: () => void;
  live?: boolean;
  onTime?: (sec: number) => void;
}

const DIAG: number[] | null = typeof location !== 'undefined' && location.search.includes('camdiag')
  ? ((window as unknown as { __camDraws: number[] }).__camDraws = []) : null;

interface FrameMsg { type: 'frame'; w: number; h: number; cw: number; ch: number; y: Uint8Array; u: Uint8Array; v: Uint8Array; pace: number }

const raf: (cb: FrameRequestCallback) => number = typeof requestAnimationFrame === 'function'
  ? (cb) => requestAnimationFrame(cb)
  : (cb) => window.setTimeout(() => cb(performance.now()), 16);
const caf: (id: number) => void = typeof cancelAnimationFrame === 'function'
  ? (id) => cancelAnimationFrame(id)
  : (id) => clearTimeout(id);

export default function WasmHevcPlayer({ src, epoch = 0, error, poster, onFatal, onUnsupported, live = true, onTime }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painterRef = useRef<YuvCanvas | null>(null);
  const [painted, setPainted] = useState(false);
  const { hasFrame, stalled, progress, touch } = useStreamState();
  const fatalRef = useRef(onFatal);
  fatalRef.current = onFatal;
  const unsupRef = useRef(onUnsupported);
  unsupRef.current = onUnsupported;
  const timeRef = useRef(onTime);
  timeRef.current = onTime;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !src) return;
    let painter = painterRef.current;
    if (!painter) {
      try { painter = new YuvCanvas(canvas); } catch { painter = null; }
      if (!painter || !painter.ok) { unsupRef.current?.(); return; }
      painterRef.current = painter;
    }
    const p = painter;
    let worker: Worker;
    try {
      worker = new Worker(new URL('../../lib/hevc/hevcWorker.ts', import.meta.url), { type: 'classic' });
    } catch {
      unsupRef.current?.();
      return;
    }
    touch();
    const queue: FrameMsg[] = [];
    let rafId = 0;
    let nextAt = 0;
    let stopped = false;
    let shown = 0;
    let played = 0;
    let waiting = true;
    let waitStart = 0;

    const paint = (f: FrameMsg) => {
      try { p.draw(f); } catch { return; }
      if (shown === 0) setPainted(true);
      progress();
    };

    const tick = (now: number) => {
      if (stopped) return;
      const pace = queue.length ? queue[0].pace : 83;
      const bufferedMs = queue.length * pace;
      if (waiting && !waitStart && queue.length) waitStart = now;
      if (waiting) {
        if (shown === 0 && queue.length) { paint(queue[0]); shown = 1; }
        if (bufferedMs >= 2000 || (!live && queue.length > 0) || (waitStart && now - waitStart > 2000 && queue.length > 0)) { waiting = false; nextAt = now; }
      }
      if (!waiting && queue.length && now >= nextAt) {
        const f = queue.shift()!;
        paint(f);
        shown++;
        if (DIAG) DIAG.push(now);
        if (!live) {
          worker.postMessage({ type: 'shown', n: 1 });
          played += f.pace / 1000;
          if (shown % 6 === 0) timeRef.current?.(played);
        }
        let k = 1;
        if (live) {
          const left = queue.length * f.pace;
          if (left > 8000) k = 0.85;
          else if (left > 5000) k = 0.95;
          else if (left < 1500) k = 1.25;
          else if (left < 3000) k = 1.1;
        }
        nextAt = Math.max(nextAt + f.pace * k, now - 100);
      }
      if (!waiting && live && queue.length === 0) { waiting = true; waitStart = 0; }
      if (live && queue.length > 400) queue.splice(0, queue.length - 120);
      rafId = raf(tick);
    };
    rafId = raf(tick);

    let lastFrame = Date.now();
    let gotAny = false;
    const guard = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) { lastFrame = Date.now(); return; }
      if (live && Date.now() - lastFrame > 30000) { lastFrame = Date.now(); fatalRef.current?.(); }
    }, 3000);
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'frame') { lastFrame = Date.now(); gotAny = true; touch(); queue.push(m as FrameMsg); }
      else if (m.type === 'unsupported') unsupRef.current?.();
      else if (m.type === 'error') fatalRef.current?.();
    };
    worker.onerror = (ev) => {
      ev.preventDefault?.();
      if (!gotAny) unsupRef.current?.();
      else fatalRef.current?.();
    };
    worker.postMessage({ type: 'start', url: src, live, glueUrl: new URL('/hevc/hevc-decode.js', location.origin).href, wasmUrl: new URL('/hevc/hevc-decode.wasm', location.origin).href });

    return () => {
      stopped = true;
      clearInterval(guard);
      caf(rafId);
      try { worker.postMessage({ type: 'stop' }); } catch { /* */ }
      setTimeout(() => worker.terminate(), 300);
    };
  }, [src, epoch, live, progress, touch]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {!painted && poster && (
        <img src={poster} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none object-contain" />
      )}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full object-contain"
        style={{ opacity: painted ? 1 : 0 }}
      />
      <StreamOverlay hasFrame={hasFrame} stalled={stalled} error={error} poster={!painted && !!poster} />
    </div>
  );
}
