import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { skudCall, WEEKDAYS, type SkudController, type SkudGuard } from '@/lib/skudApi';

interface Props {
  controller: SkudController;
  onChanged: (list: SkudController[]) => void;
}

export default function GuardPanel({ controller, onChanged }: Props) {
  const g = controller.guard;
  const [form, setForm] = useState<SkudGuard>(g);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm(controller.guard); }, [controller.guard]);

  const call = async (action: string, extra: Record<string, unknown>) => {
    setBusy(true);
    const r = await skudCall<{ controllers: SkudController[] }>({ action, id: controller.id, ...extra });
    setBusy(false);
    if (r.error) { alert(r.error); return; }
    onChanged(r.controllers);
  };
  const save = (next: Partial<SkudGuard>) => {
    const f = { ...form, ...next };
    setForm(f);
    call('guard_save', { guard: { schedule: f.schedule, from: f.from, to: f.to, days: f.days, siren: f.siren } });
  };

  return (
    <section className={`space-y-3 rounded-xl border p-3 ${g.on ? 'border-red-300 bg-red-50/50' : ''}`}>
      <div className="flex items-center gap-2">
        <Icon name={g.on ? 'ShieldAlert' : 'Shield'} size={16} className={g.on ? 'text-red-600' : 'text-muted-foreground'} />
        <h3 className="flex-1 text-sm font-semibold">Склад на охране</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${g.on ? 'bg-red-600 text-white' : 'bg-secondary text-muted-foreground'}`}>
          {g.on ? 'ВКЛЮЧЕНА' : 'снята'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Пока склад на охране, любое открытие двери — по карте, кнопкой, с сайта или взлом — сразу тревога руководству в ВК{form.siren ? ' и сирена' : ''}.
      </p>
      <button disabled={busy} onClick={() => call('guard_set', { on: !g.on })}
        className={`flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-60 ${g.on ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}>
        <Icon name={g.on ? 'ShieldOff' : 'ShieldCheck'} size={16} />{g.on ? 'Снять с охраны' : 'Поставить на охрану'}
      </button>
      {g.by && <p className="text-xs text-muted-foreground">Последний раз вручную: {g.by}</p>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.schedule} disabled={busy} onChange={(e) => save({ schedule: e.target.checked })} />
        Ставить на охрану автоматически по расписанию
      </label>
      {form.schedule && (
        <div className="space-y-2 rounded-lg bg-secondary/50 p-2.5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">с</span>
            <Input type="time" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} onBlur={() => save({})} className="h-9 w-28" />
            <span className="text-muted-foreground">до</span>
            <Input type="time" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} onBlur={() => save({})} className="h-9 w-28" />
            <span className="text-xs text-muted-foreground">(через полночь — тоже можно)</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((d, i) => (
              <button key={d} disabled={busy} onClick={() => save({ days: form.days ^ (1 << i) })}
                className={`h-8 w-9 rounded-md text-xs ${form.days & (1 << i) ? 'bg-primary text-primary-foreground' : 'border bg-background hover:bg-secondary'}`}>{d}</button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">Дни — когда охрана начинается. Снятая вручную охрана снова включится по расписанию в следующий раз.</p>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.siren} disabled={busy} onChange={(e) => save({ siren: e.target.checked })} />
        Включать сирену при открытии на охране {controller.siren?.addr ? '' : <span className="text-xs text-amber-600">(сирена не выбрана ниже)</span>}
      </label>
    </section>
  );
}
