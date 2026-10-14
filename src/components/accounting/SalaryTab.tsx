import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { accCall, fmtDay, monthLabel, PAY_LABELS, rub, shiftMonth, today, type PayType, type SalaryData, type Staff } from '@/lib/accountingApi';

const rateHint: Record<PayType, string> = { salary: 'Оклад в месяц, ₽', percent: 'Процент от выручки, %', hourly: 'Ставка за час, ₽' };
const rateText = (s: { pay_type: PayType; rate: number }) =>
  s.pay_type === 'percent' ? `${s.rate}% от выручки` : s.pay_type === 'hourly' ? `${rub(s.rate)} / час` : `${rub(s.rate)} / мес`;

type Modal =
  | { type: 'staff'; id: number; name: string; position: string; profile_id: string; pay_type: PayType; rate: string; active: boolean }
  | { type: 'accrual'; staff: Staff; pay_type: PayType; rate: string; base: string; bonus: string; comment: string }
  | { type: 'payment'; staff: Staff; date: string; amount: string; comment: string; to_expenses: boolean }
  | { type: 'history'; staff: Staff };

export default function SalaryTab({ canEdit }: { canEdit: boolean }) {
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [data, setData] = useState<SalaryData | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    const r = await accCall<SalaryData>({ action: 'salary', period });
    if (!r.error) setData(r);
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const open = (m: Modal) => { setModal(m); setError(null); };

  const submit = async () => {
    if (!modal || modal.type === 'history') return;
    setBusy(true); setError(null);
    let r;
    if (modal.type === 'staff') {
      r = await accCall({ action: 'staff_save', ...modal, id: modal.id || undefined });
    } else if (modal.type === 'accrual') {
      r = await accCall({ action: 'accrual_save', staff_id: modal.staff.id, period, pay_type: modal.pay_type, rate: modal.rate, base: modal.base, bonus: modal.bonus, comment: modal.comment });
    } else {
      r = await accCall({ action: 'payment_save', staff_id: modal.staff.id, period, date: modal.date, amount: modal.amount, comment: modal.comment, to_expenses: modal.to_expenses });
    }
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setModal(null); load();
  };

  const del = async (action: string, id: number, text: string) => {
    if (!confirm(text)) return;
    const r = await accCall({ action, id });
    if (r.error) alert(r.error); else load();
  };

  const preview = (() => {
    if (!modal || modal.type !== 'accrual') return 0;
    const n = (v: string) => Number(String(v).replace(',', '.').replace(/\s/g, '')) || 0;
    const main = modal.pay_type === 'salary' ? n(modal.rate) : modal.pay_type === 'percent' ? n(modal.base) * n(modal.rate) / 100 : n(modal.base) * n(modal.rate);
    return Math.round((main + n(modal.bonus)) * 100) / 100;
  })();

  if (!data) return <div className="flex justify-center py-16"><Icon name="Loader2" size={24} className="animate-spin text-muted-foreground" /></div>;

  const staff = data.staff.filter((s) => showInactive || s.active || s.debt !== 0);
  const accrued = data.staff.reduce((s, x) => s + x.accrued, 0);
  const paid = data.staff.reduce((s, x) => s + x.paid, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border">
          <button onClick={() => setPeriod(shiftMonth(period, -1))} className="p-2 hover:bg-secondary"><Icon name="ChevronLeft" size={16} /></button>
          <span className="w-36 text-center text-sm font-medium">{monthLabel(period)}</span>
          <button onClick={() => setPeriod(shiftMonth(period, 1))} className="p-2 hover:bg-secondary"><Icon name="ChevronRight" size={16} /></button>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Показать уволенных
        </label>
        {canEdit && (
          <Button size="sm" className="ml-auto" onClick={() => open({ type: 'staff', id: 0, name: '', position: '', profile_id: '', pay_type: 'salary', rate: '', active: true })}>
            <Icon name="UserPlus" size={15} />Сотрудник
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border bg-card p-3.5"><div className="text-xs text-muted-foreground">Начислено за месяц</div><div className="mt-1 text-xl font-semibold tabular-nums">{rub(accrued)}</div></div>
        <div className="rounded-2xl border bg-card p-3.5"><div className="text-xs text-muted-foreground">Выплачено за месяц</div><div className="mt-1 text-xl font-semibold tabular-nums">{rub(paid)}</div></div>
        <div className="rounded-2xl border bg-card p-3.5"><div className="text-xs text-muted-foreground">Общий долг по зарплате</div><div className={`mt-1 text-xl font-semibold tabular-nums ${data.total_debt > 0 ? 'text-red-600' : ''}`}>{rub(data.total_debt)}</div></div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border bg-card">
        {staff.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">{canEdit ? 'Добавьте сотрудников, чтобы начислять зарплату' : 'Сотрудников пока нет'}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2.5 font-medium">Сотрудник</th>
                <th className="px-4 py-2.5 font-medium">Оплата</th>
                <th className="px-4 py-2.5 text-right font-medium">Начислено</th>
                <th className="px-4 py-2.5 text-right font-medium">Выплачено</th>
                <th className="px-4 py-2.5 text-right font-medium">Долг (всего)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} className={`border-b last:border-0 hover:bg-secondary/40 ${s.active ? '' : 'opacity-60'}`}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.position || ''}{!s.active && ' · уволен'}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div>{PAY_LABELS[s.pay_type]}</div>
                    <div className="text-xs text-muted-foreground">{rateText(s)}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{rub(s.accrued)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{rub(s.paid)}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${s.debt > 0 ? 'text-red-600' : s.debt < 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {s.debt < 0 ? `аванс ${rub(-s.debt)}` : rub(s.debt)}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex justify-end gap-1">
                      {canEdit && <>
                        <Button size="sm" variant="outline" className="h-8" onClick={() => open({ type: 'accrual', staff: s, pay_type: s.pay_type, rate: String(s.rate), base: '', bonus: '', comment: '' })}>Начислить</Button>
                        <Button size="sm" className="h-8" onClick={() => open({ type: 'payment', staff: s, date: today(), amount: s.debt > 0 ? String(s.debt) : '', comment: '', to_expenses: true })}>Выплатить</Button>
                      </>}
                      <button title="История за месяц" onClick={() => open({ type: 'history', staff: s })} className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"><Icon name="History" size={15} /></button>
                      {canEdit && (
                        <button title="Изменить" onClick={() => open({ type: 'staff', id: s.id, name: s.name, position: s.position || '', profile_id: s.profile_id || '', pay_type: s.pay_type, rate: String(s.rate), active: s.active })}
                          className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"><Icon name="Pencil" size={15} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={!!modal} onOpenChange={(v) => !v && setModal(null)}>
        <DialogContent className="max-w-md">
          {modal?.type === 'staff' && (
            <>
              <DialogHeader><DialogTitle>{modal.id ? 'Сотрудник' : 'Новый сотрудник'}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Field label="ФИО"><Input value={modal.name} onChange={(e) => setModal({ ...modal, name: e.target.value })} /></Field>
                {data.profiles && (
                  <Field label="Связать с учётной записью (необязательно)">
                    <select value={modal.profile_id} onChange={(e) => {
                      const p = data.profiles?.find((x) => x.id === e.target.value);
                      setModal({ ...modal, profile_id: e.target.value, name: modal.name || p?.name || '' });
                    }} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                      <option value="">— нет —</option>
                      {data.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>
                )}
                <Field label="Должность"><Input value={modal.position} onChange={(e) => setModal({ ...modal, position: e.target.value })} /></Field>
                <Field label="Способ оплаты">
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-secondary p-0.5">
                    {(Object.keys(PAY_LABELS) as PayType[]).map((k) => (
                      <button key={k} onClick={() => setModal({ ...modal, pay_type: k })}
                        className={`rounded-md py-1.5 text-xs font-medium ${modal.pay_type === k ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>{PAY_LABELS[k]}</button>
                    ))}
                  </div>
                </Field>
                <Field label={rateHint[modal.pay_type]}><Input inputMode="decimal" value={modal.rate} onChange={(e) => setModal({ ...modal, rate: e.target.value })} /></Field>
                {modal.id > 0 && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!modal.active} onChange={(e) => setModal({ ...modal, active: !e.target.checked })} />Уволен (скрыть из списка)
                  </label>
                )}
              </div>
            </>
          )}

          {modal?.type === 'accrual' && (
            <>
              <DialogHeader><DialogTitle>Начисление: {modal.staff.name}</DialogTitle></DialogHeader>
              <p className="-mt-2 text-sm text-muted-foreground">за {monthLabel(period)}</p>
              <div className="space-y-3">
                <Field label="Способ оплаты">
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-secondary p-0.5">
                    {(Object.keys(PAY_LABELS) as PayType[]).map((k) => (
                      <button key={k} onClick={() => setModal({ ...modal, pay_type: k })}
                        className={`rounded-md py-1.5 text-xs font-medium ${modal.pay_type === k ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>{PAY_LABELS[k]}</button>
                    ))}
                  </div>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={rateHint[modal.pay_type]}><Input inputMode="decimal" value={modal.rate} onChange={(e) => setModal({ ...modal, rate: e.target.value })} /></Field>
                  {modal.pay_type !== 'salary' && (
                    <Field label={modal.pay_type === 'percent' ? 'Выручка, ₽' : 'Отработано часов'}>
                      <Input inputMode="decimal" value={modal.base} onChange={(e) => setModal({ ...modal, base: e.target.value })} />
                    </Field>
                  )}
                </div>
                <Field label="Премия / доплата, ₽"><Input inputMode="decimal" value={modal.bonus} placeholder="0" onChange={(e) => setModal({ ...modal, bonus: e.target.value })} /></Field>
                <Field label="Комментарий"><Input value={modal.comment} onChange={(e) => setModal({ ...modal, comment: e.target.value })} /></Field>
                <div className="flex items-baseline justify-between rounded-xl bg-secondary px-4 py-3">
                  <span className="text-sm text-muted-foreground">Итого к начислению</span>
                  <span className="text-lg font-semibold tabular-nums">{rub(preview)}</span>
                </div>
              </div>
            </>
          )}

          {modal?.type === 'payment' && (
            <>
              <DialogHeader><DialogTitle>Выплата: {modal.staff.name}</DialogTitle></DialogHeader>
              <p className="-mt-2 text-sm text-muted-foreground">за {monthLabel(period)} · текущий долг {rub(modal.staff.debt)}</p>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Дата"><Input type="date" value={modal.date} onChange={(e) => setModal({ ...modal, date: e.target.value })} /></Field>
                  <Field label="Сумма, ₽"><Input inputMode="decimal" value={modal.amount} onChange={(e) => setModal({ ...modal, amount: e.target.value })} /></Field>
                </div>
                <Field label="Комментарий (аванс, наличными, на карту…)"><Input value={modal.comment} onChange={(e) => setModal({ ...modal, comment: e.target.value })} /></Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={modal.to_expenses} onChange={(e) => setModal({ ...modal, to_expenses: e.target.checked })} />
                  Записать в расходы по статье «Зарплата»
                </label>
              </div>
            </>
          )}

          {modal?.type === 'history' && (
            <>
              <DialogHeader><DialogTitle>{modal.staff.name} · {monthLabel(period)}</DialogTitle></DialogHeader>
              <div className="space-y-4 text-sm">
                <div>
                  <h4 className="mb-1.5 font-medium">Начисления</h4>
                  {data.accruals.filter((a) => a.staff_id === modal.staff.id).map((a) => (
                    <div key={a.id} className="flex items-center justify-between border-b py-1.5 last:border-0">
                      <div>
                        <div className="tabular-nums">{rub(a.amount)}</div>
                        <div className="text-xs text-muted-foreground">
                          {PAY_LABELS[a.pay_type]}{a.pay_type !== 'salary' && `: ${a.base} × ${a.pay_type === 'percent' ? a.rate + '%' : rub(a.rate)}`}{a.bonus ? ` + премия ${rub(a.bonus)}` : ''}{a.comment ? ` · ${a.comment}` : ''}
                        </div>
                      </div>
                      {canEdit && <button onClick={() => del('accrual_delete', a.id, 'Удалить начисление?')} className="p-1 text-muted-foreground hover:text-red-600"><Icon name="Trash2" size={14} /></button>}
                    </div>
                  ))}
                  {!data.accruals.some((a) => a.staff_id === modal.staff.id) && <p className="text-muted-foreground">Нет</p>}
                </div>
                <div>
                  <h4 className="mb-1.5 font-medium">Выплаты</h4>
                  {data.payments.filter((p) => p.staff_id === modal.staff.id).map((p) => (
                    <div key={p.id} className="flex items-center justify-between border-b py-1.5 last:border-0">
                      <div>
                        <div className="tabular-nums">{rub(p.amount)}</div>
                        <div className="text-xs text-muted-foreground">{fmtDay(p.date)}{p.comment ? ` · ${p.comment}` : ''}</div>
                      </div>
                      {canEdit && <button onClick={() => del('payment_delete', p.id, 'Удалить выплату? Расход по ней тоже удалится.')} className="p-1 text-muted-foreground hover:text-red-600"><Icon name="Trash2" size={14} /></button>}
                    </div>
                  ))}
                  {!data.payments.some((p) => p.staff_id === modal.staff.id) && <p className="text-muted-foreground">Нет</p>}
                </div>
              </div>
            </>
          )}

          {modal && modal.type !== 'history' && (
            <>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button className="w-full" onClick={submit} disabled={busy}>{busy ? 'Сохраняю…' : 'Сохранить'}</Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1 text-sm"><span className="text-muted-foreground">{label}</span>{children}</label>;
}
