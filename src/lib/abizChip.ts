type ChipResult = { ok: boolean; error?: string; uid?: string; abiz?: boolean; id?: string; name?: string; date?: string };

interface WebView { postMessage: (m: unknown) => void; addEventListener: (t: 'message', f: (e: { data: unknown }) => void) => void; removeEventListener: (t: 'message', f: (e: { data: unknown }) => void) => void }

function webview(): WebView | null {
  const w = (window as unknown as { chrome?: { webview?: WebView } }).chrome?.webview;
  return w || null;
}

export const chipAvailable = () => !!webview();

export function chipCall(op: 'write' | 'read', data?: { id: string; name: string }): Promise<ChipResult> {
  const wv = webview();
  if (!wv) return Promise.resolve({ ok: false, error: 'Запись на карту работает только в программе АБИЗ на ПК со считывателем Mifare' });
  const req = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => { wv.removeEventListener('message', on); resolve({ ok: false, error: 'Программа АБИЗ не ответила. Обновите программу АБИЗ на этом ПК' }); }, 30000);
    function on(e: { data: unknown }) {
      const d = e.data as (ChipResult & { abizChipResult?: boolean; req?: string }) | null;
      if (!d || !d.abizChipResult || d.req !== req) return;
      window.clearTimeout(timer);
      wv!.removeEventListener('message', on);
      resolve(d);
    }
    wv.addEventListener('message', on);
    wv.postMessage({ abizChip: op, req, data });
  });
}
