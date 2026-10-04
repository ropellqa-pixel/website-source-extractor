import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import WasmHevcPlayer from '@/components/cameras/WasmHevcPlayer';
import { camerasCall, type Camera } from '@/lib/camerasApi';

/**
 * Полноэкранный просмотр одной камеры для программы АБИЗ на экране входа (без входа на сайт).
 * Программа передаёт токен ПК в адресе (#t=...), страница сразу убирает его из адреса.
 * Параметр name — начало названия камеры (например «Зал»).
 */
export default function CamView() {
  const [params] = useSearchParams();
  const [cam, setCam] = useState<Camera | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [fresh, setFresh] = useState(0);

  useEffect(() => {
    const m = /[#&]t=([^&]+)/.exec(location.hash);
    if (m) {
      try { sessionStorage.setItem('abiz_device_token', decodeURIComponent(m[1])); } catch { /* */ }
      history.replaceState(null, '', location.pathname + location.search);
    }
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const prefix = (params.get('name') || '').toLowerCase();
    camerasCall<{ cameras?: Camera[] }>({ action: 'list' }).then((r) => {
      const list = r.cameras || [];
      const found = list.find(c => c.name.toLowerCase().startsWith(prefix)) || list.find(c => c.is_default) || list[0];
      if (!found) { setError(r.error || 'Камеры не найдены'); return; }
      setCam(found);
    });
  }, [params]);

  useEffect(() => {
    if (!cam) return;
    let cancelled = false;
    setSrc(null);
    camerasCall<{ url?: string; error?: string }>({ action: 'live', id: cam.id, quality: 'sd', fresh: fresh > 0 }).then((r) => {
      if (cancelled) return;
      if (r.url) { setSrc(r.url); setError(null); }
      else { setError(r.error || 'Камера недоступна'); setTimeout(() => setFresh(f => f + 1), 4000); }
    });
    return () => { cancelled = true; };
  }, [cam, fresh]);

  const onFatal = useCallback(() => setFresh(f => f + 1), []);

  return (
    <div className="fixed inset-0 bg-black text-white">
      <WasmHevcPlayer key={`${cam?.id}-${fresh}`} src={src} loading={!src && !error} error={error} onFatal={onFatal} />
      <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-3 rounded-xl bg-black/60 px-3 py-1.5">
        <span className="text-lg font-semibold">{cam?.name || 'Камера'}</span>
        <span className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold">LIVE</span>
      </div>
      <div className="pointer-events-none absolute right-4 top-4 text-lg font-semibold text-white/85">
        {clock.toLocaleTimeString('ru-RU')}
      </div>
    </div>
  );
}
