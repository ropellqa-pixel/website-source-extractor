import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { YuvCanvas } from '@/lib/hevc/yuvCanvas';

interface Props {
  src: string | null;
  loading?: boolean;
  error?: string | null;
  onFatal?: () => void;
  live?: boolean;
  onTime?: (sec: number) => void;
}

interface FrameMsg { type: 'frame'; w: number; h: number; cw: number; ch: number; y: Uint8Array; u: Uint8Array; v: Uint8Array; pace: number }

/**
 * Живое видео H.265 без поддержки кодека в браузере: декодирование в WebAssembly
 * в фоновом потоке, вывод на canvas. Работает во встроенном браузере АБИЗ и любом Chrome/Edge.
 */
export default function WasmHevcPlayer({ src, loading, error, onFatal, live = true, onTime }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [buffering, setBuffering] = useState(true);
  const fatalRef = useRef(onFatal);
  fatalRef.current = onFatal;
  const timeRef = useRef(onTime);
  timeRef.current = onTime;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !src) return;
    setBuffering(true);
    const painter = new YuvCanvas(canvas);
    const worker = new Worker(new URL('../../lib/hevc/hevcWorker.ts', import.meta.url), { type: 'classic' });
    const queue: FrameMsg[] = [];
    let raf = 0;
    let nextAt = 0;
    let stopped = false;
    let shown = 0;
    let played = 0;

    // Плавная подача кадров с частотой камеры; если накопилось много — догоняем, чтобы не отставать.
    const tick = (now: number) => {
      if (stopped) return;
      if (queue.length && now >= nextAt) {
        if (live) while (queue.length > 24) queue.shift();
        const f = queue.shift()!;
        painter.draw(f);
        shown++;
        if (!live) {
          worker.postMessage({ type: 'shown', n: 1 });
          played += f.pace / 1000;
          if (shown % 6 === 0) timeRef.current?.(played);
        }
        const speedUp = live && queue.length > 12 ? 0.6 : 1;
        nextAt = Math.max(now, nextAt) + f.pace * speedUp;
        if (nextAt < now - 500) nextAt = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    let lastFrame = Date.now();
    // Сторож: если кадров нет 15 секунд — переподключаемся со свежей ссылкой.
    const guard = window.setInterval(() => {
      if (live && Date.now() - lastFrame > 30000) { lastFrame = Date.now(); fatalRef.current?.(); }
    }, 3000);
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'frame') { lastFrame = Date.now(); queue.push(m as FrameMsg); }
      else if (m.type === 'playing') setBuffering(false);
      else if (m.type === 'error') fatalRef.current?.();
    };
    worker.onerror = () => fatalRef.current?.();
    worker.postMessage({ type: 'start', url: src, live, glueUrl: new URL('/hevc/hevc-decode.js', location.origin).href, wasmUrl: new URL('/hevc/hevc-decode.wasm', location.origin).href });

    return () => {
      stopped = true;
      clearInterval(guard);
      cancelAnimationFrame(raf);
      try { worker.postMessage({ type: 'stop' }); } catch { /* */ }
      setTimeout(() => worker.terminate(), 300);
    };
  }, [src, live]);

  return (
    <div className="relative h-full w-full bg-black">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-contain" />
      {(loading || (src && buffering)) && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm text-white">
            <Icon name="Loader2" size={16} className="animate-spin" /> Подключение к камере...
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-sm rounded-2xl bg-black/70 px-5 py-4 text-center text-sm text-white">
            <Icon name="VideoOff" size={28} className="mx-auto mb-2 opacity-70" />
            {error}
          </div>
        </div>
      )}
    </div>
  );
}
