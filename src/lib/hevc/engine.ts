export type CamEngine = 'native' | 'wasm' | 'snapshot';

const HEVC_TYPES = ['video/mp4; codecs="hvc1.1.6.L93.B0"', 'video/mp4; codecs="hev1.1.6.L93.B0"'];
const SS_KEY = 'abiz_cam_engine';

type MSLike = { isTypeSupported?: (t: string) => boolean };

function mseHevc(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { ManagedMediaSource?: MSLike; MediaSource?: MSLike; WebKitMediaSource?: MSLike };
  return [w.ManagedMediaSource, w.MediaSource, w.WebKitMediaSource].some((ms) => {
    if (!ms || typeof ms.isTypeSupported !== 'function') return false;
    try { return HEVC_TYPES.some((t) => ms.isTypeSupported!(t)); } catch { return false; }
  });
}

function nativeHlsHevc(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const v = document.createElement('video');
    if (typeof v.canPlayType !== 'function') return false;
    if (!v.canPlayType('application/vnd.apple.mpegurl')) return false;
    return HEVC_TYPES.some((t) => v.canPlayType(t) !== '');
  } catch { return false; }
}

export function canWasm(): boolean {
  return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function'
    && typeof Worker === 'function' && typeof fetch === 'function' && typeof URL === 'function';
}

export function canNative(): boolean {
  return mseHevc() || nativeHlsHevc();
}

const RANK: Record<CamEngine, number> = { native: 0, wasm: 1, snapshot: 2 };

function remembered(): CamEngine | null {
  try {
    const v = sessionStorage.getItem(SS_KEY);
    return v === 'native' || v === 'wasm' || v === 'snapshot' ? v : null;
  } catch { return null; }
}

export function detectEngine(preferWasm = false): CamEngine {
  let e: CamEngine = !preferWasm && canNative() ? 'native' : canWasm() ? 'wasm' : canNative() ? 'native' : 'snapshot';
  const r = remembered();
  if (r && RANK[r] > RANK[e]) e = r;
  return e;
}

export function downgradeEngine(cur: CamEngine): CamEngine {
  const next: CamEngine = cur === 'native' && canWasm() ? 'wasm' : 'snapshot';
  try { sessionStorage.setItem(SS_KEY, next); } catch { /* */ }
  return next;
}
