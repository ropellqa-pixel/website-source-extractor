import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import Icon from '@/components/ui/icon';

interface Props {
  src: string | null;
  loading?: boolean;
  error?: string | null;
  fallbackImage?: string | null;
  muted?: boolean;
  onFatal?: () => void;
  onTime?: (sec: number) => void;
}

export default function HlsPlayer({ src, loading, error, fallbackImage, muted = true, onFatal, onTime }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [buffering, setBuffering] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    setBuffering(true);
    let hls: Hls | null = null;
    let retries = 0;

    if (Hls.isSupported()) {
      hls = new Hls({ liveSyncDurationCount: 2, lowLatencyMode: true, manifestLoadingMaxRetry: 6, manifestLoadingRetryDelay: 1500 });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => { /* */ }); });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && retries < 2) { retries++; hls?.recoverMediaError(); return; }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retries < 3) { retries++; setTimeout(() => hls?.startLoad(), 1500); return; }
        onFatal?.();
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.play().catch(() => { /* */ });
    }
    return () => { hls?.destroy(); video.removeAttribute('src'); video.load(); };
  }, [src, onFatal]);

  return (
    <div className="relative h-full w-full bg-black">
      {fallbackImage && !src && (
        <img src={fallbackImage} alt="" className="absolute inset-0 h-full w-full object-contain" />
      )}
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-contain"
        muted={muted}
        playsInline
        autoPlay
        onPlaying={() => setBuffering(false)}
        onWaiting={() => setBuffering(true)}
        onTimeUpdate={(e) => onTime?.(e.currentTarget.currentTime)}
      />
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
