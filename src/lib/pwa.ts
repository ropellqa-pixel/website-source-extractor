type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

export const isInsideAbizApp = () => typeof navigator !== 'undefined' && /AbizShell|AbizAdmin|ABIZ\//.test(navigator.userAgent);
export const isStandalone = () =>
  typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export const canInstall = () => !!deferred;

export function onInstallChange(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  notify();
  await e.prompt();
  const r = await e.userChoice;
  return r.outcome === 'accepted';
}

/** Регистрирует служебный скрипт приложения и ловит предложение Chrome «Установить». */
export function startPwa(): void {
  if (typeof window === 'undefined' || isInsideAbizApp()) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => { deferred = null; notify(); });
  const host = window.location.hostname;
  const devHost = host === 'localhost' || host.endsWith('poehali.dev') || host.endsWith('preview.poehali.dev');
  if ('serviceWorker' in navigator && window.isSecureContext && !devHost) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }
}
