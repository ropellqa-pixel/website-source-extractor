import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { adminCall, evalFormula } from '@/lib/access';
import type { AdminData } from './types';

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

export default function FormulasTab({ data, onChanged }: { data: AdminData; onChanged: () => void }) {
  const [formulas, setFormulas] = useState<Record<string, string>>(data.formulas);
  const [params, setParams] = useState(data.params);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [focus, setFocus] = useState('total');

  const sample = useMemo(() => {
    const env: Record<string, number> = { revenue: 1000000, days: 30, ...params };
    data.fields.salary.forEach((f) => { env[f.var] = f.var === 'hours' ? 160 : f.kind === 'deduction' ? 1000 : 0; });
    data.fields.manager.forEach((f) => { env[f.var] = f.var === 'osn_hours' ? 160 : env[f.var] ?? 0; });
    env.rate = evalFormula(formulas.rate, env);
    env.total = evalFormula(formulas.total, env);
    env.week = evalFormula(formulas.week, env);
    env.manager_rate = evalFormula(formulas.manager_rate, env);
    env.manager_total = evalFormula(formulas.manager_total, env);
    env.manager_week = evalFormula(formulas.manager_week, env);
    return env;
  }, [formulas, params, data.fields]);

  const vars = focus.startsWith('manager')
    ? [...data.variables.global, { var: 'rate', label: 'Ставка сотрудника' }, ...(focus !== 'manager_rate' ? [{ var: 'manager_rate', label: 'Ставка руководителя' }, ...data.variables.manager] : []), ...(focus === 'manager_week' ? [{ var: 'manager_total', label: 'ИТОГ руководителя' }] : [])]
    : [...data.variables.global, ...(focus !== 'rate' ? [{ var: 'rate', label: 'Ставка ₽/час' }, ...data.variables.salary] : []), ...(focus === 'week' ? [{ var: 'total', label: 'ИТОГ' }] : [])];

  const save = async () => {
    setBusy(true); setMsg(null);
    const r = await adminCall({ action: 'formulas_save', formulas, params });
    setBusy(false);
    if (r.error) { setMsg({ ok: false, text: r.error }); return; }
    setMsg({ ok: true, text: 'Сохранено. Зарплата и бухгалтерия (открытые месяцы) пересчитаются по новым формулам.' });
    onChanged();
  };

  const reset = async () => {
    if (!confirm('Вернуть стандартные формулы?')) return;
    await adminCall({ action: 'reset', what: 'formulas' });
    setFormulas(data.default_formulas);
    onChanged();
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 rounded-2xl border bg-card p-4">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Процент сотрудникам (percent)</span>
            <Input inputMode="decimal" value={params.percent} onChange={(e) => setParams({ ...params, percent: Number(e.target.value.replace(',', '.')) || 0 })} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Надбавка руководителям, % (manager_percent)</span>
            <Input inputMode="decimal" value={params.manager_percent} onChange={(e) => setParams({ ...params, manager_percent: Number(e.target.value.replace(',', '.')) || 0 })} />
          </label>
        </div>
        {data.formula_order.map((k) => (
          <div key={k} className={`rounded-2xl border bg-card p-4 ${focus === k ? 'ring-2 ring-primary/40' : ''}`}>
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="font-medium">{data.formula_labels[k]}</span>
              <span className="tabular-nums text-muted-foreground">пример: <b className="text-foreground">{fmt(sample[k] || 0)}</b></span>
            </div>
            <Input value={formulas[k] || ''} onFocus={() => setFocus(k)} onChange={(e) => setFormulas({ ...formulas, [k]: e.target.value })} className="font-mono text-sm" />
            {formulas[k] !== data.default_formulas[k] && (
              <button onClick={() => setFormulas({ ...formulas, [k]: data.default_formulas[k] })} className="mt-1 text-xs text-muted-foreground hover:text-foreground">
                стандартная: <span className="font-mono">{data.default_formulas[k]}</span>
              </button>
            )}
          </div>
        ))}
        {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}
        <div className="flex gap-2">
          <Button onClick={save} disabled={busy}>{busy ? 'Проверяю и сохраняю…' : 'Сохранить формулы'}</Button>
          <Button variant="outline" onClick={reset}>Сбросить к стандартным</Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-2xl border bg-card p-4 xl:sticky xl:top-4">
          <h3 className="mb-2 flex items-center gap-2 font-medium"><Icon name="Variable" fallback="Braces" size={16} />Что можно использовать</h3>
          <p className="mb-3 text-xs text-muted-foreground">Нажмите на переменную — она добавится в выбранную формулу. Знаки: + − * / ( ). Функции: round(x; 2), min, max, abs.</p>
          <div className="space-y-1">
            {vars.map((v) => (
              <button key={v.var} onClick={() => setFormulas({ ...formulas, [focus]: `${formulas[focus] || ''} ${v.var}`.trim() })}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-secondary">
                <span>{v.label}</span>
                <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">{v.var}</code>
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Пример считается для выручки 1 000 000 ₽, 30 дней, 160 часов. Свои колонки добавляются во вкладке «Поля форм» и сразу появляются здесь.</p>
        </div>
      </div>
    </div>
  );
}
