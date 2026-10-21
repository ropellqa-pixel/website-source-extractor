import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import HlsPlayer from '@/components/cameras/HlsPlayer';
import ArchiveBar from '@/components/cameras/ArchiveBar';
import CameraManager from '@/components/cameras/CameraManager';
import WasmHevcPlayer from '@/components/cameras/WasmHevcPlayer';
import SnapshotView from '@/components/cameras/SnapshotView';
import { camerasCall, fmtSec, type Camera } from '@/lib/camerasApi';
import { detectEngine, downgradeEngine, type CamEngine } from '@/lib/hevc/engine';
import { useCamSnapshot } from '@/lib/camStream';

const IN_ABIZ = typeof navigator !== 'undefined' && /AbizShell|AbizAdmin|\bABIZ\//.test(navigator.userAgent);
const PREFER_WASM = IN_ABIZ || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('wasm'));

const LS_LIST = 'abiz_cams_list';
const LS_LIVE = 'abiz_cams_live';
const LIVE_TTL = 40 * 60 * 1000;
function lsGet<T>(k: string): T | null { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function lsSet(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } }
function loadLive(): Record<string, string> {
  const all = lsGet<Record<string, { url: string; at: number }>>(LS_LIVE) || {};
  const out: Record<string, string> = {};
  Object.entries(all).forEach(([id, v]) => { if (v?.url && Date.now() - v.at < LIVE_TTL) out[id] = v.url; });
  return out;
}
function saveLive(id: string, url: string | null) {
  const all = lsGet<Record<string, { url: string; at: number }>>(LS_LIVE) || {};
  if (url) all[id] = { url, at: Date.now() }; else delete all[id];
  lsSet(LS_LIVE, all);
}
const cachedList = lsGet<{ cameras: Camera[]; can_manage: boolean }>(LS_LIST);

type Mode = { kind: 'live' } | { kind: 'archive'; day: string; sec: number };

export default function Cameras() {
  // Переход из СКУД: ?cam=<id>&day=YYYY-MM-DD&sec=<секунды от начала дня> — сразу открываем архив на это время.
  const [params] = useSearchParams();
  const jumpCam = params.get('cam');
  const [jump] = useState(() => ({ cam: params.get('cam'), day: params.get('day'), sec: Number(params.get('sec')) }));
  const [cameras, setCameras] = useState<Camera[]>(() => cachedList?.cameras || []);
  const [canManage, setCanManage] = useState(!!cachedList?.can_manage);
  const [loading, setLoading] = useState(!cachedList?.cameras?.length);
  const [index, setIndex] = useState(() => {
    const l = cachedList?.cameras || [];
    const w = l.findIndex((c) => c.id === jumpCam);
    const d = l.findIndex((c) => c.is_default);
    return w >= 0 ? w : d >= 0 ? d : 0;
  });
  const [src, setSrc] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [engine, setEngine] = useState<CamEngine>(() => detectEngine(PREFER_WASM));
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
  const freshNext = useRef(false);
  const liveCache = useRef<Record<string, string>>(loadLive());

  const cam = cameras[index];
  const camId = cam?.id;
  const modeKey = mode.kind === 'live' ? 'live' : `${mode.day}|${mode.sec}`;
  const poster = useCamSnapshot(camId, mode.kind === 'live');

  useEffect(() => {
    camerasCall<{ cameras?: Camera[]; can_manage?: boolean }>({ action: 'list' }).then((r) => {
      const list = r.cameras || [];
      if (r.error && !list.length && cachedList?.cameras?.length) { setLoading(false); return; }
      lsSet(LS_LIST, { cameras: list, can_manage: !!r.can_manage });
      if (JSON.stringify(list) !== JSON.stringify(cachedList?.cameras || [])) setCameras(list);
      setCanManage(!!r.can_manage);
      const def = list.findIndex((c) => c.is_default);
      const wanted = list.findIndex((c) => c.id === jump.cam);
      const cur = cachedList?.cameras?.[0] ? list.findIndex((c) => c.id === (cachedList.cameras.find((x) => x.id === jump.cam) || cachedList.cameras.find((x) => x.is_default) || cachedList.cameras[0]).id) : -1;
      const next = wanted >= 0 ? wanted : def >= 0 ? def : 0;
      if (!(cur >= 0 && cur === next)) setIndex(next);
      if (wanted >= 0 && jump.day && Number.isFinite(jump.sec)) {
        setMode({ kind: 'archive', day: jump.day, sec: jump.sec });
        setShowArchive(true);
      }
      if (r.error) setError(r.error);
      setLoading(false);
    });
    camerasCall<{ streams?: Record<string, { url?: string }> }>({ action: 'live_all' }).then((r) => {
      Object.entries(r.streams || {}).forEach(([id, v]) => { if (v.url && !liveCache.current[id]) { liveCache.current[id] = v.url; saveLive(id, v.url); } });
    });
  }, [jump]);

  const connect = useCallback(async (reconnect = false) => {
    if (!camId) return;
    const id = ++reqId.current;
    if (!reconnect) setSrc(null);
    setError(null); setConnecting(true); setPlayPos(null);
    let r: { url?: string; error?: string };
    if (mode.kind === 'live') {
      const cached = !hd ? liveCache.current[camId] : undefined;
      const fresh = freshNext.current;
      freshNext.current = false;
      r = cached ? { url: cached } : await camerasCall({ action: 'live', id: camId, quality: hd ? 'hd' : 'sd', fresh });
      if (!hd && r.url && !cached) { liveCache.current[camId] = r.url; saveLive(camId, r.url); }
    } else {
      const start = `${mode.day} ${fmtSec(mode.sec)}`;
      const end = `${mode.day} ${fmtSec(Math.min(mode.sec + 3600, 86399))}`;
      r = await camerasCall({ action: 'playback', id: camId, start, end });
    }
    if (id !== reqId.current) return;
    setConnecting(false);
    if (r.error || !r.url) {
      setError(r.error || 'Не удалось получить видео');
      if (mode.kind === 'live') setTimeout(() => { if (id === reqId.current) { freshNext.current = true; connect(true); } }, 4000);
    } else { setSrc(r.url); setEpoch((e) => e + 1); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camId, modeKey, hd]);

  useEffect(() => { connect(); }, [connect]);

  const onUnsupported = useCallback(() => {
    setEngine((e) => (e === 'snapshot' ? e : downgradeEngine(e)));
  }, []);

  const go = useCallback((dir: number) => {
    if (cameras.length < 2) return;
    setIndex((i) => (i + dir + cameras.length) % cameras.length);
    setMode((m) => (m.kind === 'live' ? m : { kind: 'live' }));
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
    const d = document as Document & { webkitFullscreenElement?: Element };
    const h = () => setIsFull(!!(d.fullscreenElement || d.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', h);
    document.addEventListener('webkitfullscreenchange', h);
    return () => { document.removeEventListener('fullscreenchange', h); document.removeEventListener('webkitfullscreenchange', h); };
  }, []);

  const toggleFull = () => {
    const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    const el = wrapRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      if (d.exitFullscreen) d.exitFullscreen().catch(() => { /* */ });
      else d.webkitExitFullscreen?.();
      return;
    }
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => { /* */ });
    else if (el?.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else {
      const v = el?.querySelector('video') as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
      v?.webkitEnterFullscreen?.();
    }
  };

  const onFatal = useCallback(() => {
    if (camId) { delete liveCache.current[camId]; saveLive(camId, null); }
    freshNext.current = true;
    if (mode.kind === 'live') setTimeout(() => connect(true), 500);
    else setError('Запись прервалась. Выберите другое время.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeKey, connect, camId]);

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
        {engine === 'native' ? <HlsPlayer
          key={`${engine}-${cam.id}-${modeKey}-${hd}`}
          src={src} epoch={epoch} loading={connecting} error={error} poster={poster} muted={muted}
          live={mode.kind === 'live'} onFatal={onFatal} onUnsupported={onUnsupported} onTime={onTime}
        /> : engine === 'wasm' ? <WasmHevcPlayer
          key={`${engine}-${cam.id}-${modeKey}-${hd}`}
          src={src} epoch={epoch} loading={connecting} error={error} poster={poster} onFatal={onFatal}
          onUnsupported={onUnsupported} live={mode.kind === 'live'} onTime={onTime}
        /> : mode.kind === 'live' ? <SnapshotView key={`snap-${cam.id}`} cameraId={cam.id} poster={poster} />
          : <div className="flex h-full w-full items-center justify-center p-6 text-center text-sm text-white/80">
            Этот браузер не умеет показывать запись архива. Откройте страницу в Chrome, Edge, Safari или Яндекс Браузере.
          </div>}

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
              onLive={() => setMode((m) => (m.kind === 'live' ? m : { kind: 'live' }))}
              initialDay={mode.kind === 'archive' ? mode.day : undefined}
            />
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-white/10 bg-neutral-950 px-3 py-2.5">
        {cameras.map((c, i) => (
          <button
            key={c.id}
            onClick={() => { setIndex(i); setMode((m) => (m.kind === 'live' ? m : { kind: 'live' })); }}
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
