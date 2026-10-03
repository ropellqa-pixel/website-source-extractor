import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import HlsPlayer from '@/components/cameras/HlsPlayer';
import ArchiveBar from '@/components/cameras/ArchiveBar';
import CameraManager from '@/components/cameras/CameraManager';
import SnapshotView from '@/components/cameras/SnapshotView';
import { camerasCall, fmtSec, type Camera } from '@/lib/camerasApi';

// Камеры снимают в H.265. Его умеют Edge/Chrome на Windows с аппаратным декодером и Safari.
// Если браузер не умеет — в эфире показываем частые снимки вместо видео.
const HEVC_OK = typeof window !== 'undefined' && (
  (window.MediaSource?.isTypeSupported?.('video/mp4; codecs="hvc1.1.6.L93.B0"') ?? false) ||
  (window.MediaSource?.isTypeSupported?.('video/mp4; codecs="hev1.1.6.L93.B0"') ?? false) ||
  !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl')
);

type Mode = { kind: 'live' } | { kind: 'archive'; day: string; sec: number };

export default function Cameras() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [src, setSrc] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'live' });
  const [showArchive, setShowArchive] = useState(false);
  const [hd, setHd] = useState(false);
  const [muted, setMuted] = useState(true);
  const [manage, setManage] = useState(false);
  const [playPos, setPlayPos] = useState<number | null>(null);
  const [isFull, setIsFull] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  const cam = cameras[index];

  useEffect(() => {
    camerasCall<{ cameras?: Camera[]; can_manage?: boolean }>({ action: 'list' }).then((r) => {
      const list = r.cameras || [];
      setCameras(list);
      setCanManage(!!r.can_manage);
      const def = list.findIndex((c) => c.is_default);
      setIndex(def >= 0 ? def : 0);
      if (r.error) setError(r.error);
      setLoading(false);
    });
  }, []);

  const connect = useCallback(async () => {
    if (!cam) return;
    if (!HEVC_OK) {
      setSrc(null); setConnecting(false);
      setError(mode.kind === 'archive' ? 'Этот браузер не умеет показывать видео H.265 с камеры. Откройте сайт в Microsoft Edge или Google Chrome на Windows.' : null);
      return;
    }
    const id = ++reqId.current;
    setSrc(null); setError(null); setConnecting(true); setPlayPos(null);
    let r: { url?: string; error?: string };
    if (mode.kind === 'live') {
      r = await camerasCall({ action: 'live', id: cam.id, quality: hd ? 'hd' : 'sd' });
    } else {
      const start = `${mode.day} ${fmtSec(mode.sec)}`;
      const end = `${mode.day} ${fmtSec(Math.min(mode.sec + 3600, 86399))}`;
      r = await camerasCall({ action: 'playback', id: cam.id, start, end });
    }
    if (id !== reqId.current) return;
    setConnecting(false);
    if (r.error || !r.url) setError(r.error || 'Не удалось получить видео');
    else setSrc(r.url);
  }, [cam, mode, hd]);

  useEffect(() => { connect(); }, [connect]);

  const go = useCallback((dir: number) => {
    if (cameras.length < 2) return;
    setIndex((i) => (i + dir + cameras.length) % cameras.length);
    setMode({ kind: 'live' });
  }, [cameras.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || manage) return;
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, manage]);

  useEffect(() => {
    const h = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else wrapRef.current?.requestFullscreen?.();
  };

  const onFatal = useCallback(() => {
    if (mode.kind === 'live') setTimeout(() => connect(), 2000);
    else setError('Запись прервалась. Выберите другое время.');
  }, [mode, connect]);

  const onTime = useCallback((t: number) => {
    if (mode.kind === 'archive') setPlayPos(Math.min(mode.sec + Math.floor(t), 86399));
  }, [mode]);

  const onChanged = (list: Camera[]) => {
    const curId = cam?.id;
    setCameras(list);
    const keep = list.findIndex((c) => c.id === curId);
    if (keep >= 0) setIndex(keep);
    else { const d = list.findIndex((c) => c.is_default); setIndex(d >= 0 ? d : 0); }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Icon name="Loader2" size={28} className="animate-spin" />
      </div>
    );
  }

  if (cameras.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
          <Icon name="Cctv" fallback="Video" size={30} className="text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Камер пока нет</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {canManage ? 'Добавьте камеру по серийному номеру — видео появится здесь.' : 'Директор или зам. директора ещё не добавил камеры.'}
          </p>
        </div>
        {canManage && (
          <button onClick={() => setManage(true)} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90">
            Добавить камеру
          </button>
        )}
        <CameraManager open={manage} onOpenChange={setManage} cameras={cameras} onChanged={onChanged} />
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative flex h-full flex-col bg-black text-white">
      <div className="relative min-h-0 flex-1">
        {!HEVC_OK && mode.kind === 'live' ? <SnapshotView key={cam.id} cameraId={cam.id} /> : <HlsPlayer
          key={`${cam.id}-${mode.kind}-${mode.kind === 'archive' ? mode.day + mode.sec : ''}-${hd}`}
          src={src} loading={connecting} error={error} muted={muted} onFatal={onFatal} onTime={onTime}
        />}

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-3 sm:p-4">
          <div className="pointer-events-auto flex items-center gap-2">
            <span className="text-base font-semibold sm:text-lg">{cam.name}</span>
            {mode.kind === 'live' ? (
              <span className="flex items-center gap-1.5 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> LIVE
              </span>
            ) : (
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-black">АРХИВ {mode.day.split('-').reverse().join('.')}</span>
            )}
          </div>
          <div className="pointer-events-auto flex items-center gap-1">
            {mode.kind === 'live' && (
              <button onClick={() => setHd(!hd)} title="Качество" className="rounded-lg px-2 py-1.5 text-xs font-semibold hover:bg-white/15">
                {hd ? 'HD' : 'SD'}
              </button>
            )}
            <button onClick={() => setMuted(!muted)} title={muted ? 'Включить звук' : 'Выключить звук'} className="rounded-lg p-2 hover:bg-white/15">
              <Icon name={muted ? 'VolumeX' : 'Volume2'} size={18} />
            </button>
            <button onClick={() => setShowArchive(!showArchive)} title="Просмотр по времени"
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm hover:bg-white/15 ${showArchive ? 'bg-white/20' : ''}`}>
              <Icon name="History" size={18} /> <span className="hidden sm:inline">Архив</span>
            </button>
            {canManage && (
              <button onClick={() => setManage(true)} title="Настройка камер" className="rounded-lg p-2 hover:bg-white/15">
                <Icon name="Settings" size={18} />
              </button>
            )}
            <button onClick={toggleFull} title="На весь экран" className="rounded-lg p-2 hover:bg-white/15">
              <Icon name={isFull ? 'Minimize' : 'Maximize'} size={18} />
            </button>
          </div>
        </div>

        {cameras.length > 1 && (
          <>
            <button onClick={() => go(-1)} aria-label="Предыдущая камера"
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-3 hover:bg-black/70 sm:left-4">
              <Icon name="ChevronLeft" size={28} />
            </button>
            <button onClick={() => go(1)} aria-label="Следующая камера"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-3 hover:bg-black/70 sm:right-4">
              <Icon name="ChevronRight" size={28} />
            </button>
          </>
        )}

        {showArchive && (
          <div className="absolute inset-x-2 bottom-2 sm:inset-x-4 sm:bottom-4">
            <ArchiveBar
              cameraId={cam.id}
              playingFrom={mode.kind === 'archive' ? mode.sec : null}
              position={playPos}
              onSeek={(day, sec) => setMode({ kind: 'archive', day, sec: Math.max(0, sec) })}
              onLive={() => setMode({ kind: 'live' })}
            />
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-white/10 bg-neutral-950 px-3 py-2.5">
        {cameras.map((c, i) => (
          <button
            key={c.id}
            onClick={() => { setIndex(i); setMode({ kind: 'live' }); }}
            className={`flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm transition ${
              i === index ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            <Icon name="Video" size={15} />
            {c.name}
            {c.is_default && <Icon name="Star" size={12} className="opacity-60" />}
          </button>
        ))}
        <span className="ml-auto hidden shrink-0 pl-3 text-xs text-white/40 md:block">← → переключение камер</span>
      </div>

      <CameraManager open={manage} onOpenChange={setManage} cameras={cameras} onChanged={onChanged} />
    </div>
  );
}
