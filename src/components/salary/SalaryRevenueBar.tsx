import { fmt } from '@/components/salary/salaryUtils';

interface Props {
  canEdit: boolean;
  revenue: number;
  daysInMonth: number;
  k2: number;
  onRevenue: (v: number) => void;
  onDays: (v: number) => void;
}

export default function SalaryRevenueBar({ canEdit, revenue, daysInMonth, k2, onRevenue, onDays }: Props) {
  return (
    <div className="bg-card rounded-xl border border-border p-4 mb-4">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-sky-700 uppercase tracking-wider">C3. ВЫРУЧКА</label>
          {canEdit ? (
            <input type="number" value={revenue || ''} onChange={(e) => onRevenue(Number(e.target.value))}
              className="w-36 bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm text-foreground text-right focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="0" />
          ) : (
            <span className="text-sm text-sky-700 font-bold ml-2">{fmt(revenue)}</span>
          )}
          <span className="text-xs text-muted-foreground">₽</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-sky-700 uppercase tracking-wider">C9. ДНИ</label>
          {canEdit ? (
            <input type="number" value={daysInMonth || ''} onChange={(e) => onDays(Number(e.target.value))}
              className="w-20 bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm text-foreground text-right focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="30" />
          ) : (
            <span className="text-sm text-sky-700 font-bold ml-2">{daysInMonth}</span>
          )}
          <span className="text-xs text-muted-foreground">дн.</span>
        </div>
        <div className="text-xs text-muted-foreground">K2 = {daysInMonth} × 24 = <b className="text-foreground/80">{k2}</b></div>
      </div>
    </div>
  );
}
