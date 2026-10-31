import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { fmtDate, skudCall, type Employee, type SkudCard, type SkudSchedule } from '@/lib/skudApi';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cards: SkudCard[];
  employees: Employee[];
  schedules: SkudSchedule[];
  isManager: boolean;
  onChanged: (cards: SkudCard[]) => void;
}

const EMPTY = { id: '', card: '', profile_id: '', label: '', valid_to: '', card_type: 'employee' as 'employee' | 'guest', schedule_id: '', pin: '', pin_clear: false, has_pin: false, rewrite: false, confirm_card: '' };

function daysTo(iso?: string) {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5));
}

export default function CardsPanel({ open, onOpenChange, cards, employees, schedules, isManager, onChanged }: Props) {
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [doorWait, setDoorWait] = useState(false);
  const cardRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [origCard, setOrigCard] = useState('');

  const startAdd = (c?: SkudCard, rewrite = false) => {
    setForm(c ? { id: c.id, card: rewrite ? '' : c.card, profile_id: c.profile_id || '', label: c.label || '', valid_to: c.valid_to || '', card_type: (c.card_type === 'guest' ? 'guest' : 'employee') as 'employee' | 'guest', schedule_id: c.schedule_id ? String(c.schedule_id) : '', pin: '', pin_clear: false, has_pin: c.has_pin, rewrite, confirm_card: '' } : EMPTY);
    setOrigCard(c && !rewrite ? c.card : '');
    setAdding(true); setError(null); setHint(null);
    setDoorWait(!c || rewrite);
  };

  const check = async (val: string) => {
    if (!val.trim()) return;
    const r = await skudCall<{ card: string; valid: boolean; owner: string | null }>({ action: 'card_check', card: val });
    if (r.error) return;
    if (!r.valid) { setHint(null); setError('Не похоже на номер карты. Поднесите карту ещё раз'); return; }
    setForm((f) => ({ ...f, card: r.card }));
    setError(null);
    setHint(r.owner && !form.id ? `Эта карта уже записана на ${r.owner}` : `Карта ${r.card} считана`);
    if (!(r.owner && !form.id)) setTimeout(() => confirmRef.current?.focus(), 50);
  };

  useEffect(() => {
    if (!doorWait) return;
    let stop = false;
    skudCall({ action: 'enroll_start' });
    const t = setInterval(async () => {
      const r = await skudCall<{ card: string | null; waiting: boolean }>({ action: 'enroll_poll' });
      if (stop) return;
      if (r.card) { setForm((f) => ({ ...f, card: r.card! })); setHint(`Карта ${r.card} считана на двери`); setDoorWait(false); setTimeout(() => confirmRef.current?.focus(), 50); }
      else if (!r.waiting) setDoorWait(false);
    }, 1000);
    return () => { stop = true; clearInterval(t); };
  }, [doorWait]);

  const save = async () => {
    setBusy(true); setError(null);
    const r = await skudCall<{ cards: SkudCard[] }>({ action: 'card_save', ...form, schedule_id: form.schedule_id || null });
    setBusy(false);
    if (r.error) { setError(r.error); setForm((f) => ({ ...f, confirm_card: '' })); setTimeout(() => confirmRef.current?.focus(), 50); return; }
    onChanged(r.cards); setAdding(false); setForm(EMPTY);
  };

  const act = async (action: string, extra: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    const r = await skudCall<{ cards: SkudCard[] }>({ action, ...extra });
    if (r.error) alert(r.error); else onChanged(r.cards);
  };

  const guest = form.card_type === 'guest';
  const needConfirm = !form.id || form.rewrite || form.card !== origCard;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setAdding(false); setDoorWait(false); } }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{adding ? (form.rewrite ? 'Перезапись карты' : form.id ? 'Карта' : 'Новая карта') : 'Ключ-карты'}</DialogTitle></DialogHeader>

        {adding ? (
          <div className="space-y-4">
            {!form.rewrite && (
              <div className="flex rounded-lg bg-secondary p-0.5">
                {([['employee', 'Сотрудника'], ['guest', 'Гостевая (временная)']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setForm({ ...form, card_type: k })}
                    className={`flex-1 rounded-md py-1.5 text-sm font-medium ${form.card_type === k ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>{l}</button>
                ))}
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium">Номер карты</label>
              <Input ref={cardRef} value={form.card} placeholder="Номер появится сам после касания считывателя на двери"
                onChange={(e) => setForm({ ...form, card: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); check(form.card); } }}
                onBlur={() => check(form.card)} className="font-mono" />
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>Карты Mifare Classic считываются только на двери склада.</span>
                <button onClick={() => { setHint(null); setDoorWait(!doorWait); }} className="text-primary hover:underline">
                  {doorWait ? 'Отменить ожидание' : 'Считать на двери ещё раз'}
                </button>
              </div>
              {doorWait && <p className="mt-2 flex items-center gap-2 text-sm text-primary"><Icon name="Loader2" size={14} className="animate-spin" />{form.rewrite ? 'Поднесите карту сотрудника (ту же или новую) к считывателю на двери склада' : 'Поднесите новую карту к считывателю на двери склада'}…</p>}
              {hint && <p className="mt-2 text-sm text-emerald-600">{hint}</p>}
            </div>
            {!form.rewrite && (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">{guest ? 'Кому выдана (необязательно)' : 'Сотрудник'}</label>
                  <select value={form.profile_id} onChange={(e) => setForm({ ...form, profile_id: e.target.value })}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                    <option value="">{guest ? '— гость —' : '— не привязана (запасная) —'}</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.department ? ` · ${e.department}` : ''}</option>)}
                  </select>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">{guest ? 'Имя гостя / подпись' : 'Подпись'} <span className="text-muted-foreground">(необязательно)</span></label>
                    <Input value={form.label} placeholder={guest ? 'Например: электрик Иван' : 'Например: брелок синий'} onChange={(e) => setForm({ ...form, label: e.target.value })} />
                  </div>
                  {guest ? (
                    <div>
                      <label className="mb-1.5 block text-sm font-medium">Действует до</label>
                      <Input type="date" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} />
                    </div>
                  ) : (
                    <div className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
                      Карта сотрудника действует 1 месяц с записи + 5 резервных дней. Потом удаляется — её нужно перезаписать.
                    </div>
                  )}
                </div>
                {isManager && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium">Расписание доступа</label>
                      <select value={form.schedule_id} onChange={(e) => setForm({ ...form, schedule_id: e.target.value })}
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                        <option value="">Без ограничений (всегда)</option>
                        {schedules.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.from}–{s.to}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium">Код на клавиатуре <span className="text-muted-foreground">(6 цифр)</span></label>
                      <Input inputMode="numeric" maxLength={6} value={form.pin} placeholder={form.has_pin && !form.pin_clear ? 'код задан — введите новый' : 'без кода'}
                        onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, ''), pin_clear: false })} />
                      {form.has_pin && !form.pin_clear && (
                        <button onClick={() => setForm({ ...form, pin: '', pin_clear: true })} className="mt-1 text-xs text-destructive hover:underline">Убрать код</button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
            {needConfirm && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                <label className="mb-1.5 flex items-center gap-2 text-sm font-medium">
                  <Icon name="ShieldCheck" size={16} className="text-amber-600" />Подтверждение: приложите свою карту
                </label>
                <Input ref={confirmRef} data-abiz-card="1" type="password" autoComplete="off" value={form.confirm_card} placeholder="Ваша карта входа в АБИЗ (125 кГц) или мастер-карта"
                  onChange={(e) => setForm({ ...form, confirm_card: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (form.card && form.confirm_card) save(); } }}
                  className="font-mono" />
                <p className="mt-1 text-xs text-muted-foreground">Поставьте курсор в поле и приложите к USB-считывателю у компьютера свою простую карту 125 кГц, по которой входите в программу АБИЗ. Подтверждает руководитель старше по должности, чем владелец новой карты, или мастер-картой.</p>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAdding(false)}>Отмена</Button>
              <Button onClick={save} disabled={busy || !form.card || (needConfirm && !form.confirm_card)}>{busy ? 'Сохраняю…' : form.rewrite ? 'Перезаписать' : form.id ? 'Сохранить' : 'Записать карту'}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Button onClick={() => startAdd()} className="w-full"><Icon name="Plus" size={16} />Записать новую карту</Button>
            {cards.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Карт пока нет</p>}
            <div className="divide-y rounded-xl border">
              {cards.map((c) => {
                const exp = c.expiry_state;
                const sch = schedules.find((s) => s.id === c.schedule_id);
                return (
                  <div key={c.id} className={`flex flex-wrap items-center gap-3 px-3 py-2.5 sm:flex-nowrap ${c.status === 'blocked' ? 'opacity-60' : ''}`}>
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${c.status === 'blocked' ? 'bg-red-500/10 text-red-600' : c.card_type === 'guest' ? 'bg-violet-500/10 text-violet-600' : 'bg-primary/10 text-primary'}`}>
                      <Icon name={c.status === 'blocked' ? 'Ban' : c.card_type === 'guest' ? 'UserRound' : 'IdCard'} fallback="CreditCard" size={17} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="break-words font-medium">
                        {c.name || c.label || 'Не привязана'}
                        {c.card_type === 'guest' && <span className="ml-1.5 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[11px] font-normal text-violet-700">гость</span>}
                        {c.card_type === 'master' && <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-normal text-amber-700">мастер-карта</span>}
                        {c.label && c.name ? <span className="font-normal text-muted-foreground"> · {c.label}</span> : null}
                      </div>
                      <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                        <span className="font-mono">{c.card}</span>
                        {c.status === 'blocked' && <span className="text-red-600">заблокирована</span>}
                        {c.card_type === 'guest' && c.valid_to && <span>до {fmtDate(c.valid_to)}</span>}
                        {c.card_type === 'employee' && c.expires_at && (
                          <span className={exp === 'grace' ? 'font-medium text-red-600' : exp === 'warn' ? 'font-medium text-amber-600' : ''}>
                            {exp === 'grace' ? `резерв: удалится через ${daysTo(c.removed_at)} дн.` : `действует до ${fmtDate(c.expires_at)}${exp === 'warn' ? ` (${daysTo(c.expires_at)} дн.)` : ''}`}
                          </span>
                        )}
                        {sch && <span>{sch.name}</span>}
                        {c.has_pin && <span>с кодом</span>}
                        {c.last_used && <span>проход {fmtDate(c.last_used)}</span>}
                        {!c.synced && <span className="text-amber-600">ждёт отправки на дверь</span>}
                      </div>
                    </div>
                    <div className="ml-auto flex items-center">
                      {c.card_type === 'employee' && (
                        <Button size="sm" variant={exp === 'ok' ? 'ghost' : 'default'} className="h-8" onClick={() => startAdd(c, true)}>
                          <Icon name="RefreshCw" size={14} />Перезаписать
                        </Button>
                      )}
                      {c.card_type !== 'master' && <button title="Изменить" onClick={() => startAdd(c)} className="rounded-lg p-2 hover:bg-secondary"><Icon name="Pencil" size={15} /></button>}
                      {isManager && (c.status === 'active' ? (
                        <button title="Заблокировать" onClick={() => act('card_status', { id: c.id, status: 'blocked' })} className="rounded-lg p-2 text-amber-600 hover:bg-amber-500/10"><Icon name="Lock" size={15} /></button>
                      ) : (
                        <button title="Разблокировать" onClick={() => act('card_status', { id: c.id, status: 'active' })} className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-500/10"><Icon name="LockOpen" size={15} /></button>
                      ))}
                      {isManager && c.card_type !== 'master' && (
                        <button title="Удалить" onClick={() => act('card_delete', { id: c.id }, `Удалить карту ${c.card}${c.name ? ` (${c.name})` : ''}? Проходы в журнале сохранятся.`)}
                          className="rounded-lg p-2 text-destructive hover:bg-destructive/10"><Icon name="Trash2" size={15} /></button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
