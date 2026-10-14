import { Fragment, useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { accCall, monthLabel, rub } from '@/lib/accountingApi';
import { downloadCsv } from './csv';

interface Dds {
  opening: number; closing: number; months: string[];
  balances: { month: string; start: number; income: number; expense: number; end: number }[];
  rows: { kind: 'income' | 'expense'; category: string; months: Record<string, number>; total: number }[];
}

export default function DdsTab({ from, to, reloadKey }: { from: string; to: string; reloadKey: number }) {
  const [data, setData] = useState<Dds | null>(null);

  useEffect(() => {
    setData(null);
    accCall<Dds>({ action: 'dds', date_from: from, date_to: to }).then((r) => { if (!r.error) setData(r); });
  }, [from, to, reloadKey]);

  if (!data) return <div className="flex justify-center py-16"><Icon name="Loader2" size={24} className="animate-spin text-muted-foreground" /></div>;

  const short = (m: string) => monthLabel(m).replace(/^(\S{3})\S*/, '$1');
  const sum = (kind: string, m?: string) => data.rows.filter((r) => r.kind === kind).reduce((s, r) => s + (m ? r.months[m] || 0 : r.total), 0);

  const exportCsv = () => {
    const head = ['Статья', ...data.months.map(monthLabel), 'Итого'];
    const lines: (string | number)[][] = [head, ['Остаток на начало', ...data.balances.map((b) => b.start), data.opening]];
    (['income', 'expense'] as const).forEach((k) => {
      lines.push([k === 'income' ? 'ПОСТУПЛЕНИЯ' : 'ВЫПЛАТЫ', ...data.months.map((m) => sum(k, m)), sum(k)]);
      data.rows.filter((r) => r.kind === k).forEach((r) => lines.push(['  ' + r.category, ...data.months.map((m) => r.months[m] || 0), r.total]));
    });
    lines.push(['Остаток на конец', ...data.balances.map((b) => b.end), data.closing]);
    downloadCsv(`ДДС_${from}_${to}.csv`, lines);
  };

  const Cell = ({ v, bold, cls }: { v: number; bold?: boolean; cls?: string }) => (
    <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${bold ? 'font-semibold' : ''} ${cls || ''}`}>{v ? rub(v) : '—'}</td>
  );

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-auto">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Движение денежных средств по статьям и месяцам</p>
        <button onClick={exportCsv} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm hover:bg-secondary"><Icon name="Download" size={15} />В Excel</button>
      </div>
      <div className="overflow-auto rounded-2xl border bg-card">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="sticky left-0 bg-card px-3 py-2.5 text-left font-medium">Статья</th>
              {data.months.map((m) => <th key={m} className="px-3 py-2.5 text-right font-medium">{short(m)}</th>)}
              <th className="px-3 py-2.5 text-right font-medium">Итого</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b bg-secondary/50">
              <td className="sticky left-0 bg-secondary px-3 py-2 font-medium">Остаток на начало</td>
              {data.balances.map((b) => <Cell key={b.month} v={b.start} />)}
              <Cell v={data.opening} bold />
            </tr>
            {(['income', 'expense'] as const).map((k) => (
              <Fragment key={k}>
                <tr className="border-b">
                  <td className={`sticky left-0 bg-card px-3 py-2 font-semibold ${k === 'income' ? 'text-emerald-700' : 'text-red-700'}`}>{k === 'income' ? 'Поступления' : 'Выплаты'}</td>
                  {data.months.map((m) => <Cell key={m} v={sum(k, m)} bold cls={k === 'income' ? 'text-emerald-700' : 'text-red-700'} />)}
                  <Cell v={sum(k)} bold cls={k === 'income' ? 'text-emerald-700' : 'text-red-700'} />
                </tr>
                {data.rows.filter((r) => r.kind === k).map((r) => (
                  <tr key={k + r.category} className="border-b">
                    <td className="sticky left-0 bg-card py-2 pl-7 pr-3">{r.category}</td>
                    {data.months.map((m) => <Cell key={m} v={r.months[m] || 0} />)}
                    <Cell v={r.total} />
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr className="bg-secondary/50">
              <td className="sticky left-0 bg-secondary px-3 py-2 font-medium">Остаток на конец</td>
              {data.balances.map((b) => <Cell key={b.month} v={b.end} bold cls={b.end < 0 ? 'text-red-600' : ''} />)}
              <Cell v={data.closing} bold cls={data.closing < 0 ? 'text-red-600' : ''} />
            </tr>
          </tbody>
        </table>
        {data.months.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Нет движения за период</p>}
      </div>
    </div>
  );
}
