import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import DocForm from '@/components/inventory/DocForm';
import DocView from '@/components/inventory/DocView';
import ItemForm from '@/components/inventory/ItemForm';
import { rub } from '@/lib/accountingApi';
import { DocKind, InvDoc, InvItem, InvOverview, invCall, KIND_STYLE, matches, normCode, qtyFmt } from '@/lib/inventoryApi';

type Tab = 'items' | 'docs';

export default function Inventory() {
  const [data, setData] = useState<InvOverview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<Tab>('items');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [docQ, setDocQ] = useState('');
  const [docs, setDocs] = useState<InvDoc[] | null>(null);
  const [form, setForm] = useState<{ kind: DocKind; preset?: InvItem | null } | null>(null);
  const [itemEdit, setItemEdit] = useState<Partial<InvItem> | null>(null);
  const [viewDoc, setViewDoc] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await invCall<InvOverview>({ action: 'overview' });
    if (r.error) { setError(r.error); return; }
    setData(r); setDocs(null);
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (tab !== 'docs' || !docQ.trim()) { setDocs(null); return; }
    const t = setTimeout(async () => {
      const r = await invCall<{ docs: InvDoc[] }>({ action: 'docs', q: docQ });
      if (!r.error) setDocs(r.docs);
    }, 300);
    return () => clearTimeout(t);
  }, [docQ, tab]);

  const items = useMemo(() => (data?.items || []).filter(i => (cat === 'all' || i.category === cat) && matches(i, q)), [data, q, cat]);
  const totalSum = useMemo(() => items.reduce((s, i) => s + Number(i.qty) * Number(i.price), 0), [items]);

  const done = (msg: string) => { setForm(null); setItemEdit(null); setNotice(msg); load(); };

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!data) return <div className="flex justify-center py-20"><Icon name="Loader2" size={24} className="animate-spin text-muted-foreground" /></div>;

  const exact = q.trim() ? data.items.find(i => i.code === normCode(q)) : undefined;
  const docList = docs ?? data.docs;

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="page-title text-[22px] text-foreground sm:text-2xl">Инвентаризация</h1>
          <p className="text-sm text-muted-foreground">Оборудование и посуда: учёт, приход, списание, пересчёт</p>
        </div>
        {data.can_edit && <Button variant="outline" onClick={() => setItemEdit({})}><Icon name="Plus" size={16} />Новый предмет</Button>}
        {data.can_edit && <Button variant="outline" onClick={() => setForm({ kind: 'income' })}><Icon name="PackagePlus" size={16} />Приход</Button>}
        {data.can_edit && <Button variant="outline" onClick={() => setForm({ kind: 'recount' })}><Icon name="ClipboardCheck" size={16} />Пересчёт</Button>}
        {data.can_writeoff && <Button className="bg-red-600 hover:bg-red-700" onClick={() => setForm({ kind: 'writeoff' })}><Icon name="PackageMinus" size={16} />Списать</Button>}
      </div>

      {notice && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-800">
          <Icon name="CheckCircle2" size={18} className="mt-0.5 shrink-0" /><span className="flex-1">{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Закрыть"><Icon name="X" size={16} /></button>
        </div>
      )}

      <div className="flex rounded-lg bg-secondary p-0.5 self-start">
        {([['items', 'Предметы на учёте'], ['docs', 'Документы']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm ${tab === k ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground'}`}>{l}</button>
        ))}
      </div>

      {tab === 'items' ? (
        <>
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Icon name="Search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск по названию или номеру" className="pl-8" />
            </div>
            <select value={cat} onChange={e => setCat(e.target.value)} className="h-10 rounded-md border border-input bg-card px-2 text-sm">
              <option value="all">Все группы</option>
              {Object.entries(data.categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {exact && data.can_writeoff && exact.qty > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 text-sm">
              <span>Найден <b className="font-mono">{exact.code}</b> — {exact.name}, на учёте {qtyFmt(exact.qty)} {exact.unit}</span>
              <Button size="sm" className="ml-auto bg-red-600 hover:bg-red-700" onClick={() => setForm({ kind: 'writeoff', preset: exact })}>Списать</Button>
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2">Номер</th><th>Наименование</th><th className="hidden sm:table-cell">Группа</th><th className="hidden md:table-cell">Место</th>
                <th className="text-right">Кол-во</th><th className="hidden text-right sm:table-cell">Сумма</th><th className="w-24" />
              </tr></thead>
              <tbody className="divide-y divide-border">
                {items.map(i => (
                  <tr key={i.id} className="hover:bg-secondary/50">
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-primary">{i.code}</td>
                    <td><button onClick={() => data.can_edit && setItemEdit(i)} className="text-left hover:underline">{i.name}</button></td>
                    <td className="hidden text-xs text-muted-foreground sm:table-cell">{data.categories[i.category] || i.category}</td>
                    <td className="hidden text-xs text-muted-foreground md:table-cell">{i.location || '—'}</td>
                    <td className={`text-right font-medium ${Number(i.qty) === 0 ? 'text-muted-foreground' : ''}`}>{qtyFmt(i.qty)} {i.unit}</td>
                    <td className="hidden text-right sm:table-cell">{rub(Number(i.qty) * Number(i.price))}</td>
                    <td className="px-2 text-right">
                      {data.can_writeoff && Number(i.qty) > 0 && (
                        <button onClick={() => setForm({ kind: 'writeoff', preset: i })} className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600" title="Списать"><Icon name="PackageMinus" size={16} /></button>
                      )}
                      {data.can_edit && (
                        <button onClick={() => setForm({ kind: 'income', preset: i })} className="rounded p-1 text-muted-foreground hover:bg-emerald-50 hover:text-emerald-600" title="Приход"><Icon name="PackagePlus" size={16} /></button>
                      )}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">{data.items.length ? 'Ничего не найдено' : 'Пока нет предметов. Нажмите «Новый предмет», чтобы поставить на учёт.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-right text-sm text-muted-foreground">Позиций: {items.length} · на сумму <b className="text-foreground">{rub(totalSum)}</b></p>
        </>
      ) : (
        <>
          <div className="relative">
            <Icon name="Search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={docQ} onChange={e => setDocQ(e.target.value)} placeholder="Найти документ по номеру, названию предмета или причине" className="pl-8" />
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2">Номер</th><th>Вид</th><th>Дата</th><th className="hidden sm:table-cell">Причина / основание</th>
                <th className="text-right">Позиций</th><th className="hidden text-right sm:table-cell">Сумма</th><th className="hidden md:table-cell">Оформил</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {docList.map(d => (
                  <tr key={d.id} onClick={() => setViewDoc(d.id)} className="cursor-pointer hover:bg-secondary/50">
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-primary">{d.number}</td>
                    <td><span className={`rounded-full border px-2 py-0.5 text-xs ${KIND_STYLE[d.kind]}`}>{data.kinds[d.kind]}</span></td>
                    <td>{new Date(d.doc_date).toLocaleDateString('ru-RU')}</td>
                    <td className="hidden max-w-[240px] truncate text-xs text-muted-foreground sm:table-cell">{d.reason || '—'}</td>
                    <td className="text-right">{String(d.lines)}</td>
                    <td className="hidden text-right sm:table-cell">{d.kind === 'recount' ? '—' : rub(Number(d.total))}</td>
                    <td className="hidden text-xs text-muted-foreground md:table-cell">{d.created_by}</td>
                  </tr>
                ))}
                {docList.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Документов не найдено</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {form && <DocForm kind={form.kind} preset={form.preset} items={data.items} reasons={data.reasons} onClose={() => setForm(null)}
        onDone={n => done(`Документ № ${n} проведён`)} />}
      {itemEdit && <ItemForm item={itemEdit} categories={data.categories} onClose={() => setItemEdit(null)} onDone={done} />}
      {viewDoc && <DocView id={viewDoc} onClose={() => setViewDoc(null)} />}
    </div>
  );
}
