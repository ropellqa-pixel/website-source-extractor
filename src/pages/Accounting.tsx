import { useEffect, useMemo, useState } from 'react';
import Icon from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import EntriesTab from '@/components/accounting/EntriesTab';
import ProfitTab from '@/components/accounting/ProfitTab';
import SalaryTab from '@/components/accounting/SalaryTab';
import AccessTab from '@/components/accounting/AccessTab';
import { accCall, monthLabel, monthRange, shiftMonth, thisMonth, type Category, type Me } from '@/lib/accountingApi';

type Tab = 'entries' | 'profit' | 'salary' | 'access';
const TABS: [Tab, string, string][] = [
  ['entries', 'Доходы и расходы', 'ArrowLeftRight'],
  ['profit', 'Прибыль', 'TrendingUp'],
  ['salary', 'Зарплата', 'Banknote'],
  ['access', 'Доступ', 'ShieldCheck'],
];

export default function Accounting() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tab, setTab] = useState<Tab>('entries');
  const [month, setMonth] = useState<string | null>(thisMonth());
  const [range, setRange] = useState<[string, string]>(monthRange(thisMonth()));

  useEffect(() => {
    accCall<Me>({ action: 'me' }).then((r) => {
      if (r.error) { setError(r.error); return; }
      setMe(r); setCategories(r.categories);
      const first = TABS.find(([k]) => k !== 'access' && r.perms[k as keyof Me['perms']]);
      if (first) setTab(first[0]);
    });
  }, []);

  const tabs = useMemo(() => TABS.filter(([k]) => (k === 'access' ? me?.can_edit : me?.perms[k])), [me]);

  const pickMonth = (m: string) => { setMonth(m); setRange(monthRange(m)); };

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!me) return <div className="flex justify-center py-20"><Icon name="Loader2" size={24} className="animate-spin text-muted-foreground" /></div>;
  if (tabs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <Icon name="Lock" size={32} />
        <p className="text-sm">У вас нет доступа к бухгалтерии. Его может открыть заместитель директора.</p>
      </div>
    );
  }

  const withPeriod = tab === 'entries' || tab === 'profit';

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold tracking-tight">Бухгалтерия</h1>
          <p className="text-sm text-muted-foreground">
            {me.can_edit ? 'Доходы, расходы, прибыль и зарплата' : 'Только просмотр — изменяет заместитель директора'}
          </p>
        </div>
        {!me.can_edit && (
          <span className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground"><Icon name="Eye" size={13} />Просмотр</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-2 flex flex-wrap rounded-lg bg-secondary p-0.5">
          {tabs.map(([k, l, i]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              <Icon name={i} fallback="Circle" size={15} />{l}
            </button>
          ))}
        </div>
        {withPeriod && (
          <>
            <div className="flex items-center rounded-lg border">
              <button onClick={() => pickMonth(shiftMonth(month || range[0].slice(0, 7), -1))} className="p-2 hover:bg-secondary"><Icon name="ChevronLeft" size={16} /></button>
              <span className="w-36 text-center text-sm font-medium">{month ? monthLabel(month) : 'Свой период'}</span>
              <button onClick={() => pickMonth(shiftMonth(month || range[0].slice(0, 7), 1))} className="p-2 hover:bg-secondary"><Icon name="ChevronRight" size={16} /></button>
            </div>
            <Input type="date" value={range[0]} max={range[1]} onChange={(e) => { setMonth(null); setRange([e.target.value, range[1]]); }} className="h-9 w-auto" />
            <span className="text-muted-foreground">—</span>
            <Input type="date" value={range[1]} min={range[0]} onChange={(e) => { setMonth(null); setRange([range[0], e.target.value]); }} className="h-9 w-auto" />
            <button onClick={() => { setMonth(null); setRange([`${range[0].slice(0, 4)}-01-01`, `${range[0].slice(0, 4)}-12-31`]); }}
              className="rounded-lg px-3 py-1.5 text-sm hover:bg-secondary">Весь год</button>
          </>
        )}
      </div>

      {tab === 'entries' && <EntriesTab from={range[0]} to={range[1]} canEdit={me.can_edit} categories={categories} onCategories={setCategories} />}
      {tab === 'profit' && <ProfitTab from={range[0]} to={range[1]} />}
      {tab === 'salary' && <SalaryTab canEdit={me.can_edit} />}
      {tab === 'access' && <AccessTab />}
    </div>
  );
}
