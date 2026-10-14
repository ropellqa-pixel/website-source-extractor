import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { adminCall } from '@/lib/access';
import type { AdminData } from './types';

const SHIFTS: [string, string][] = [['Д', 'Дневная'], ['Н', 'Ночная'], ['Дп', 'Дневная (подработка)'], ['Нп', 'Ночная (подработка)']];

export default function GeneralTab({ data, onChanged }: { data: AdminData; onChanged: () => void }) {
  const [start, setStart] = useState(data.general.start_period);
  const [hours, setHours] = useState<Record<string, number | string>>(data.general.shift_hours);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true); setMsg(null);
    const r = await adminCall({ action: 'general_save', start_period: start, shift_hours: hours });
    setBusy(false);
    if (r.error) { setMsg({ ok: false, text: r.error }); return; }
    setMsg({ ok: true, text: 'Сохранено. Бухгалтерия пересчитается при следующем открытии.' });
    onChanged();
  };

  return (
    <div className="grid max-w-3xl gap-4 md:grid-cols-2">
      <div className="space-y-2 rounded-2xl border bg-card p-4">
        <h3 className="font-medium">Начало учёта в бухгалтерии</h3>
        <p className="text-xs text-muted-foreground">
          Месяцы раньше этого не попадают в бухгалтерию: ни зарплата, ни инкассация, ни долги сотрудникам. Так тестовые и старые данные не искажают итоги.
        </p>
        <Input type="month" value={start} onChange={(e) => setStart(e.target.value)} className="w-48" />
      </div>
      <div className="space-y-2 rounded-2xl border bg-card p-4">
        <h3 className="font-medium">Часы в смене (для «Часы из табеля»)</h3>
        <p className="text-xs text-muted-foreground">Сколько часов засчитывать в «Зарплату» за каждую смену из табеля.</p>
        <div className="grid grid-cols-2 gap-2">
          {SHIFTS.map(([k, l]) => (
            <label key={k} className="space-y-1 text-sm">
              <span className="text-muted-foreground">{k} · {l}</span>
              <Input inputMode="decimal" value={hours[k] ?? ''} onChange={(e) => setHours({ ...hours, [k]: e.target.value })} />
            </label>
          ))}
        </div>
      </div>
      <div className="md:col-span-2">
        {msg && <p className={`mb-2 text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}
        <Button onClick={save} disabled={busy}>{busy ? 'Сохраняю…' : 'Сохранить'}</Button>
      </div>
    </div>
  );
}
