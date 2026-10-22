import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/auth';
import PlanDayDialog from './PlanDayDialog';
import {
  MONTHS_GEN,
  MONTHS_NOM,
  PRESETS,
  PlanEvent,
  createPlan,
  deletePlan,
  fetchPlans,
  textColorFor,
  toYmd,
  updatePlan,
} from './planApi';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const BACK_MONTHS = 12;
const FORWARD_MONTHS = 60;

const monthIndex = (y: number, m: number) => y * 12 + m;

function groupByDate(list: PlanEvent[]) {
  const map: Record<string, PlanEvent[]> = {};
  list.forEach(p => {
    (map[p.plan_date] ||= []).push(p);
  });
  return map;
}

function DayPanel({ title, date, plans, loading, onOpen }: { title: string; date: Date; plans: PlanEvent[]; loading: boolean; onOpen: () => void }) {
  return (
    <div className="surface flex h-full flex-col p-5 text-left">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{date.getDate()} {MONTHS_GEN[date.getMonth()]}</p>
          <h4 className="font-head text-[18px] font-medium tracking-[-0.02em]">{title}</h4>
        </div>
        <Button variant="secondary" size="icon" className="h-8 w-8 rounded-lg" onClick={onOpen} title="Добавить план">
          <Icon name="Plus" size={16} />
        </Button>
      </div>
      {loading && plans.length === 0 ? (
        <div className="space-y-2.5">{[0, 1].map(k => <div key={k} className="h-12 animate-pulse rounded-xl bg-secondary" />)}</div>
      ) : plans.length === 0 ? (
        <button type="button" onClick={onOpen} className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-6 text-sm text-muted-foreground transition-colors hover:border-[hsl(var(--slab-edge))] hover:bg-[hsl(var(--cell))] hover:text-[hsl(var(--day))]">
          <Icon name="CalendarPlus" size={20} strokeWidth={1.6} />
          Планов нет — добавить
        </button>
      ) : (
        <ul className="space-y-2.5">
          {plans.map(p => (
            <li key={p.id} className="flex gap-3 rounded-xl bg-secondary/50 p-2.5">
              <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: p.color }} />
              <div className="min-w-0 flex-1">
                <span
                  className="inline-block rounded-md px-2 py-0.5 text-xs font-medium"
                  style={{ background: p.color, color: textColorFor(p.color) }}
                >
                  {p.status}
                </span>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{p.note}</p>
                {p.created_by_name && <p className="mt-0.5 text-xs text-muted-foreground">{p.created_by_name}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PlanCalendar() {
  const { user, company } = useAuth();
  const companyId = company?.id || user?.companyId || '';

  const now = new Date();
  const todayStr = toYmd(now);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowStr = toYmd(tomorrow);
  const baseIdx = monthIndex(now.getFullYear(), now.getMonth());
  const minIdx = baseIdx - BACK_MONTHS;
  const maxIdx = baseIdx + FORWARD_MONTHS;

  const [viewIdx, setViewIdx] = useState(baseIdx);
  const viewYear = Math.floor(viewIdx / 12);
  const viewMonth = viewIdx % 12;

  const [monthPlans, setMonthPlans] = useState<PlanEvent[]>([]);
  const [nearPlans, setNearPlans] = useState<PlanEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openDate, setOpenDate] = useState<string | null>(null);

  const monthStart = toYmd(new Date(viewYear, viewMonth, 1));
  const monthEnd = toYmd(new Date(viewYear, viewMonth + 1, 0));

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    try {
      const [m, n] = await Promise.all([
        fetchPlans(companyId, monthStart, monthEnd),
        fetchPlans(companyId, todayStr, tomorrowStr),
      ]);
      setMonthPlans(m);
      setNearPlans(n);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить планы');
    } finally {
      setLoading(false);
    }
  }, [companyId, monthStart, monthEnd, todayStr, tomorrowStr]);

  useEffect(() => {
    load();
  }, [load]);

  const byDate = useMemo(() => groupByDate([...monthPlans, ...nearPlans.filter(p => !monthPlans.some(m => m.id === p.id))]), [monthPlans, nearPlans]);

  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(viewYear, viewMonth + 1, 0).getDate();
    const res: (Date | null)[] = Array(offset).fill(null);
    for (let d = 1; d <= days; d++) res.push(new Date(viewYear, viewMonth, d));
    while (res.length % 7) res.push(null);
    return res;
  }, [viewYear, viewMonth]);

  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = Math.floor(minIdx / 12); y <= Math.floor(maxIdx / 12); y++) list.push(y);
    return list;
  }, [minIdx, maxIdx]);

  const clamp = (i: number) => Math.min(maxIdx, Math.max(minIdx, i));

  const handleCreate = async (data: { status: string; color: string; note: string }) => {
    if (!openDate || !companyId) throw new Error('Компания не определена');
    await createPlan({
      company_id: companyId,
      plan_date: openDate,
      status: data.status,
      color: data.color,
      note: data.note,
      created_by: user?.id || '',
      created_by_name: user?.fullName || user?.email || '',
    });
    await load();
  };

  const handleUpdate = async (id: string, data: { status: string; color: string; note: string }) => {
    await updatePlan(id, data);
    await load();
  };

  const handleDelete = async (id: string) => {
    await deletePlan(id);
    await load();
  };

  const legend = PRESETS.reduce<{ color: string; labels: string[] }[]>((acc, p) => {
    const g = acc.find(a => a.color === p.color);
    if (g) g.labels.push(p.status);
    else acc.push({ color: p.color, labels: [p.status] });
    return acc;
  }, []);

  return (
    <section className="w-full max-w-[1200px] pt-14 text-left">
      <h2 className="page-title mb-6 text-[24px] sm:text-[26px]">Календарь планирования</h2>
      {error && <p className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"><Icon name="AlertCircle" size={16} />{error}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_minmax(0,1.6fr)_1fr]">
        <div className="order-2 lg:order-1">
          <DayPanel title="План на сегодня" date={now} plans={byDate[todayStr] || []} loading={loading} onOpen={() => setOpenDate(todayStr)} />
        </div>

        <div className="surface order-1 p-4 sm:p-5 lg:order-2">
          <div className="mb-4 flex items-center justify-between gap-2">
            <Button variant="ghost" size="icon" onClick={() => setViewIdx(i => clamp(i - 1))} disabled={viewIdx <= minIdx} title="Предыдущий месяц">
              <Icon name="ChevronLeft" size={18} />
            </Button>
            <div className="flex items-center gap-2">
              <Select value={String(viewMonth)} onValueChange={v => setViewIdx(clamp(monthIndex(viewYear, Number(v))))}>
                <SelectTrigger className="h-9 w-[124px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS_NOM.map((name, i) => {
                    const idx = monthIndex(viewYear, i);
                    return (
                      <SelectItem key={i} value={String(i)} disabled={idx < minIdx || idx > maxIdx}>
                        {name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <Select value={String(viewYear)} onValueChange={v => setViewIdx(clamp(monthIndex(Number(v), viewMonth)))}>
                <SelectTrigger className="h-9 w-[92px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map(y => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setViewIdx(i => clamp(i + 1))} disabled={viewIdx >= maxIdx} title="Следующий месяц">
              <Icon name="ChevronRight" size={18} />
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {WEEKDAYS.map((w, i) => (
              <div key={w} className={`pb-1 text-center text-xs ${i >= 5 ? 'text-destructive/80' : 'text-muted-foreground'}`}>
                {w}
              </div>
            ))}
            {cells.map((d, i) => {
              if (!d) return <div key={`e${i}`} className="aspect-square" />;
              const key = toYmd(d);
              const plans = byDate[key] || [];
              const first = plans[0];
              const isToday = key === todayStr;
              const bg = first?.color;
              const fg = bg ? textColorFor(bg) : undefined;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOpenDate(key)}
                  title={plans.map(p => `${p.status}: ${p.note}`).join('\n') || undefined}
                  className={`relative flex aspect-square flex-col items-center justify-center rounded-xl text-sm tabular-nums transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lift active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    bg ? 'font-semibold shadow-soft' : 'bg-secondary/60 text-foreground hover:bg-card'
                  } ${isToday ? 'font-semibold ring-2 ring-[hsl(var(--day))] ring-offset-2 ring-offset-card' : ''}`}
                  style={bg ? { background: bg, color: fg } : undefined}
                >
                  <span>{d.getDate()}</span>
                  {plans.length > 1 && (
                    <span className="absolute bottom-1 flex max-w-full gap-0.5 px-1">
                      {plans.slice(1, 5).map(p => (
                        <span
                          key={p.id}
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: p.color, boxShadow: `0 0 0 1px ${fg === '#FFFFFF' ? 'rgba(255,255,255,.8)' : 'rgba(17,24,39,.5)'}` }}
                        />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {legend.map(l => (
              <span key={l.color} className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-[4px] shadow-soft" style={{ background: l.color }} />
                {l.labels.join(', ')}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <Icon name="Palette" size={12} />
              Свой статус
            </span>
            {loading && <Icon name="Loader2" size={12} className="ml-auto animate-spin" />}
          </div>
        </div>

        <div className="order-3">
          <DayPanel title="План на завтра" date={tomorrow} plans={byDate[tomorrowStr] || []} loading={loading} onOpen={() => setOpenDate(tomorrowStr)} />
        </div>
      </div>

      <PlanDayDialog
        date={openDate}
        plans={openDate ? byDate[openDate] || [] : []}
        onClose={() => setOpenDate(null)}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    </section>
  );
}
