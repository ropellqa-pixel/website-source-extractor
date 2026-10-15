import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import BankCard from '@/components/sber/BankCard';
import CounterpartyForm from '@/components/sber/CounterpartyForm';
import PayDialog from '@/components/sber/PayDialog';
import CounterpartyPicker from '@/components/sber/CounterpartyPicker';
import { monthLabel, recentMonths, rub, thisMonth } from '@/lib/accountingApi';
import { useAuth } from '@/lib/auth';
import { shiftWeek, sberCall, STATUS_STYLE, VAT_LABELS, weekLabel, type SberCp, type SberOverview, type SberRequest } from '@/lib/sberApi';

type Tab = 'requests' | 'counterparties';
const EMPTY_REQ = { id: 0, counterparty_id: '', amount: '', purpose: '', vat_rate: '', category_id: '', period: thisMonth() };

export default function Sber() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<SberOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [week, setWeek] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('requests');
  const [req, setReq] = useState<typeof EMPTY_REQ | null>(null);
  const [reqError, setReqError] = useState<string | null>(null);
  const [cp, setCp] = useState<Partial<SberCp> | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [paying, setPaying] = useState<SberRequest[] | null>(null);
  const [rejecting, setRejecting] = useState<SberRequest | null>(null);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await sberCall<SberOverview>({ action: 'overview', week });
    if (r.error) { setError(r.error); return; }
    setData(r); setWeek(r.week); setSelected(new Set());
  }, [week]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const c = params.get('connect');
    if (params.get('signed')) {
      setNotice('Вы вернулись из СберБизнес. Если платёжка подписана — банк исполнит её, статус обновится в течение пары минут.');
      params.delete('signed'); setParams(params, { replace: true });
      return;
    }
    if (!c) return;
    const reason = params.get('reason');
    setNotice(c === 'ok' ? 'СберБизнес подключён. Выписка начнёт загружаться автоматически.' : c === 'expired' ? 'Ссылка подключения устарела — нажмите «Подключить» ещё раз.'
      : `Банк не подтвердил подключение${reason ? `: ${reason}` : ''}. Замдиректора: Админ-панель → СберБизнес → «Проверить подключение к банку».`);
    params.delete('connect'); params.delete('reason'); setParams(params, { replace: true });
  }, [params, setParams]);

  const currentWeek = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toLocaleDateString('sv-SE'); })();
  const can = (a: string) => !!data && data.can.includes(a);
  const ready = useMemo(() => (data?.counterparties || []).filter((c) => c.ready && !c.archived), [data]);

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!data) return <div className="flex justify-center py-20"><Icon name="Loader2" size={24} className="animate-spin text-muted-foreground" /></div>;

  const reqs = data.requests.filter((r) => r.status !== 'cancelled');
  const drafts = reqs.filter((r) => r.status === 'draft' && (r.created_by_user === user?.id || data.is_deputy));
  const toPay = reqs.filter((r) => r.status === 'sent');
  const sum = (list: SberRequest[]) => list.reduce((s, r) => s + r.amount, 0);
  const weekReady = toPay.filter((r) => !r.requisites_changed);
  const maxWeek = shiftWeek(currentWeek, 2);
  const paidSum = sum(reqs.filter((r) => ['paid', 'signing', 'paying'].includes(r.status)));

  const saveReq = async () => {
    if (!req) return;
    setReqError(null);
    const r = await sberCall({ action: 'request_save', ...req, id: req.id || undefined, counterparty_id: Number(req.counterparty_id), category_id: req.category_id ? Number(req.category_id) : null, week });
    if (r.error) { setReqError(r.error); return; }
    setReq(null); load();
  };

  const act = async (action: string, extra: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    const r = await sberCall<{ count?: number }>({ action, ...extra });
    if (r.error) { alert(r.error); return; }
    if (action === 'send_week') setNotice(`Отправлено директору: ${r.count} заявок${(r as { notified?: number }).notified ? ' · уведомление ушло в ВК' : ''}`);
    load();
  };

  const pickCp = (id: string) => {
    const c = data.counterparties.find((x) => String(x.id) === id);
    setReq((p) => p && { ...p, counterparty_id: id, purpose: p.purpose || c?.default_purpose || '', vat_rate: p.vat_rate || c?.vat_rate || 'none', category_id: p.category_id || (c?.default_category_id ? String(c.default_category_id) : '') });
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold tracking-tight">СБЕР</h1>
          <p className="text-sm text-muted-foreground">Оплата контрагентам через СберБизнес и автозагрузка выписки</p>
        </div>
        {can('sber.pay') && tab === 'requests' && (
          <Button size="lg" className="bg-emerald-600 hover:bg-emerald-700" disabled={!data.bank.connected || weekReady.length === 0}
            onClick={() => setPaying(weekReady)}>
            <Icon name="Landmark" size={18} />Оплатить за неделю{weekReady.length > 0 ? ` · ${weekReady.length} на ${rub(sum(weekReady))}` : ''}
          </Button>
        )}
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-800">
          <Icon name="Info" size={16} />{notice}
          <button onClick={() => setNotice(null)} className="ml-auto"><Icon name="X" size={15} /></button>
        </div>
      )}

      <BankCard bank={data.bank} isDeputy={data.is_deputy} canSync={can('sber.sync')} onChanged={load} connections={data.connections.filter((c) => c.active && c.account).length} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-secondary p-0.5">
          {([['requests', 'Оплаты по неделям', 'CalendarRange'], ['counterparties', 'Контрагенты и реквизиты', 'Building2']] as const).map(([k, l, i]) => (
            <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              <Icon name={i} size={15} />{l}
            </button>
          ))}
        </div>
        {tab === 'requests' && (
          <div className="flex items-center rounded-lg border">
            <button onClick={() => setWeek(shiftWeek(data.week, -1))} className="p-2 hover:bg-secondary"><Icon name="ChevronLeft" size={16} /></button>
            <span className="w-40 text-center text-sm font-medium">{weekLabel(data.week)}</span>
            <button onClick={() => setWeek(shiftWeek(data.week, 1))} disabled={data.week >= maxWeek} className="p-2 hover:bg-secondary disabled:opacity-30"><Icon name="ChevronRight" size={16} /></button>
          </div>
        )}
        {tab === 'requests' && data.pending.filter((p) => p.week !== data.week).map((p) => (
          <button key={p.week} onClick={() => setWeek(p.week)} className="rounded-full bg-amber-500/15 px-3 py-1 text-xs text-amber-800 hover:bg-amber-500/25">
            ждут оплаты: {weekLabel(p.week)} · {p.count} на {rub(p.amount)}
          </button>
        ))}
      </div>

      {tab === 'requests' ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-2xl border bg-card p-3.5"><div className="text-xs text-muted-foreground">Заявок за неделю</div><div className="mt-1 text-xl font-semibold">{reqs.length}</div></div>
            <div className="rounded-2xl border bg-card p-3.5"><div className="text-xs text-muted-foreground">Черновики</div><div className="mt-1 text-xl font-semibold tabular-nums">{rub(sum(reqs.filter((r) => r.status === 'draft')))}</div></div>
            <div className="rounded-2xl border bg-card p-3.5"><div className="text-xs text-muted-foreground">Ждут оплаты</div><div className="mt-1 text-xl font-semibold tabular-nums text-amber-600">{rub(sum(toPay))}</div></div>
            <div className="rounded-2xl border bg-card p-3.5"><div className="text-xs text-muted-foreground">Оплачено / в банке</div><div className="mt-1 text-xl font-semibold tabular-nums text-emerald-600">{rub(paidSum)}</div></div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(can('sber.request') || can('sber.pay')) && (
              <Button onClick={() => { setReq({ ...EMPTY_REQ }); setReqError(null); }} disabled={ready.length === 0}>
                <Icon name="Plus" size={16} />{can('sber.pay') ? 'Новая оплата' : 'Заявка на оплату'}
              </Button>
            )}
            {can('sber.request') && drafts.length > 0 && (
              <Button variant="outline" onClick={() => act('send_week', { week: data.week }, `Отправить директору ${drafts.length} заявок на ${rub(sum(drafts))}?`)}>
                <Icon name="Send" size={16} />Отправить директору ({drafts.length})
              </Button>
            )}
            {can('sber.pay') && selected.size > 0 && (
              <Button className="ml-auto bg-emerald-600 hover:bg-emerald-700" onClick={() => setPaying(toPay.filter((r) => selected.has(r.id)))} disabled={!data.bank.connected}>
                <Icon name="Landmark" size={16} />Оплатить выбранные ({selected.size}) · {rub(sum(toPay.filter((r) => selected.has(r.id))))}
              </Button>
            )}
            {ready.length === 0 && <p className="self-center text-sm text-muted-foreground">Сначала добавьте получателя с реквизитами во вкладке «Контрагенты и реквизиты».</p>}
            {!data.bank.connected && <p className="self-center text-sm text-amber-700">Банк не подключён: выберите расчётный счёт в Админ-панели → СберБизнес.</p>}
          </div>

          <div className="overflow-auto rounded-2xl border bg-card">
            {reqs.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground"><Icon name="Inbox" size={32} className="mx-auto mb-2" />Заявок на эту неделю нет</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    {can('sber.pay') && (
                      <th className="w-10 px-3 py-2.5">
                        {toPay.length > 0 && <input type="checkbox" checked={toPay.every((r) => selected.has(r.id))} onChange={(e) => setSelected(new Set(e.target.checked ? toPay.map((r) => r.id) : []))} />}
                      </th>
                    )}
                    <th className="px-3 py-2.5 font-medium">Контрагент</th>
                    <th className="px-3 py-2.5 font-medium">Назначение</th>
                    <th className="px-3 py-2.5 text-right font-medium">Сумма</th>
                    <th className="px-3 py-2.5 font-medium">Статус</th>
                    <th className="w-40" />
                  </tr>
                </thead>
                <tbody>
                  {reqs.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-secondary/40">
                      {can('sber.pay') && (
                        <td className="px-3 py-2.5">
                          {r.status === 'sent' && !r.requisites_changed && (
                            <input type="checkbox" checked={selected.has(r.id)} onChange={(e) => { const n = new Set(selected); if (e.target.checked) n.add(r.id); else n.delete(r.id); setSelected(n); }} />
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2.5">
                        <div className="font-medium">{r.counterparty}</div>
                        <div className="text-xs text-muted-foreground">р/с •••• {r.requisites.account?.slice(-4)} · от {r.created_by}</div>
                      </td>
                      <td className="max-w-xs px-3 py-2.5">
                        <div className="line-clamp-2">{r.purpose}</div>
                        <div className="text-xs text-muted-foreground">
                          {VAT_LABELS[r.vat_rate] || r.vat_rate}
                          {r.category_id && ` · ${data.categories.find((c) => c.id === r.category_id)?.name || ''}`}
                          {r.period && ` · за ${monthLabel(r.period).toLowerCase()}`}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums">{rub(r.amount)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[r.status]}`}>{r.status_label}</span>
                        {r.requisites_changed && <div className="mt-1 text-xs text-red-600">реквизиты изменились — пересоздайте заявку</div>}
                        {r.reject_reason && r.status === 'rejected' && <div className="mt-1 text-xs text-red-600">{r.reject_reason}</div>}
                        {r.bank_comment && ['failed', 'sent'].includes(r.status) && <div className="mt-1 text-xs text-red-600">{r.bank_comment}</div>}
                        {r.decided_by && ['paid', 'signing', 'paying'].includes(r.status) && <div className="mt-1 text-xs text-muted-foreground">{r.decided_by}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex justify-end gap-1">
                          {can('sber.pay') && r.status === 'sent' && !r.requisites_changed && (
                            <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700" disabled={!data.bank.connected} onClick={() => setPaying([r])}>Оплатить</Button>
                          )}
                          {can('sber.pay') && r.status === 'sent' && (
                            <Button size="sm" variant="ghost" className="h-8" onClick={() => { setRejecting(r); setReason(''); }}>Отклонить</Button>
                          )}
                          {can('sber.pay') && r.status === 'signing' && (
                            <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700" onClick={async () => {
                              const x = await sberCall<{ links: { id: number; url: string }[] }>({ action: 'sign_links', ids: [r.id], origin: window.location.origin });
                              if (x.error || !x.links?.[0]) { alert(x.error || 'Ссылка недоступна'); return; }
                              window.location.href = x.links[0].url;
                            }}>Подписать по СМС</Button>
                          )}
                          {(can('sber.request') || can('sber.pay')) && (['draft', 'rejected'].includes(r.status) || (r.status === 'sent' && can('sber.pay'))) && (r.created_by_user === user?.id || data.is_deputy || can('sber.pay')) && (
                            <button title="Изменить" onClick={() => { setReq({ id: r.id, counterparty_id: String(r.counterparty_id), amount: String(r.amount), purpose: r.purpose, vat_rate: r.vat_rate, category_id: r.category_id ? String(r.category_id) : '', period: r.period || thisMonth() }); setReqError(null); }}
                              className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"><Icon name="Pencil" size={15} /></button>
                          )}
                          {can('sber.request') && ['draft', 'rejected', 'sent'].includes(r.status) && (r.created_by_user === user?.id || data.is_deputy) && (
                            <button title="Отменить" onClick={() => act('request_delete', { id: r.id }, 'Отменить заявку?')}
                              className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-red-600"><Icon name="Trash2" size={15} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {can('sber.edit_requisites') ? (
              <Button onClick={() => setCp({ kind: 'supplier', vat_rate: 'none' })}><Icon name="Plus" size={16} />Контрагент</Button>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Icon name="Lock" size={14} />Реквизиты меняет только заместитель директора</p>
            )}
          </div>
          <div className="overflow-auto rounded-2xl border bg-card">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b"><th className="px-4 py-2.5 font-medium">Контрагент</th><th className="px-4 py-2.5 font-medium">Реквизиты</th><th className="px-4 py-2.5 font-medium">Изменены</th><th className="w-12" /></tr>
              </thead>
              <tbody>
                {data.counterparties.map((c) => (
                  <tr key={c.id} className={`border-b last:border-0 ${c.archived ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-2.5"><div className="font-medium">{c.name}</div><div className="text-xs text-muted-foreground">ИНН {c.inn || '—'}{c.kpp ? ` · КПП ${c.kpp}` : ''}</div></td>
                    <td className="px-4 py-2.5">
                      {c.ready ? (
                        <><div className="font-mono text-xs">{c.account}</div><div className="text-xs text-muted-foreground">БИК {c.bic}{c.bank_name ? ` · ${c.bank_name}` : ''}</div></>
                      ) : <span className="text-xs text-amber-700">не заполнены — оплатить нельзя</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {c.requisites_updated_at ? `${new Date(c.requisites_updated_at).toLocaleDateString('ru-RU')} · ${c.requisites_updated_by || ''}` : '—'}
                    </td>
                    <td className="px-2 py-2.5">
                      {can('sber.edit_requisites') && <button onClick={() => setCp(c)} className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"><Icon name="Pencil" size={15} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {req && (
        <Dialog open onOpenChange={(v) => !v && setReq(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{req.id ? 'Заявка на оплату' : 'Новая заявка'} · {weekLabel(data.week)}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="block space-y-1 text-sm">
                <span className="text-muted-foreground">Контрагент</span>
                <CounterpartyPicker items={ready} value={req.counterparty_id} onChange={pickCp} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1 text-sm">
                  <span className="text-muted-foreground">Статья расхода</span>
                  <select value={req.category_id} onChange={(e) => setReq({ ...req, category_id: e.target.value })} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
                    <option value="">— выберите —</option>
                    {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="text-muted-foreground">За какой месяц</span>
                  <select value={req.period} onChange={(e) => setReq({ ...req, period: e.target.value })} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
                    {recentMonths(thisMonth()).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
                  </select>
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">Сумма, ₽</span>
                <Input inputMode="decimal" value={req.amount} onChange={(e) => setReq({ ...req, amount: e.target.value })} className="text-lg font-semibold" />
              </label>
              {reqError && <p className="text-sm text-red-600">{reqError}</p>}
              <Button className="w-full" onClick={saveReq}>{can('sber.pay') ? 'Сохранить — появится кнопка «Оплатить»' : 'Сохранить черновик'}</Button>
              <p className="text-center text-xs text-muted-foreground">Черновики недели отправляются директору одной кнопкой</p>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {rejecting && (
        <Dialog open onOpenChange={(v) => !v && setRejecting(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Отклонить заявку</DialogTitle></DialogHeader>
            <p className="text-sm">{rejecting.counterparty} — {rub(rejecting.amount)}</p>
            <Input placeholder="Причина (увидит автор заявки)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button variant="destructive" onClick={async () => { await act('reject', { id: rejecting.id, reason }); setRejecting(null); }}>Отклонить</Button>
          </DialogContent>
        </Dialog>
      )}

      {cp && <CounterpartyForm value={cp} categories={data.categories} onClose={() => setCp(null)} onSaved={() => { setCp(null); load(); }} />}
      {paying && <PayDialog items={paying} connections={data.connections} onClose={() => { setPaying(null); load(); }} onDone={load} />}
    </div>
  );
}
