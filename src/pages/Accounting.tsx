import { useEffect, useMemo, useState } from 'react';
import Icon from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import EntriesTab from '@/components/accounting/EntriesTab';
import ProfitTab from '@/components/accounting/ProfitTab';
import DdsTab from '@/components/accounting/DdsTab';
import BudgetTab from '@/components/accounting/BudgetTab';
import CounterpartiesTab from '@/components/accounting/CounterpartiesTab';
import SalaryTab from '@/components/accounting/SalaryTab';
import PeriodsBar from '@/components/accounting/PeriodsBar';
import { accCall, monthLabel, monthRange, shiftMonth, thisMonth, type Category, type Me } from '@/lib/accountingApi';

type Tab = 'entries' | 'profit' | 'dds' | 'budget' | 'counterparties' | 'salary';
const TABS: [Tab, string, string, string][] = [
  ['entries', 'Доходы и расходы', 'ArrowLeftRight', 'accounting.view_entries'],
  ['profit', 'Прибыль', 'TrendingUp', 'accounting.view_reports'],
  ['dds', 'ДДС', 'Table2', 'accounting.view_reports'],
  ['budget', 'План-факт', 'Target', 'accounting.view_budget'],
  ['counterparties', 'Контрагенты', 'Building2', 'accounting.view_counterparties'],
  ['salary', 'Зарплата', 'Banknote', 'accounting.view_salary'],
];

export default function Accounting() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tab, setTab] = useState<Tab>('entries');
  const [month, setMonth] = useState<string | null>(thisMonth());
  const [range, setRange] = useState<[string, string]>(monthRange(thisMonth()));
  const [reloadKey, setReloadKey] = useState(0);

  const loadMe = () => accCall<Me>({ action: 'me' }).then((r) => {
    if (r.error) { setError(r.error); return; }
    setMe(r); setCategories(r.categories);
    return r;
  });

  useEffect(() => {
    loadMe().then((r) => {
      const first = r && TABS.find(([, , , a]) => r.actions.includes(a));
      if (first) setTab(first[0]);
    });
  }, []);

  const can = (a: string) => !!me && (me.is_deputy || me.actions.includes(a));
  const tabs = useMemo(() => TABS.filter(([, , , a]) => me && (me.is_deputy || me.actions.includes(a))), [me]);
  const pickMonth = (m: string) => { setMonth(m); setRange(monthRange(m)); };
  const bump = () => setReloadKey((k) => k + 1);

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!me) return <div className="flex justify-center py-20"><Icon name="Loader2" size={24} className="animate-spin text-muted-foreground" /></div>;
  if (tabs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <Icon name="Lock" size={32} />
        <p className="text-sm">У вашей должности нет доступа к бухгалтерии. Его настраивает заместитель директора в админ-панели.</p>
      </div>
    );
  }

  const withPeriod = tab === 'entries' || tab === 'profit' || tab === 'dds';
  const readOnly = !['accounting.edit_entries', 'accounting.edit_salary', 'accounting.edit_budget', 'accounting.edit_counterparties'].some(can);

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold tracking-tight">Бухгалтерия</h1>
          <p className="text-sm text-muted-foreground">Деньги, прибыль, бюджет, контрагенты и зарплата</p>
        </div>
        {readOnly && (
          <span className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground"><Icon name="Eye" size={13} />Только просмотр</span>
        )}
      </div>

      {(can('accounting.close_month') || can('accounting.edit_entries')) && (
        <PeriodsBar canClose={can('accounting.close_month')} canSync={can('accounting.edit_entries') || can('accounting.close_month')} onChanged={bump} />
      )}

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

      {tab === 'entries' && (
        <EntriesTab from={range[0]} to={range[1]} canEdit={can('accounting.edit_entries')} canDelete={can('accounting.delete_entries')}
          categories={categories} counterparties={me.counterparties} reloadKey={reloadKey} onCategories={setCategories} />
      )}
      {tab === 'profit' && <ProfitTab key={reloadKey} from={range[0]} to={range[1]} />}
      {tab === 'dds' && <DdsTab from={range[0]} to={range[1]} reloadKey={reloadKey} />}
      {tab === 'budget' && <BudgetTab canEdit={can('accounting.edit_budget')} reloadKey={reloadKey} />}
      {tab === 'counterparties' && <CounterpartiesTab canEdit={can('accounting.edit_counterparties')} onChanged={() => loadMe()} />}
      {tab === 'salary' && <SalaryTab canEdit={can('accounting.edit_salary')} reloadKey={reloadKey} />}
    </div>
  );
}
