import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { camerasCall } from '@/lib/camerasApi';

export default function SnapshotView({ cameraId }: { cameraId: string }) {
  const [img, setImg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const r = await camerasCall<{ url?: string }>({ action: 'snapshot', id: cameraId });
      if (!alive) return;
      if (r.url) {
        const pre = new Image();
        pre.onload = () => { if (alive) { setImg(r.url!); setError(null); } };
        pre.src = r.url;
      } else if (r.error) setError(r.error);
      timer = setTimeout(tick, 2000);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [cameraId]);

  return (
    <div className="relative h-full w-full bg-black">
      {img && <img src={img} alt="" className="absolute inset-0 h-full w-full object-contain" />}
      {!img && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm text-white">
            <Icon name="Loader2" size={16} className="animate-spin" /> Подключение к камере...
          </div>
        </div>
      )}
      {error && !img && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">{error}</div>
      )}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] text-white/70">
        Браузер не поддерживает видео H.265 — показываю снимки каждые 2 секунды
      </div>
    </div>
  );
}
