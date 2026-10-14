import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { accCall, fmtDay, monthLabel, rub } from '@/lib/accountingApi';

interface Slip {
  name: string; position: string | null; period: string; debt_start: number; accrued: number; paid: number; debt_end: number;
  lines: { section: 'info' | 'accrual' | 'deduction' | 'total'; label: string; amount: number }[];
  payments: { date: string; amount: number; comment: string | null }[];
}

const fmtNum = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

export default function Payslip({ staffId, period }: { staffId: number; period: string }) {
  const [slip, setSlip] = useState<Slip | null>(null);

  useEffect(() => {
    accCall<Slip>({ action: 'payslip', staff_id: staffId, period }).then((r) => { if (!r.error) setSlip(r); });
  }, [staffId, period]);

  if (!slip) return <div className="flex justify-center py-10"><Icon name="Loader2" size={22} className="animate-spin text-muted-foreground" /></div>;

  const block = (sec: Slip['lines'][number]['section'], title: string, sign = '') => {
    const rows = slip.lines.filter((l) => l.section === sec);
    if (!rows.length) return null;
    return (
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
        {rows.map((l, i) => (
          <div key={i} className="flex justify-between py-0.5 text-sm">
            <span>{l.label}</span>
            <span className="tabular-nums">{sec === 'info' ? fmtNum(l.amount) : `${sign}${rub(l.amount)}`}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div id="payslip" className="space-y-3 text-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Расчётный листок · {monthLabel(slip.period)}</div>
          <div className="text-lg font-semibold">{slip.name}</div>
          {slip.position && <div className="text-muted-foreground">{slip.position}</div>}
        </div>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm hover:bg-secondary print:hidden">
          <Icon name="Printer" size={15} />Печать
        </button>
      </div>
      <div className="flex justify-between rounded-lg bg-secondary px-3 py-2">
        <span>Долг на начало месяца</span><span className="font-medium tabular-nums">{rub(slip.debt_start)}</span>
      </div>
      {block('info', 'Показатели')}
      {block('accrual', 'Начислено', '+')}
      {block('deduction', 'Удержано', '−')}
      {slip.lines.filter((l) => l.section === 'total').map((l, i) => (
        <div key={i} className="flex justify-between border-t pt-2 font-medium"><span>{l.label}</span><span className="tabular-nums">{rub(l.amount)}</span></div>
      ))}
      <div className="flex justify-between font-semibold"><span>Всего начислено к выдаче за месяц</span><span className="tabular-nums">{rub(slip.accrued)}</span></div>
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Выплачено</div>
        {slip.payments.length === 0 ? <p className="text-muted-foreground">Выплат не было</p> : slip.payments.map((p, i) => (
          <div key={i} className="flex justify-between py-0.5">
            <span>{fmtDay(String(p.date))}{p.comment ? ` · ${p.comment}` : ''}</span><span className="tabular-nums">{rub(p.amount)}</span>
          </div>
        ))}
      </div>
      <div className={`flex justify-between rounded-lg px-3 py-2 font-semibold ${slip.debt_end > 0 ? 'bg-red-500/10 text-red-700' : 'bg-emerald-500/10 text-emerald-700'}`}>
        <span>{slip.debt_end >= 0 ? 'Долг на конец месяца' : 'Переплата (аванс)'}</span><span className="tabular-nums">{rub(Math.abs(slip.debt_end))}</span>
      </div>
    </div>
  );
}
