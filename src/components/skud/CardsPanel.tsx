import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { fmtDate, skudCall, type Employee, type SkudCard } from '@/lib/skudApi';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cards: SkudCard[];
  employees: Employee[];
  onChanged: (cards: SkudCard[]) => void;
}

const EMPTY = { id: '', card: '', profile_id: '', label: '', valid_to: '' };

export default function CardsPanel({ open, onOpenChange, cards, employees, onChanged }: Props) {
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [doorWait, setDoorWait] = useState(false);
  const cardRef = useRef<HTMLInputElement>(null);

  const startAdd = (c?: SkudCard) => {
    setForm(c ? { id: c.id, card: c.card, profile_id: c.profile_id || '', label: c.label || '', valid_to: c.valid_to || '' } : EMPTY);
    setAdding(true); setError(null); setHint(null);
    setTimeout(() => cardRef.current?.focus(), 50);
  };

  // Считыватель TS-RDR-USB-EM «печатает» номер карты и нажимает Enter — сразу проверяем номер.
  const check = async (val: string) => {
    if (!val.trim()) return;
    const r = await skudCall<{ card: string; valid: boolean; owner: string | null }>({ action: 'card_check', card: val });
    if (r.error) return;
    if (!r.valid) { setHint(null); setError('Не похоже на номер карты. Поднесите карту ещё раз'); return; }
    setForm((f) => ({ ...f, card: r.card }));
    setError(null);
    setHint(r.owner && !form.id ? `Эта карта уже записана на ${r.owner}` : `Карта ${r.card} считана`);
  };

  // Запасной способ — поднести карту к считывателю на двери склада.
  useEffect(() => {
    if (!doorWait) return;
    let stop = false;
    skudCall({ action: 'enroll_start' });
    const t = setInterval(async () => {
      const r = await skudCall<{ card: string | null; waiting: boolean }>({ action: 'enroll_poll' });
      if (stop) return;
      if (r.card) { setForm((f) => ({ ...f, card: r.card! })); setHint(`Карта ${r.card} считана на двери`); setDoorWait(false); }
      else if (!r.waiting) setDoorWait(false);
    }, 1500);
    return () => { stop = true; clearInterval(t); };
  }, [doorWait]);

  const save = async () => {
    setBusy(true); setError(null);
    const r = await skudCall<{ cards: SkudCard[] }>({ action: 'card_save', ...form });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    onChanged(r.cards); setAdding(false); setForm(EMPTY);
  };

  const act = async (action: string, extra: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    const r = await skudCall<{ cards: SkudCard[] }>({ action, ...extra });
    if (r.error) alert(r.error); else onChanged(r.cards);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setAdding(false); setDoorWait(false); } }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Ключ-карты сотрудников</DialogTitle></DialogHeader>

        {adding ? (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Номер карты</label>
              <Input ref={cardRef} value={form.card} placeholder="Поднесите карту к USB-считывателю"
                onChange={(e) => setForm({ ...form, card: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); check(form.card); } }}
                onBlur={() => check(form.card)} className="font-mono" />
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>Курсор в поле → поднесите карту к считывателю TS-RDR-USB-EM.</span>
                <button onClick={() => setDoorWait(!doorWait)} className="text-primary hover:underline">
                  {doorWait ? 'Отменить ожидание' : 'Или считать на двери склада'}
                </button>
              </div>
              {doorWait && <p className="mt-2 flex items-center gap-2 text-sm text-primary"><Icon name="Loader2" size={14} className="animate-spin" />Поднесите новую карту к считывателю на двери (2 мин)…</p>}
              {hint && <p className="mt-2 text-sm text-emerald-600">{hint}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Сотрудник</label>
              <select value={form.profile_id} onChange={(e) => setForm({ ...form, profile_id: e.target.value })}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                <option value="">— не привязана (гостевая / запасная) —</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.department ? ` · ${e.department}` : ''}</option>)}
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Подпись <span className="text-muted-foreground">(необязательно)</span></label>
                <Input value={form.label} placeholder="Например: брелок синий" onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Действует до <span className="text-muted-foreground">(необязательно)</span></label>
                <Input type="date" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAdding(false)}>Отмена</Button>
              <Button onClick={save} disabled={busy || !form.card}>{busy ? 'Сохраняю…' : form.id ? 'Сохранить' : 'Записать карту'}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Button onClick={() => startAdd()} className="w-full"><Icon name="Plus" size={16} />Записать новую карту</Button>
            {cards.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Карт пока нет</p>}
            <div className="divide-y rounded-xl border">
              {cards.map((c) => (
                <div key={c.id} className={`flex items-center gap-3 px-3 py-2.5 ${c.status === 'blocked' ? 'opacity-60' : ''}`}>
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${c.status === 'blocked' ? 'bg-red-500/10 text-red-600' : 'bg-primary/10 text-primary'}`}>
                    <Icon name={c.status === 'blocked' ? 'Ban' : 'IdCard'} fallback="CreditCard" size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.name || 'Не привязана'}{c.label ? <span className="font-normal text-muted-foreground"> · {c.label}</span> : null}</div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-mono">{c.card}</span>
                      {c.status === 'blocked' && <span className="ml-2 text-red-600">заблокирована</span>}
                      {c.valid_to && <span className="ml-2">до {fmtDate(c.valid_to)}</span>}
                      {c.last_used && <span className="ml-2">проход {fmtDate(c.last_used)}</span>}
                      {!c.synced && <span className="ml-2 text-amber-600">ждёт отправки на дверь</span>}
                    </div>
                  </div>
                  <button title="Изменить" onClick={() => startAdd(c)} className="rounded-lg p-2 hover:bg-secondary"><Icon name="Pencil" size={15} /></button>
                  {c.status === 'active' ? (
                    <button title="Заблокировать" onClick={() => act('card_status', { id: c.id, status: 'blocked' })} className="rounded-lg p-2 text-amber-600 hover:bg-amber-500/10"><Icon name="Lock" size={15} /></button>
                  ) : (
                    <button title="Разблокировать" onClick={() => act('card_status', { id: c.id, status: 'active' })} className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-500/10"><Icon name="LockOpen" size={15} /></button>
                  )}
                  <button title="Удалить" onClick={() => act('card_delete', { id: c.id }, `Удалить карту ${c.card}${c.name ? ` (${c.name})` : ''}? Проходы в журнале сохранятся.`)}
                    className="rounded-lg p-2 text-destructive hover:bg-destructive/10"><Icon name="Trash2" size={15} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
