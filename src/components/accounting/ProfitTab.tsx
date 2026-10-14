import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { accCall, monthLabel, rub, type Kind, type ProfitData } from '@/lib/accountingApi';

function CategoryList({ title, kind, data }: { title: string; kind: Kind; data: ProfitData }) {
  const rows = data.by_category.filter((r) => r.kind === kind);
  const total = kind === 'income' ? data.income : data.expense;
  const bar = kind === 'income' ? 'bg-emerald-500' : 'bg-red-500';
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-medium">{title}</h3>
        <span className="text-sm font-semibold tabular-nums">{rub(total)}</span>
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">Нет операций</p> : (
        <div className="space-y-2.5">
          {rows.map((r) => {
            const pct = total ? (r.total / total) * 100 : 0;
            return (
              <div key={r.category}>
                <div className="flex justify-between text-sm">
                  <span>{r.category} <span className="text-xs text-muted-foreground">· {r.count}</span></span>
                  <span className="tabular-nums">{rub(r.total)} <span className="text-xs text-muted-foreground">{pct.toFixed(0)}%</span></span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-secondary"><div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ProfitTab({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<ProfitData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    accCall<ProfitData>({ action: 'profit', date_from: from, date_to: to }).then((r) => {
      if (r.error) setError(r.error); else { setError(null); setData(r); }
    });
  }, [from, to]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <div className="flex justify-center py-16"><Icon name="Loader2" size={24} className="animate-spin text-muted-foreground" /></div>;

  const margin = data.income ? (data.profit / data.income) * 100 : 0;

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">Доходы</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600">{rub(data.income)}</div>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">Расходы</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-red-600">{rub(data.expense)}</div>
        </div>
        <div className={`rounded-2xl border p-4 ${data.profit >= 0 ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
          <div className="text-xs text-muted-foreground">{data.profit >= 0 ? 'Прибыль' : 'Убыток'}</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${data.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{rub(data.profit)}</div>
          {data.income > 0 && <div className="text-xs text-muted-foreground">Рентабельность {margin.toFixed(1)}%</div>}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <CategoryList title="Доходы по статьям" kind="income" data={data} />
        <CategoryList title="Расходы по статьям" kind="expense" data={data} />
      </div>

      {data.by_month.length > 1 && (
        <div className="overflow-auto rounded-2xl border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2.5 font-medium">Месяц</th>
                <th className="px-4 py-2.5 text-right font-medium">Доходы</th>
                <th className="px-4 py-2.5 text-right font-medium">Расходы</th>
                <th className="px-4 py-2.5 text-right font-medium">Прибыль</th>
              </tr>
            </thead>
            <tbody>
              {data.by_month.map((m) => (
                <tr key={m.month} className="border-b last:border-0">
                  <td className="px-4 py-2.5">{monthLabel(m.month)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{rub(m.income)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{rub(m.expense)}</td>
                  <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${m.income - m.expense >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{rub(m.income - m.expense)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
