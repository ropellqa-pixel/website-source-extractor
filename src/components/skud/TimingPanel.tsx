import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { skudCall, type SkudController, type SkudTiming } from '@/lib/skudApi';

type Key = keyof SkudTiming;
interface Field { k: Key; label: string; unit: string; min: number; max: number; step?: number; scale?: number; hint: string }

const DOOR: Field[] = [
  { k: 'relay_tenths', label: 'Замок открыт', unit: 'сек', min: 0.1, max: 25.5, step: 0.1, scale: 10, hint: 'Сколько реле держит замок открытым после карты, кнопки или команды с сайта.' },
  { k: 'pass_tenths', label: 'Время на проход', unit: 'сек', min: 0, max: 25.5, step: 0.1, scale: 10, hint: 'За это время дверь можно открыть без тревоги «взлом». 0 — без датчика двери.' },
  { k: 'hold_sec', label: 'Тревога «Дверь не закрыта» через', unit: 'сек', min: 0, max: 255, hint: '0 — не следить, сколько дверь стоит открытой.' },
  { k: 'confirm_sec', label: 'Ожидание кода / второй карты', unit: 'сек', min: 0, max: 255, hint: 'Для карт с кодом на клавиатуре. 0 — заводское значение.' },
];
const SPEED: Field[] = [
  { k: 'ctrl_poll_ms', label: 'Опрос контроллера', unit: 'мс', min: 200, max: 5000, step: 100, hint: 'Как часто программа спрашивает контроллер о новых проходах. Меньше — быстрее появляются в журнале.' },
  { k: 'server_sync_sec', label: 'Связь с сайтом', unit: 'сек', min: 1, max: 30, hint: 'Как быстро дверь откроется по кнопке на сайте и запишутся новые карты.' },
  { k: 'site_refresh_sec', label: 'Обновление страницы СКУД', unit: 'сек', min: 2, max: 60, hint: 'Как часто журнал на сайте обновляется сам.' },
  { k: 'reconnect_sec', label: 'Переподключение при обрыве', unit: 'сек', min: 3, max: 120, hint: 'Пауза перед новой попыткой, если контроллер перестал отвечать.' },
  { k: 'enroll_sec', label: 'Ожидание новой карты на двери', unit: 'сек', min: 30, max: 600, hint: 'Сколько ждать карту при записи новой карты.' },
  { k: 'open_cmd_ttl_sec', label: 'Команда «Открыть» действует', unit: 'сек', min: 10, max: 300, hint: 'Если ПК склада был не на связи дольше — дверь не откроется с опозданием.' },
  { k: 'emergency_repeat_min', label: 'Повтор аварийного открытия', unit: 'мин', min: 1, max: 60, hint: 'Как часто подтверждать контроллеру режим «дверь открыта».' },
  { k: 'clock_sync_hours', label: 'Сверка часов контроллера', unit: 'ч', min: 1, max: 24, hint: 'Как часто выставлять точное время.' },
];
const FAST: Partial<SkudTiming> = { ctrl_poll_ms: 300, server_sync_sec: 1, site_refresh_sec: 3, reconnect_sec: 5 };
const ECO: Partial<SkudTiming> = { ctrl_poll_ms: 1000, server_sync_sec: 3, site_refresh_sec: 10, reconnect_sec: 15 };

export default function TimingPanel({ controller, onChanged }: { controller: SkudController; onChanged: (l: SkudController[]) => void }) {
  const [t, setT] = useState<SkudTiming>(controller.timing);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setT(controller.timing); }, [controller.timing]);

  const val = (f: Field) => (f.scale ? t[f.k] / f.scale : t[f.k]);
  const set = (f: Field, v: string) => {
    const n = Number(v.replace(',', '.'));
    if (Number.isNaN(n)) return;
    setT({ ...t, [f.k]: Math.round(f.scale ? n * f.scale : n) });
  };
  const save = async (force = false) => {
    setBusy(true); setMsg(null);
    const r = await skudCall<{ controllers: SkudController[] }>({ action: 'timing_save', id: controller.id, timing: t, force });
    setBusy(false);
    if (r.error) { setMsg(r.error); return; }
    onChanged(r.controllers);
    setMsg('Сохранено. Программа на ПК склада применит за 1–2 секунды.');
  };
  const read = async () => {
    const r = await skudCall<{ controllers: SkudController[] }>({ action: 'read_params', id: controller.id });
    if (!r.error) { onChanged(r.controllers); setMsg('Запросил у контроллера — обновится через пару секунд.'); }
  };

  const gp = controller.gate_params;
  const row = (f: Field) => (
    <div key={f.k}>
      <label className="mb-1 block text-xs font-medium">{f.label}, {f.unit}</label>
      <Input type="number" min={f.min} max={f.max} step={f.step || 1} value={val(f)} onChange={(e) => set(f, e.target.value)} />
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{f.hint}</p>
    </div>
  );

  return (
    <div className="space-y-4 rounded-xl border p-3">
      <div className="flex items-center gap-2 text-sm font-medium"><Icon name="Timer" size={16} />Настройки времени</div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Дверь (пишется в контроллер)</p>
        <div className="grid gap-3 sm:grid-cols-2">{DOOR.map(row)}</div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {gp ? (
            <span>Сейчас в контроллере: замок {(gp.relay_tenths ?? 0) / 10} с · проход {(gp.pass_tenths ?? 0) / 10} с · «не закрыта» {gp.hold_sec ?? 0} с · код {gp.confirm_sec ?? 0} с</span>
          ) : <span>Значения из контроллера ещё не прочитаны</span>}
          <button onClick={read} className="text-primary hover:underline">Прочитать из контроллера</button>
        </div>
      </div>
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Скорость отклика</p>
          <div className="flex gap-1.5">
            <button onClick={() => setT({ ...t, ...FAST })} className="rounded-md border px-2 py-0.5 text-xs hover:bg-secondary">Максимально быстро</button>
            <button onClick={() => setT({ ...t, ...ECO })} className="rounded-md border px-2 py-0.5 text-xs hover:bg-secondary">Экономно</button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">{SPEED.map(row)}</div>
      </div>
      {msg && <p className="text-xs text-emerald-600">{msg}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => save(true)}>Записать всё в контроллер заново</Button>
        <Button size="sm" disabled={busy} onClick={() => save()}><Icon name="Save" size={14} />{busy ? 'Сохраняю…' : 'Сохранить время'}</Button>
      </div>
    </div>
  );
}
