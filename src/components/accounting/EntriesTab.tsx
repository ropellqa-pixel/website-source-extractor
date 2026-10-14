import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { accCall, fmtDay, rub, today, type Category, type Entry, type Kind } from '@/lib/accountingApi';

interface Props {
  from: string;
  to: string;
  canEdit: boolean;
  categories: Category[];
  onCategories: (c: Category[]) => void;
}

const EMPTY = { id: 0, kind: 'expense' as Kind, date: today(), amount: '', category_id: '', comment: '' };

export default function EntriesTab({ from, to, canEdit, categories, onCategories }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<'all' | Kind>('all');
  const [cat, setCat] = useState('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCat, setNewCat] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await accCall<{ entries: Entry[] }>({ action: 'entries', date_from: from, date_to: to });
    if (!r.error) setEntries(r.entries);
    setLoading(false);
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => entries.filter((e) =>
    (kind === 'all' || e.kind === kind) && (!cat || String(e.category_id) === cat) &&
    (!search || `${e.comment || ''} ${e.category}`.toLowerCase().includes(search.toLowerCase()))), [entries, kind, cat, search]);

  const income = list.filter((e) => e.kind === 'income').reduce((s, e) => s + e.amount, 0);
  const expense = list.filter((e) => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);

  const save = async () => {
    if (!form) return;
    setBusy(true); setError(null);
    const r = await accCall({ action: 'entry_save', ...form, id: form.id || undefined, category_id: form.category_id ? Number(form.category_id) : null });
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
          {categories.filter((c) => kind === 'all' || c.kind === kind).map((c) => (
            <option key={c.id} value={c.id}>{c.kind === 'income' ? '↑' : '↓'} {c.name}</option>
          ))}
        </select>
        <Input placeholder="Поиск по комментарию" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-56" />
        {canEdit && (
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setForm({ ...EMPTY, kind: 'income', date: today() }); setError(null); }}>
              <Icon name="Plus" size={15} />Доход
            </Button>
            <Button size="sm" onClick={() => { setForm({ ...EMPTY, date: today() }); setError(null); }}>
              <Icon name="Plus" size={15} />Расход
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
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
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2.5 font-medium">Дата</th>
                <th className="px-4 py-2.5 font-medium">Статья</th>
                <th className="px-4 py-2.5 font-medium">Комментарий</th>
                <th className="px-4 py-2.5 text-right font-medium">Сумма</th>
                {canEdit && <th className="w-20" />}
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className="border-b last:border-0 hover:bg-secondary/40">
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{fmtDay(e.date)}</td>
                  <td className="px-4 py-2.5">{e.category}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{e.comment}</td>
                  <td className={`whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums ${e.kind === 'income' ? 'text-emerald-600' : 'text-red-600'}`}>
                    {e.kind === 'income' ? '+' : '−'}{rub(e.amount)}
                  </td>
                  {canEdit && (
                    <td className="px-2 py-2.5 text-right">
                      {e.from_salary ? (
                        <span title="Создано выплатой зарплаты" className="px-2 text-muted-foreground"><Icon name="Banknote" size={15} /></span>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <button onClick={() => { setForm({ id: e.id, kind: e.kind, date: e.date, amount: String(e.amount), category_id: e.category_id ? String(e.category_id) : '', comment: e.comment || '' }); setError(null); }}
                            className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"><Icon name="Pencil" size={14} /></button>
                          <button onClick={() => remove(e)} className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-red-600"><Icon name="Trash2" size={14} /></button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{form?.id ? 'Изменить операцию' : form?.kind === 'income' ? 'Новый доход' : 'Новый расход'}</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="flex rounded-lg bg-secondary p-0.5">
                {([['income', 'Доход'], ['expense', 'Расход']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setForm({ ...form, kind: k, category_id: '' })}
                    className={`flex-1 rounded-md py-1.5 text-sm font-medium ${form.kind === k ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>{l}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Дата</span>
                  <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Сумма, ₽</span>
                  <Input inputMode="decimal" value={form.amount} placeholder="0" onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">Статья</span>
                <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="">— выберите —</option>
                  {formCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <div className="flex gap-2">
                <Input placeholder="Новая статья, например «Реклама»" value={newCat} onChange={(e) => setNewCat(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCategory()} className="h-9" />
                <Button size="sm" variant="outline" onClick={addCategory} disabled={!newCat.trim()}>Добавить</Button>
              </div>
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
