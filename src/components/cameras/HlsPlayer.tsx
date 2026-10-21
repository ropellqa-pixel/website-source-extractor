import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import StreamOverlay from '@/components/cameras/StreamOverlay';
import { useStreamState } from '@/lib/camStream';

interface Props {
  src: string | null;
  epoch?: number;
  loading?: boolean;
  error?: string | null;
  poster?: string | null;
  muted?: boolean;
  live?: boolean;
  onFatal?: () => void;
  onUnsupported?: () => void;
  onTime?: (sec: number) => void;
}

function hlsJsOk(): boolean {
  try { return Hls.isSupported(); } catch { return false; }
}

function nativeHls(video: HTMLVideoElement): boolean {
  try { return !!video.canPlayType('application/vnd.apple.mpegurl'); } catch { return false; }
}

export default function HlsPlayer({ src, epoch = 0, error, poster, muted = true, live = true, onFatal, onUnsupported, onTime }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const freezeRef = useRef<HTMLCanvasElement>(null);
  const [frozen, setFrozen] = useState(false);
  const [needTap, setNeedTap] = useState(false);
  const { hasFrame, stalled, progress, touch, idleMs } = useStreamState();
  const fatalRef = useRef(onFatal);
  fatalRef.current = onFatal;
  const unsupRef = useRef(onUnsupported);
  unsupRef.current = onUnsupported;
  const timeRef = useRef(onTime);
  timeRef.current = onTime;
  const needTapRef = useRef(needTap);
  needTapRef.current = needTap;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    const freezeCanvas = freezeRef.current;
    let hls: Hls | null = null;
    let retries = 0;
    let disposed = false;
    let lastT = -1;
    let gotFrame = false;
    touch();

    const tryPlay = () => {
      const p = video.play();
      if (p && typeof p.then === 'function') {
        p.then(() => setNeedTap(false)).catch((e: unknown) => {
          if (disposed) return;
          if (e && typeof e === 'object' && (e as { name?: string }).name === 'NotAllowedError') setNeedTap(true);
        });
      }
    };

    const onFrame = () => {
      if (disposed) return;
      if (!gotFrame) { gotFrame = true; setFrozen(false); }
      progress();
    };
    const onTimeUpd = () => {
      if (video.currentTime !== lastT) { lastT = video.currentTime; onFrame(); }
      timeRef.current?.(video.currentTime);
    };
    const onErr = () => {
      if (disposed || hls) return;
      const code = video.error?.code;
      if (!gotFrame && (code === 3 || code === 4)) unsupRef.current?.();
      else fatalRef.current?.();
    };
    let frags = 0;
    const started = Date.now();
    video.addEventListener('timeupdate', onTimeUpd);
    video.addEventListener('loadeddata', onFrame);
    video.addEventListener('error', onErr);

    if (hlsJsOk()) {
      hls = new Hls({
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
        maxLiveSyncPlaybackRate: 1.1,
        lowLatencyMode: false,
        backBufferLength: 10,
        startFragPrefetch: true,
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 800,
        fragLoadingMaxRetry: 4,
        enableWorker: typeof Worker === 'function',
        preferManagedMediaSource: true,
      });
      hls.on(Hls.Events.MANIFEST_PARSED, tryPlay);
      hls.on(Hls.Events.FRAG_LOADED, () => { frags++; touch(); });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (disposed) return;
        if (data.details === Hls.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR
          || data.details === Hls.ErrorDetails.BUFFER_INCOMPATIBLE_CODECS_ERROR) {
          unsupRef.current?.();
          return;
        }
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && retries < 2) { retries++; hls?.recoverMediaError(); return; }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retries < 3) { retries++; setTimeout(() => { if (!disposed) hls?.startLoad(); }, 1200); return; }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !gotFrame) { unsupRef.current?.(); return; }
        fatalRef.current?.();
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else if (nativeHls(video)) {
      video.src = src;
      video.load();
      tryPlay();
    } else {
      unsupRef.current?.();
    }

    const guard = window.setInterval(() => {
      if (disposed) return;
      if (video.paused && gotFrame && !needTapRef.current) tryPlay();
      if (!gotFrame && !needTapRef.current && Date.now() - started > 12000 && (frags >= 2 || (!hls && video.readyState >= 1))) {
        unsupRef.current?.();
        return;
      }
      if (live && idleMs() > (gotFrame ? 20000 : 25000)) { touch(); fatalRef.current?.(); }
    }, 2000);

    return () => {
      disposed = true;
      clearInterval(guard);
      video.removeEventListener('timeupdate', onTimeUpd);
      video.removeEventListener('loadeddata', onFrame);
      video.removeEventListener('error', onErr);
      const fc = freezeCanvas;
      if (fc && video.videoWidth && video.readyState >= 2) {
        try {
          fc.width = video.videoWidth;
          fc.height = video.videoHeight;
          fc.getContext('2d')?.drawImage(video, 0, 0);
          setFrozen(true);
        } catch { /* */ }
      }
      hls?.destroy();
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch { /* */ }
    };
  }, [src, epoch, live, progress, touch, idleMs]);

  const resume = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    const p = v.play();
    if (p && typeof p.then === 'function') p.then(() => setNeedTap(false)).catch(() => { /* */ });
    else setNeedTap(false);
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {!hasFrame && poster && (
        <img src={poster} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none object-contain" />
      )}
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full bg-transparent object-contain"
        style={{ opacity: hasFrame ? 1 : 0 }}
        muted={muted}
        playsInline
        autoPlay
        disablePictureInPicture
        controls={false}
        preload="auto"
        {...{ 'webkit-playsinline': 'true', 'x5-playsinline': 'true' }}
      />
      <canvas
        ref={freezeRef}
        className="pointer-events-none absolute inset-0 h-full w-full object-contain"
        style={{ display: frozen ? 'block' : 'none' }}
      />
      <StreamOverlay hasFrame={hasFrame} stalled={stalled} error={error} needTap={needTap} onTap={resume} poster={!hasFrame && !!poster} />
    </div>
  );
}