import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { DocKind, InvItem, invCall, matches, qtyFmt } from '@/lib/inventoryApi';

interface Line { item: InvItem; qty: string; price: string }

const TITLES: Record<DocKind, string> = { income: 'Приход', writeoff: 'Списание', recount: 'Пересчёт (инвентаризация)' };

export default function DocForm({ kind, items, reasons, preset, onClose, onDone }: {
  kind: DocKind; items: InvItem[]; reasons: string[]; preset?: InvItem | null; onClose: () => void; onDone: (number: string) => void;
}) {
  const [lines, setLines] = useState<Line[]>(preset ? [{ item: preset, qty: kind === 'recount' ? String(preset.qty) : '1', price: String(preset.price || '') }] : []);
  const [q, setQ] = useState('');
  const [reason, setReason] = useState(kind === 'writeoff' ? reasons[0] || '' : '');
  const [comment, setComment] = useState('');
  const [docDate, setDocDate] = useState(new Date().toLocaleDateString('sv-SE'));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const found = useMemo(() => {
    if (!q.trim()) return [];
    const used = new Set(lines.map(l => l.item.id));
    return items.filter(i => !used.has(i.id) && matches(i, q) && (kind !== 'writeoff' || i.qty > 0)).slice(0, 8);
  }, [q, items, lines, kind]);

  const add = (it: InvItem) => {
    setLines(l => [...l, { item: it, qty: kind === 'recount' ? String(it.qty) : '1', price: String(it.price || '') }]);
    setQ('');
  };
  const setLine = (i: number, patch: Partial<Line>) => setLines(l => l.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  const submit = async () => {
    setError(''); setBusy(true);
    const r = await invCall<{ number: string }>({
      action: 'doc_create', kind, doc_date: docDate, reason, comment,
      lines: lines.map(l => ({ item_id: l.item.id, qty: l.qty, price: kind === 'income' ? l.price : undefined })),
    });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    onDone(r.number);
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{TITLES[kind]}</DialogTitle></DialogHeader>
        <p className="-mt-2 text-xs text-muted-foreground">Номер документа присвоится автоматически (2 буквы и 4 цифры).</p>

        <div className="relative">
          <Icon name="Search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Найти предмет по названию или номеру (например, АК4521)" className="pl-8" autoFocus />
          {found.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
              {found.map(it => (
                <button key={it.id} onClick={() => add(it)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary">
                  <span className="font-mono text-xs text-primary">{it.code}</span>
                  <span className="flex-1 truncate">{it.name}</span>
                  <span className="text-xs text-muted-foreground">на учёте {qtyFmt(it.qty)} {it.unit}</span>
                </button>
              ))}
            </div>
          )}
          {q.trim() && found.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Ничего не найдено{kind === 'writeoff' ? ' (или остаток равен нулю)' : ''}.</p>}
        </div>

        <div className="space-y-2">
          {lines.length === 0 && <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Добавьте предметы через поиск выше</p>}
          {lines.map((l, i) => {
            const n = Number(l.qty.replace(',', '.'));
            const over = kind === 'writeoff' && n > l.item.qty;
            return (
              <div key={l.item.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.item.name}</p>
                  <p className="text-xs text-muted-foreground"><span className="font-mono">{l.item.code}</span> · на учёте {qtyFmt(l.item.qty)} {l.item.unit}</p>
                </div>
                <label className="w-24 text-[11px] text-muted-foreground">{kind === 'recount' ? 'Факт' : 'Кол-во'}
                  <Input value={l.qty} onChange={e => setLine(i, { qty: e.target.value })} inputMode="decimal" className={`h-9 ${over ? 'border-red-500' : ''}`} />
                </label>
                {kind === 'income' && (
                  <label className="w-28 text-[11px] text-muted-foreground">Цена, ₽
                    <Input value={l.price} onChange={e => setLine(i, { price: e.target.value })} inputMode="decimal" className="h-9" />
                  </label>
                )}
                {kind === 'recount' && !Number.isNaN(n) && (
                  <span className={`w-20 text-right text-xs font-medium ${n - l.item.qty < 0 ? 'text-red-600' : n - l.item.qty > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                    {n - l.item.qty > 0 ? '+' : ''}{qtyFmt(n - l.item.qty)}
                  </span>
                )}
                <button onClick={() => setLines(x => x.filter((_, k) => k !== i))} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-red-600" aria-label="Убрать">
                  <Icon name="X" size={16} />
                </button>
                {over && <p className="w-full text-xs text-red-600">Нельзя списать больше, чем на учёте ({qtyFmt(l.item.qty)} {l.item.unit})</p>}
              </div>
            );
          })}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">Дата
            <Input type="date" value={docDate} onChange={e => setDocDate(e.target.value)} className="h-9" />
          </label>
          {kind === 'writeoff' ? (
            <label className="text-xs text-muted-foreground">Причина списания
              <select value={reason} onChange={e => setReason(e.target.value)} className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground">
                {reasons.map(r => <option key={r}>{r}</option>)}
              </select>
            </label>
          ) : (
            <label className="text-xs text-muted-foreground">Основание
              <Input value={reason} onChange={e => setReason(e.target.value)} placeholder={kind === 'income' ? 'Накладная поставщика, покупка…' : 'Плановая инвентаризация…'} className="h-9" />
            </label>
          )}
          <label className="text-xs text-muted-foreground sm:col-span-2">Комментарий
            <Input value={comment} onChange={e => setComment(e.target.value)} placeholder="Кто разбил, где обнаружено, номер накладной…" className="h-9" />
          </label>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button onClick={submit} disabled={busy || lines.length === 0} className={kind === 'writeoff' ? 'bg-red-600 hover:bg-red-700' : ''}>
          {busy ? <Icon name="Loader2" size={16} className="animate-spin" /> : <Icon name="Check" size={16} />}
          Провести {TITLES[kind].toLowerCase()}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
