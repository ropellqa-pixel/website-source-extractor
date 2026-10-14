import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { accCall, monthLabel, rub, shiftMonth, thisMonth } from '@/lib/accountingApi';

interface Row { category_id: number; kind: 'income' | 'expense'; category: string; plan: number; fact: number; diff: number; pct: number | null }

export default function BudgetTab({ canEdit, reloadKey }: { canEdit: boolean; reloadKey: number }) {
  const [period, setPeriod] = useState(thisMonth());
  const [rows, setRows] = useState<Row[]>([]);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    const r = await accCall<{ rows: Row[] }>({ action: 'budget', period });
    if (!r.error) { setRows(r.rows); setDraft({}); setDirty(false); }
  }, [period, reloadKey]);

  useEffect(() => { load(); }, [load]);

  const save = async (copy?: boolean) => {
    setBusy(true);
    const items = copy ? [] : Object.entries(draft).map(([id, v]) => ({ category_id: Number(id), plan: v.replace(/\s/g, '').replace(',', '.') || 0 }));
    const r = await accCall<{ rows: Row[] }>({ action: 'budget_save', period, items, copy_from: copy ? shiftMonth(period, -1) : undefined });
    setBusy(false);
    if (r.error) { alert(r.error); return; }
    setRows(r.rows); setDraft({}); setDirty(false);
  };

  const sumBy = (k: string, f: 'plan' | 'fact') => rows.filter((r) => r.kind === k).reduce((s, r) => s + r[f], 0);

  const Section = ({ kind }: { kind: 'income' | 'expense' }) => (
    <>
      <tr className="border-b bg-secondary/50">
        <td className="px-4 py-2 font-semibold">{kind === 'income' ? 'Доходы' : 'Расходы'}</td>
        <td className="px-4 py-2 text-right font-semibold tabular-nums">{rub(sumBy(kind, 'plan'))}</td>
        <td className="px-4 py-2 text-right font-semibold tabular-nums">{rub(sumBy(kind, 'fact'))}</td>
        <td className="px-4 py-2 text-right font-semibold tabular-nums">{rub(sumBy(kind, 'fact') - sumBy(kind, 'plan'))}</td>
        <td />
      </tr>
      {rows.filter((r) => r.kind === kind).map((r) => {
        const bad = r.plan > 0 && (kind === 'expense' ? r.fact > r.plan : r.fact < r.plan);
        const pct = r.plan ? Math.min(100, (r.fact / r.plan) * 100) : 0;
        return (
          <tr key={r.category_id} className="border-b last:border-0">
            <td className="px-4 py-2">{r.category}</td>
            <td className="px-4 py-2 text-right">
              {canEdit ? (
                <input inputMode="decimal" value={draft[r.category_id] ?? (r.plan || '')} placeholder="0"
                  onChange={(e) => { setDraft({ ...draft, [r.category_id]: e.target.value }); setDirty(true); }}
                  className="w-32 rounded-md border bg-background px-2 py-1 text-right tabular-nums" />
              ) : <span className="tabular-nums">{rub(r.plan)}</span>}
            </td>
            <td className="px-4 py-2 text-right tabular-nums">{rub(r.fact)}</td>
            <td className={`px-4 py-2 text-right tabular-nums ${bad ? 'text-red-600' : r.plan ? 'text-emerald-600' : 'text-muted-foreground'}`}>
              {r.plan || r.fact ? `${r.diff > 0 ? '+' : ''}${rub(r.diff)}` : '—'}
            </td>
            <td className="w-40 px-4 py-2">
              {r.plan > 0 && (
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-secondary"><div className={`h-full rounded-full ${bad ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} /></div>
                  <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{r.pct}%</span>
                </div>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border">
          <button onClick={() => setPeriod(shiftMonth(period, -1))} className="p-2 hover:bg-secondary"><Icon name="ChevronLeft" size={16} /></button>
          <span className="w-36 text-center text-sm font-medium">{monthLabel(period)}</span>
          <button onClick={() => setPeriod(shiftMonth(period, 1))} className="p-2 hover:bg-secondary"><Icon name="ChevronRight" size={16} /></button>
        </div>
        {canEdit && (
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => confirm('Скопировать план с прошлого месяца?') && save(true)}>Скопировать план прошлого месяца</Button>
            <Button size="sm" disabled={busy || !dirty} onClick={() => save()}>Сохранить план</Button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border bg-card">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
            <tr className="border-b"><th className="px-4 py-2.5 font-medium">Статья</th><th className="px-4 py-2.5 text-right font-medium">План</th><th className="px-4 py-2.5 text-right font-medium">Факт</th><th className="px-4 py-2.5 text-right font-medium">Отклонение</th><th className="px-4 py-2.5 font-medium">Исполнение</th></tr>
          </thead>
          <tbody>
            <Section kind="income" />
            <Section kind="expense" />
            <tr className="border-t-2 bg-secondary/50 font-semibold">
              <td className="px-4 py-2">Прибыль</td>
              <td className="px-4 py-2 text-right tabular-nums">{rub(sumBy('income', 'plan') - sumBy('expense', 'plan'))}</td>
              <td className="px-4 py-2 text-right tabular-nums">{rub(sumBy('income', 'fact') - sumBy('expense', 'fact'))}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
