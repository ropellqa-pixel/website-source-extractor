import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { accCall, monthLabel, rub, type PeriodInfo } from '@/lib/accountingApi';

interface Props { canClose: boolean; canSync: boolean; onChanged: () => void }

export default function PeriodsBar({ canClose, canSync, onChanged }: Props) {
  const [periods, setPeriods] = useState<PeriodInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await accCall<{ periods: PeriodInfo[] }>({ action: 'periods' });
    if (!r.error) setPeriods(r.periods);
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (action: string, p: PeriodInfo) => {
    if (action === 'period_close' && !confirm(`Закрыть ${monthLabel(p.period)}? Суммы зарплаты и инкассации зафиксируются, изменения в этом месяце будут запрещены.`)) return;
    if (action === 'period_open' && !confirm(`Открыть ${monthLabel(p.period)}? Суммы снова начнут подтягиваться из «Зарплаты» и «Инкассации».`)) return;
    setBusy(p.period + action);
    const r = await accCall({ action, period: p.period });
    setBusy(null);
    if (r.error) { alert(r.error); return; }
    await load();
    onChanged();
  };

  const openCount = periods.filter((p) => !p.closed).length;

  return (
    <div className="rounded-2xl border bg-card">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-4 py-2.5 text-sm">
        <Icon name="CalendarCheck" size={16} className="text-primary" />
        <span className="font-medium">Месяцы</span>
        <span className="text-muted-foreground">открыто {openCount}, закрыто {periods.length - openCount}</span>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={16} className="ml-auto text-muted-foreground" />
      </button>
      {open && (
        <div className="border-t">
          <p className="px-4 py-2 text-xs text-muted-foreground">
            Открытый месяц автоматически подтягивает ИТОГО к выдаче из «Зарплаты» и фактическую инкассацию. После закрытия суммы фиксируются и больше не меняются.
          </p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-y"><th className="px-4 py-2 font-medium">Месяц</th><th className="px-4 py-2 text-right font-medium">Зарплата (сотр. + рук.)</th><th className="px-4 py-2 text-right font-medium">Инкассация факт</th><th className="px-4 py-2 font-medium">Статус</th><th /></tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.period} className="border-b last:border-0">
                  <td className="px-4 py-2">{monthLabel(p.period)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{p.snapshot ? rub((p.snapshot.salary_emp || 0) + (p.snapshot.salary_mgr || 0)) : '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{p.snapshot ? rub(p.snapshot.collection || 0) : '—'}</td>
                  <td className="px-4 py-2">
                    {p.closed ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700"><Icon name="Lock" size={11} />закрыт{p.closed_by ? ` · ${p.closed_by}` : ''}</span>
                    ) : <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700"><Icon name="RefreshCw" size={11} />открыт, синхронизируется</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {!p.closed && canSync && (
                        <Button size="sm" variant="ghost" className="h-7" disabled={!!busy} onClick={() => act('period_sync', p)}>
                          <Icon name="RefreshCw" size={13} className={busy === p.period + 'period_sync' ? 'animate-spin' : ''} />Обновить
                        </Button>
                      )}
                      {canClose && (p.closed
                        ? <Button size="sm" variant="outline" className="h-7" disabled={!!busy} onClick={() => act('period_open', p)}>Открыть</Button>
                        : <Button size="sm" className="h-7" disabled={!!busy} onClick={() => act('period_close', p)}>Закрыть месяц</Button>)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
