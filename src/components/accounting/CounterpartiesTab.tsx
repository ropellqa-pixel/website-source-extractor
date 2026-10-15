import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { accCall, fmtDay, rub, today } from '@/lib/accountingApi';

interface Cp {
  id: number; name: string; kind: string; kind_label: string; inn: string | null; phone: string | null; comment: string | null; archived: boolean;
  got: number; gave: number; paid: number; received: number; we_owe: number; they_owe: number;
}
interface Hist { type: 'doc' | 'pay'; id: number; date: string; direction: string; amount: number; comment: string | null; label: string }

const KINDS: Record<string, string> = { supplier: 'Поставщик', customer: 'Покупатель', landlord: 'Арендодатель', other: 'Прочее' };

export default function CounterpartiesTab({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const [list, setList] = useState<Cp[]>([]);
  const [sel, setSel] = useState<Cp | null>(null);
  const [hist, setHist] = useState<Hist[]>([]);
  const [form, setForm] = useState<Partial<Cp> | null>(null);
  const [doc, setDoc] = useState<{ direction: 'in' | 'out'; date: string; amount: string; comment: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await accCall<{ counterparties: Cp[] }>({ action: 'counterparties' });
    if (!r.error) setList(r.counterparties);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openCp = async (c: Cp) => {
    setSel(c); setDoc(null);
    const r = await accCall<{ history: Hist[] }>({ action: 'cp_history', id: c.id });
    setHist(r.error ? [] : r.history);
  };

  const saveCp = async () => {
    if (!form) return;
    const r = await accCall({ action: 'counterparty_save', ...form });
    if (r.error) { setError(r.error); return; }
    setForm(null); setError(null); load(); onChanged();
  };

  const saveDoc = async () => {
    if (!doc || !sel) return;
    const r = await accCall({ action: 'cp_doc_save', counterparty_id: sel.id, ...doc });
    if (r.error) { setError(r.error); return; }
    setDoc(null); setError(null);
    await load();
    openCp(sel);
  };

  const delDoc = async (h: Hist) => {
    if (!sel || !confirm('Удалить документ?')) return;
    await accCall({ action: 'cp_doc_delete', id: h.id });
    await load();
    openCp(sel);
  };

  const weOwe = list.reduce((s, c) => s + c.we_owe, 0);
  const theyOwe = list.reduce((s, c) => s + c.they_owe, 0);
  const current = sel ? list.find((c) => c.id === sel.id) || sel : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border bg-card p-3.5"><div className="text-xs text-muted-foreground">Мы должны (кредиторка)</div><div className="mt-1 text-xl font-semibold tabular-nums text-red-600">{rub(weOwe)}</div></div>
        <div className="rounded-2xl border bg-card p-3.5"><div className="text-xs text-muted-foreground">Нам должны (дебиторка)</div><div className="mt-1 text-xl font-semibold tabular-nums text-emerald-600">{rub(theyOwe)}</div></div>
        {canEdit && <div className="flex items-center justify-end"><Button onClick={() => setForm({ kind: 'supplier', name: '' })}><Icon name="Plus" size={15} />Контрагент</Button></div>}
      </div>
      <p className="text-xs text-muted-foreground">
        Долг считается так: получили от контрагента товар/услугу (документ) минус оплатили ему (расход с этим контрагентом). Оплаты вносятся во вкладке «Доходы и расходы» с выбором контрагента.
      </p>
      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border bg-card">
        {list.length === 0 ? <p className="py-16 text-center text-sm text-muted-foreground">Контрагентов пока нет</p> : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
              <tr className="border-b"><th className="px-4 py-2.5 font-medium">Контрагент</th><th className="px-4 py-2.5 text-right font-medium">Получено от него</th><th className="px-4 py-2.5 text-right font-medium">Оплачено ему</th><th className="px-4 py-2.5 text-right font-medium">Мы должны</th><th className="px-4 py-2.5 text-right font-medium">Нам должны</th></tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} onClick={() => openCp(c)} className={`cursor-pointer border-b last:border-0 hover:bg-secondary/40 ${c.archived ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-2.5"><div className="font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{c.kind_label}{c.inn ? ` · ИНН ${c.inn}` : ''}</div></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{rub(c.got)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{rub(c.paid)}</td>
                  <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${c.we_owe ? 'text-red-600' : 'text-muted-foreground'}`}>{rub(c.we_owe)}</td>
                  <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${c.they_owe ? 'text-emerald-600' : 'text-muted-foreground'}`}>{rub(c.they_owe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{form?.id ? 'Контрагент' : 'Новый контрагент'}</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-2">
              <Input placeholder="Название" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="h-10 rounded-md border bg-background px-2 text-sm">
                  {Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <Input placeholder="ИНН" value={form.inn || ''} onChange={(e) => setForm({ ...form, inn: e.target.value })} />
              </div>
              <Input placeholder="Телефон" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <Input placeholder="Комментарий" value={form.comment || ''} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
              {form.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.archived} onChange={(e) => setForm({ ...form, archived: e.target.checked })} />В архиве</label>}
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button className="w-full" onClick={saveCp}>Сохранить</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!current && !form} onOpenChange={(v) => !v && setSel(null)}>
        <DialogContent className="max-w-2xl">
          {current && (
            <>
              <DialogHeader><DialogTitle>{current.name}</DialogTitle></DialogHeader>
              <div className="-mt-2 flex flex-wrap items-center gap-3 text-sm">
                <span className="text-muted-foreground">{current.kind_label}{current.phone ? ` · ${current.phone}` : ''}</span>
                {current.we_owe > 0 && <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-red-700">мы должны {rub(current.we_owe)}</span>}
                {current.they_owe > 0 && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700">нам должны {rub(current.they_owe)}</span>}
                {canEdit && <button onClick={() => setForm(current)} className="ml-auto text-primary hover:underline">изменить</button>}
              </div>
              {canEdit && (doc ? (
                <div className="space-y-2 rounded-xl border p-3">
                  <div className="flex flex-wrap rounded-lg bg-secondary p-0.5">
                    {([['in', 'Получили товар/услугу'], ['out', 'Отгрузили/оказали']] as const).map(([k, l]) => (
                      <button key={k} onClick={() => setDoc({ ...doc, direction: k })} className={`flex-1 rounded-md py-1.5 text-xs font-medium ${doc.direction === k ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>{l}</button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="date" value={doc.date} onChange={(e) => setDoc({ ...doc, date: e.target.value })} />
                    <Input inputMode="decimal" placeholder="Сумма" value={doc.amount} onChange={(e) => setDoc({ ...doc, amount: e.target.value })} />
                  </div>
                  <Input placeholder="Комментарий: накладная №, счёт…" value={doc.comment} onChange={(e) => setDoc({ ...doc, comment: e.target.value })} />
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <div className="flex gap-2"><Button size="sm" onClick={saveDoc}>Добавить</Button><Button size="sm" variant="ghost" onClick={() => setDoc(null)}>Отмена</Button></div>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="w-fit" onClick={() => setDoc({ direction: 'in', date: today(), amount: '', comment: '' })}>
                  <Icon name="FilePlus" size={15} />Документ (накладная, акт, счёт)
                </Button>
              ))}
              <div className="max-h-80 overflow-auto rounded-xl border">
                {hist.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Движений нет</p> : hist.map((h) => (
                  <div key={h.type + h.id} className="flex items-center gap-3 border-b px-3 py-2 text-sm last:border-0">
                    <span className="w-20 tabular-nums text-muted-foreground">{fmtDay(String(h.date))}</span>
                    <span className="flex-1">{h.label}{h.comment ? <span className="text-muted-foreground"> · {h.comment}</span> : ''}</span>
                    <span className="tabular-nums font-medium">{rub(h.amount)}</span>
                    {canEdit && h.type === 'doc' && <button onClick={() => delDoc(h)} className="text-muted-foreground hover:text-red-600"><Icon name="Trash2" size={14} /></button>}
                  </div>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
