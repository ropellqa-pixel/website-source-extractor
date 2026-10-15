import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import BankImport from './BankImport';
import { accCall, fmtDay, monthLabel, recentMonths, rub, thisMonth, today, type Category, type CounterpartyRef, type DueMap, type Entry, type Kind } from '@/lib/accountingApi';

interface Props {
  from: string;
  to: string;
  canEdit: boolean;
  canDelete: boolean;
  categories: Category[];
  counterparties: CounterpartyRef[];
  reloadKey: number;
  onCategories: (c: Category[]) => void;
}

const EMPTY = { id: 0, kind: 'expense' as Kind, date: today(), period: thisMonth(), amount: '', category_id: '', comment: '', counterparty_id: '' };

export default function EntriesTab({ from, to, canEdit, canDelete, categories, counterparties, reloadKey, onCategories }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<'all' | Kind>('all');
  const [cat, setCat] = useState('');
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<'all' | 'own' | 'collection' | 'salary' | 'bank'>('all');
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [due, setDue] = useState<DueMap>({});

  const formPeriod = form?.period;
  const formId = form?.id;
  useEffect(() => {
    if (!formPeriod) return;
    accCall<{ due: DueMap }>({ action: 'salary_due', period: formPeriod, exclude_id: formId || 0 }).then((r) => { if (!r.error) setDue(r.due); });
  }, [formPeriod, formId]);

  useEffect(() => {
    setForm((f) => {
      const d = f && due[f.category_id];
      return f && d && !f.amount && d.left > 0 ? { ...f, amount: String(d.left) } : f;
    });
  }, [due]);

  const pickCategory = (category_id: string) => {
    if (!form) return;
    const d = due[category_id];
    const auto = d && d.left > 0 && (!form.amount || Number(form.amount) === due[form.category_id]?.left);
    setForm({ ...form, category_id, amount: auto ? String(d.left) : form.amount });
  };

  const [closed, setClosed] = useState<string[]>([]);
  const load = useCallback(async () => {
    setLoading(true);
    const r = await accCall<{ entries: Entry[]; closed: string[] }>({ action: 'entries', date_from: from, date_to: to });
    if (!r.error) { setEntries(r.entries); setClosed(r.closed); }
    setLoading(false);
  }, [from, to, reloadKey]);

  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => entries.filter((e) =>
    (kind === 'all' || e.kind === kind) && (!cat || String(e.category_id) === cat) &&
    (source === 'all' || (source === 'own' ? !e.linked : e.linked === source)) &&
    (!search || `${e.comment || ''} ${e.category}`.toLowerCase().includes(search.toLowerCase()))), [entries, kind, cat, search, source]);

  const income = list.filter((e) => e.kind === 'income').reduce((s, e) => s + e.amount, 0);
  const expense = list.filter((e) => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);

  const save = async () => {
    if (!form) return;
    setBusy(true); setError(null);
    const r = await accCall({ action: 'entry_save', ...form, id: form.id || undefined, category_id: form.category_id ? Number(form.category_id) : null, counterparty_id: form.counterparty_id ? Number(form.counterparty_id) : null });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setForm(null); load();
  };

  const remove = async (e: Entry) => {
    if (!confirm(`Удалить ${e.kind === 'income' ? 'доход' : 'расход'} на ${rub(e.amount)}?`)) return;
    const r = await accCall({ action: 'entry_delete', id: e.id });
    if (r.error) alert(r.error); else load();
  };

  const addCategory = async () => {
    if (!form || !newCat.trim()) return;
    const r = await accCall<{ categories: Category[] }>({ action: 'category_save', kind: form.kind, name: newCat });
    if (r.error) { setError(r.error); return; }
    onCategories(r.categories);
    const c = r.categories.find((x) => x.kind === form.kind && x.name.toLowerCase() === newCat.trim().toLowerCase());
    setForm({ ...form, category_id: c ? String(c.id) : form.category_id });
    setNewCat('');
  };

  const formCats = categories.filter((c) => form && c.kind === form.kind && (!c.archived || String(c.id) === form.category_id));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border p-0.5">
          {([['all', 'Все'], ['income', 'Доходы'], ['expense', 'Расходы']] as const).map(([k, l]) => (
            <button key={k} onClick={() => { setKind(k); setCat(''); }}
              className={`rounded-md px-3 py-1 text-sm ${kind === k ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'}`}>{l}</button>
          ))}
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm">
          <option value="">Все статьи</option>
          {categories.filter((c) => !c.archived && (kind === 'all' || c.kind === kind)).map((c) => (
            <option key={c.id} value={c.id}>{c.kind === 'income' ? '↑' : '↓'} {c.name}</option>
          ))}
        </select>
        <Input placeholder="Поиск по комментарию" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-full sm:w-56" />
        <select value={source} onChange={(e) => setSource(e.target.value as typeof source)} className="h-9 rounded-md border bg-background px-3 text-sm">
          <option value="all">Все источники</option>
          <option value="own">Внесено вручную</option>
          <option value="collection">Инкассация (факт)</option>
          <option value="salary">Зарплата по месяцам</option>
          <option value="bank">Выписка банка</option>
        </select>
        {canEdit && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <BankImport categories={categories} onDone={load} />
            <Button size="sm" variant="outline" onClick={() => { setForm({ ...EMPTY, kind: 'income', date: today() }); setError(null); }}>
              <Icon name="Plus" size={15} />Доход
            </Button>
            <Button size="sm" onClick={() => { setForm({ ...EMPTY, date: today() }); setError(null); }}>
              <Icon name="Plus" size={15} />Расход
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
        <Stat label="Доходы" value={rub(income)} cls="text-emerald-600" />
        <Stat label="Расходы" value={rub(expense)} cls="text-red-600" />
        <Stat label="Разница" value={rub(income - expense)} cls={income - expense >= 0 ? 'text-emerald-600' : 'text-red-600'} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border bg-card">
        {loading ? (
          <div className="flex justify-center py-16"><Icon name="Loader2" size={24} className="animate-spin text-muted-foreground" /></div>
        ) : list.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Операций за этот период нет</div>
        ) : (
          <>
          <div className="divide-y md:hidden">
            {list.map((e) => {
              const editable = !(e.linked && e.linked !== 'bank') && !closed.includes(String(e.date).slice(0, 7)) && !e.from_salary;
              return (
                <div key={e.id} className="space-y-1 p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium leading-snug">{e.category}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDay(e.date)}{e.linked === 'bank' ? ' · банк' : e.linked === 'collection' ? ' · из Инкассации' : e.linked ? ' · из Зарплаты' : ''}
                        {e.period && e.period !== String(e.date).slice(0, 7) && ` · за ${monthLabel(e.period).toLowerCase()}`}
                      </div>
                    </div>
                    <div className={`shrink-0 whitespace-nowrap font-semibold tabular-nums ${e.kind === 'income' ? 'text-emerald-600' : 'text-red-600'}`}>
                      {e.kind === 'income' ? '+' : '−'}{rub(e.amount)}
                    </div>
                  </div>
                  {(e.counterparty || e.comment) && (
                    <div className="break-words text-[13px] text-muted-foreground">{e.counterparty && <span className="font-medium text-foreground">{e.counterparty}. </span>}{e.comment}</div>
                  )}
                  {editable && (canEdit || canDelete) && (
                    <div className="flex gap-2 pt-1">
                      {canEdit && <Button size="sm" variant="outline" className="h-8" onClick={() => { setForm({ id: Number(e.id), kind: e.kind, date: String(e.date), period: e.period || String(e.date).slice(0, 7), amount: String(e.amount), category_id: e.category_id ? String(e.category_id) : '', comment: e.comment || '', counterparty_id: e.counterparty_id ? String(e.counterparty_id) : '' }); setError(null); }}><Icon name="Pencil" size={14} />Статья</Button>}
                      {canDelete && <Button size="sm" variant="outline" className="h-8 text-red-600" onClick={() => remove(e)}><Icon name="Trash2" size={14} /></Button>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <table className="hidden w-full text-sm md:table">
            <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2.5 font-medium">Дата</th>
                <th className="px-4 py-2.5 font-medium">Статья</th>
                <th className="px-4 py-2.5 font-medium">Комментарий</th>
                <th className="px-4 py-2.5 text-right font-medium">Сумма</th>
                {(canEdit || canDelete) && <th className="w-20" />}
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className="border-b last:border-0 hover:bg-secondary/40">
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{fmtDay(e.date)}</td>
                  <td className="px-4 py-2.5">
                    {e.category}
                    {e.linked === 'bank' && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground"><Icon name="Landmark" size={11} />банк</span>
                    )}
                    {e.linked && e.linked !== 'bank' && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                        <Icon name="Link" size={11} />{e.linked === 'collection' ? 'из Инкассации' : 'из Зарплаты'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{e.counterparty && <span className="mr-1 font-medium text-foreground">{e.counterparty}.</span>}{e.comment}</td>
                  <td className={`whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums ${e.kind === 'income' ? 'text-emerald-600' : 'text-red-600'}`}>
                    {e.kind === 'income' ? '+' : '−'}{rub(e.amount)}
                    {e.period && e.period !== String(e.date).slice(0, 7) && <div className="text-[11px] font-normal text-muted-foreground">за {monthLabel(e.period).toLowerCase()}</div>}
                  </td>
                  {(canEdit || canDelete) && (
                    <td className="px-2 py-2.5 text-right">
                      {e.linked && e.linked !== 'bank' ? null : closed.includes(String(e.date).slice(0, 7)) ? (
                        <span title="Месяц закрыт" className="px-2 text-muted-foreground"><Icon name="Lock" size={14} /></span>
                      ) : e.from_salary ? (
                        <span title="Создано выплатой зарплаты" className="px-2 text-muted-foreground"><Icon name="Banknote" size={15} /></span>
                      ) : (
                        <div className="flex justify-end gap-1">
                          {canEdit && <button onClick={() => { setForm({ id: Number(e.id), kind: e.kind, date: String(e.date), period: e.period || String(e.date).slice(0, 7), amount: String(e.amount), category_id: e.category_id ? String(e.category_id) : '', comment: e.comment || '', counterparty_id: e.counterparty_id ? String(e.counterparty_id) : '' }); setError(null); }}
                            className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"><Icon name="Pencil" size={14} /></button>}
                          {canDelete && <button onClick={() => remove(e)} className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-red-600"><Icon name="Trash2" size={14} /></button>}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
      </div>

      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{form?.id ? 'Изменить операцию' : form?.kind === 'income' ? 'Новый доход' : 'Новый расход'}</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="flex flex-wrap rounded-lg bg-secondary p-0.5">
                {([['income', 'Доход'], ['expense', 'Расход']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setForm({ ...form, kind: k, category_id: '' })}
                    className={`flex-1 rounded-md py-1.5 text-sm font-medium ${form.kind === k ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>{l}</button>
                ))}
              </div>
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">Статья</span>
                <select value={form.category_id} onChange={(e) => pickCategory(e.target.value)}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="">— выберите —</option>
                  {formCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">За какой месяц</span>
                <select value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                  {recentMonths(thisMonth()).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>
              </label>
              {due[form.category_id] && (
                <div className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-xs">
                  <Icon name="Calculator" size={14} className="shrink-0 text-muted-foreground" />
                  <span className="flex-1">
                    {form.kind === 'income' ? 'Инкассация по факту' : 'Начислено'} за {monthLabel(form.period).toLowerCase()}: <b>{rub(due[form.category_id].total)}</b>
                    {due[form.category_id].paid > 0 && <> · уже внесено {rub(due[form.category_id].paid)}</>}
                  </span>
                  {due[form.category_id].left > 0 && (
                    <button className="font-medium text-primary hover:underline" onClick={() => setForm({ ...form, amount: String(due[form.category_id].left) })}>
                      Подставить {rub(due[form.category_id].left)}
                    </button>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Дата оплаты</span>
                  <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Сумма, ₽</span>
                  <Input inputMode="decimal" value={form.amount} placeholder="0" onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </label>
              </div>
              <div className="flex gap-2">
                <Input placeholder="Новая статья, например «Реклама»" value={newCat} onChange={(e) => setNewCat(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCategory()} className="h-9" />
                <Button size="sm" variant="outline" onClick={addCategory} disabled={!newCat.trim()}>Добавить</Button>
              </div>
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">Контрагент (необязательно)</span>
                <select value={form.counterparty_id} onChange={(e) => setForm({ ...form, counterparty_id: e.target.value })}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="">— нет —</option>
                  {counterparties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">Комментарий</span>
                <Input value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
              </label>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button className="w-full" onClick={save} disabled={busy}>{busy ? 'Сохраняю…' : 'Сохранить'}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-2xl border bg-card p-3.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${cls || ''}`}>{value}</div>
    </div>
  );
}
