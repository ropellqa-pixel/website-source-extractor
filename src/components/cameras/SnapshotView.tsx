import { useEffect, useState } from 'react';
import StreamOverlay from '@/components/cameras/StreamOverlay';
import { fetchSnapshot, useStreamState } from '@/lib/camStream';

interface Props {
  cameraId: string;
  poster?: string | null;
  note?: boolean;
}

export default function SnapshotView({ cameraId, poster, note = true }: Props) {
  const [frames, setFrames] = useState<string[]>(() => (poster ? [poster] : []));
  const [error, setError] = useState<string | null>(null);
  const { hasFrame, stalled, progress } = useStreamState();

  useEffect(() => {
    if (poster) progress();
  }, [poster, progress]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) { timer = setTimeout(tick, 1000); return; }
      const r = await fetchSnapshot(cameraId);
      if (!alive) return;
      if (r.url) {
        const url = r.url;
        setFrames((f) => (f[f.length - 1] === url ? f : [...f.slice(-1), url]));
        setError(null);
        progress();
      } else if (r.error) setError(r.error);
      timer = setTimeout(tick, r.url ? 1000 : 2500);
    };
    tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [cameraId, progress]);

  const top = frames[frames.length - 1];

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {frames.map((u) => (
        <img
          key={u}
          src={u}
          alt=""
          draggable={false}
          onLoad={u === top ? () => setFrames((f) => (f.length > 1 && f[f.length - 1] === u ? [u] : f)) : undefined}
          className="absolute inset-0 h-full w-full select-none object-contain"
        />
      ))}
      <StreamOverlay hasFrame={hasFrame} stalled={stalled} error={error} />
      {note && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 max-w-[90%] -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-center text-[11px] text-white/70">
          Браузер не поддерживает видео H.265 — показываю снимки каждую секунду
        </div>
      )}
    </div>
  );
}
