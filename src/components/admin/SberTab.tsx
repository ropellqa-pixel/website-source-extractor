import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { sberCall, sberUrl, type SberConnection, type SberOverview } from '@/lib/sberApi';


export default function SberTab() {
  const [bank, setBank] = useState<SberOverview['bank'] | null>(null);
  const [tokens, setTokens] = useState<{ access_token: string; refresh_token: string; title: string; connection_id: number | null } | null>(null);
  const [conns, setConns] = useState<SberConnection[]>([]);
  const [notify, setNotify] = useState<SberOverview['notify']>(null);
  const [diag, setDiag] = useState<{ steps: { step: string; ok: boolean; text: string }[]; redirect_uri: string } | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const runDiag = async () => {
    setDiagBusy(true); setDiag(null);
    const r = await sberCall<{ steps: { step: string; ok: boolean; text: string }[]; redirect_uri: string }>({ action: 'diagnose' });
    setDiagBusy(false);
    if (r.error) { setMsg2({ ok: false, text: r.error }); return; }
    setDiag(r);
  };
  const [msg2, setMsg2] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy2, setBusy2] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await sberCall<SberOverview>({ action: 'overview' });
    if (r.error) { setMsg2({ ok: false, text: r.error }); return; }
    const b = r.bank as typeof bank;
    setBank(b); setConns(r.connections.filter((c) => c.active)); setNotify(r.notify);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save2 = async (action: string, payload: Record<string, unknown>) => {
    setBusy2(action); setMsg2(null);
    const r = await sberCall<{ org?: { name: string } }>({ action, ...payload });
    setBusy2(null);
    if (r.error) { setMsg2({ ok: false, text: r.error }); return; }
    if (action === 'tokens_save') { setTokens(null); setMsg2({ ok: true, text: `Банк принял ключи: ${r.org?.name || ''}` }); }
    else setMsg2({ ok: true, text: 'Сохранено' });
    load();
  };

  return (
    <div className="grid max-w-4xl gap-4 lg:grid-cols-2">
      <div className="space-y-3 rounded-2xl border bg-card p-5">
        <div className="flex items-center gap-2">
          <Icon name="Landmark" size={18} className="text-emerald-600" />
          <h3 className="font-medium">Проверка связи с банком</h3>
        </div>
        {bank && (
          <>
            <Button variant="outline" onClick={runDiag} disabled={diagBusy}>
              <Icon name={diagBusy ? 'Loader2' : 'Stethoscope'} fallback="Activity" size={15} className={diagBusy ? 'animate-spin' : ''} />Проверить подключение к банку
            </Button>
            {diag && (
              <div className="space-y-1.5 rounded-xl border p-3">
                {diag.steps.map((x) => (
                  <div key={x.step} className="flex items-start gap-2 text-sm">
                    <Icon name={x.ok ? 'CircleCheck' : 'CircleX'} size={16} className={`mt-0.5 shrink-0 ${x.ok ? 'text-emerald-600' : 'text-red-600'}`} />
                    <div><b>{x.step}</b> — <span className="text-muted-foreground">{x.text}</span></div>
                  </div>
                ))}
                {diag.redirect_uri && diag.redirect_uri !== sberUrl && (
                  <div className="flex items-start gap-2 text-sm text-red-600"><Icon name="CircleX" size={16} className="mt-0.5" />Redirect URI в настройках отличается от адреса системы</div>
                )}
              </div>
            )}
            <div className={`flex items-center gap-2 text-sm ${bank.connected ? 'text-emerald-700' : 'text-muted-foreground'}`}>
              <Icon name={bank.connected ? 'ShieldCheck' : 'ShieldOff'} size={16} />
              {bank.connected ? `Подключено: ${bank.org?.name || ''}` : 'Банк ещё не подключён'}
            </div>
            <Button asChild variant="outline"><Link to="/sber"><Icon name="ArrowRight" size={15} />Перейти в раздел СБЕР</Link></Button>
          </>
        )}
      </div>

      <div className="space-y-3 rounded-2xl border bg-card p-5 lg:col-span-2">
        <div className="flex items-center gap-2">
          <Icon name="KeyRound" size={18} className="text-emerald-600" /><h3 className="font-medium">Ключи доступа</h3>
          <Button size="sm" className="ml-auto" onClick={() => setTokens({ access_token: '', refresh_token: '', title: '', connection_id: null })}>
            <Icon name="Plus" size={15} />Добавить подключение
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Можно добавить несколько: разные организации, счета или запасные ключи. Перед сохранением банк проверяет ключи — если не принял, ничего не сохранится.
          Выписка загружается по всем подключениям, оплата идёт с основного (директор может выбрать другое).
        </p>
        {conns.length === 0 && <p className="rounded-xl bg-secondary p-4 text-center text-sm text-muted-foreground">Подключений пока нет</p>}
        <div className="grid gap-2 md:grid-cols-2">
          {conns.map((c, i) => (
            <div key={c.id} className={`rounded-xl border p-3 ${c.is_default ? 'border-emerald-500/50 bg-emerald-500/5' : ''}`}>
              <div className="flex items-start gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">{i + 1}</div>
                <div className="min-w-0 flex-1">
                  <input defaultValue={c.title} onBlur={(e) => e.target.value.trim() && e.target.value !== c.title && save2('connection_update', { id: c.id, title: e.target.value })}
                    className="w-full bg-transparent font-medium outline-none focus:underline" />
                  <div className="text-xs text-muted-foreground">{c.org?.name} · ИНН {c.org?.inn}</div>
                </div>
                <span className="text-[10px] text-muted-foreground">№ {c.id}</span>
                {c.is_default && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] text-white">основное</span>}
              </div>
              <select value={c.account || ''} onChange={(e) => save2('connection_update', { id: c.id, account: e.target.value })}
                className="mt-2 h-9 w-full rounded-md border bg-background px-2 font-mono text-xs">
                {c.org?.accounts.map((a) => <option key={a.number} value={a.number}>{a.number}</option>)}
              </select>
              <div className="mt-1 text-xs text-muted-foreground">
                {c.last_error ? <span className="text-red-600">{c.last_error}</span> : c.last_sync ? `Выписка: ${new Date(c.last_sync).toLocaleString('ru-RU')}` : 'Выписка ещё не загружалась'}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {!c.is_default && <Button size="sm" variant="outline" className="h-7" onClick={() => save2('connection_update', { id: c.id, is_default: true })}>Сделать основным</Button>}
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setTokens({ access_token: '', refresh_token: '', title: c.title, connection_id: c.id })}>Обновить ключи</Button>
                <Button size="sm" variant="ghost" className="h-7 text-red-600" onClick={() => confirm(`Отключить «${c.title}»? Ключи будут удалены.`) && save2('connection_delete', { id: c.id })}>Отключить</Button>
              </div>
            </div>
          ))}
        </div>
        {tokens && (
          <div className="space-y-2 rounded-xl border border-dashed p-4">
            <div className="text-sm font-medium">{tokens.connection_id ? `Новые ключи для «${tokens.title}»` : 'Новое подключение'}</div>
            {!tokens.connection_id && <Input placeholder="Название, например «Основной счёт» или «ИП Иванов»" value={tokens.title} onChange={(e) => setTokens({ ...tokens, title: e.target.value })} />}
            <Input type="password" autoComplete="off" placeholder="Ключ Access Token" value={tokens.access_token} onChange={(e) => setTokens({ ...tokens, access_token: e.target.value })} />
            <Input type="password" autoComplete="off" placeholder="Ключ Refresh Token" value={tokens.refresh_token} onChange={(e) => setTokens({ ...tokens, refresh_token: e.target.value })} />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => save2('tokens_save', tokens)} disabled={!!busy2 || !tokens.refresh_token}>
                {busy2 === 'tokens_save' ? 'Проверяю в банке…' : 'Сохранить и подключить'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setTokens(null)}>Отмена</Button>
            </div>
            <p className="text-xs text-muted-foreground">Хранятся зашифрованно, обратно не показываются.</p>
          </div>
        )}
      </div>

      {notify && (
        <div className="space-y-3 rounded-2xl border bg-card p-5 lg:col-span-2">
          <div className="flex items-center gap-2"><Icon name="Bell" size={18} className="text-emerald-600" /><h3 className="font-medium">Уведомления в ВК</h3></div>
          <p className="text-xs text-muted-foreground">Приходят тем, у кого привязан ВК (Настройки → ВКонтакте).</p>
          {([['on_send', 'Директору — когда старший сотрудник отправил заявки на оплату'], ['on_paid', 'Автору заявки — когда платёж прошёл или банк его отклонил'], ['on_reject', 'Автору заявки — когда директор отклонил заявку']] as const).map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={notify[k]} onChange={(e) => { const n = { ...notify, [k]: e.target.checked }; setNotify(n); save2('notify_save', n); }} />{l}
            </label>
          ))}
          <Button size="sm" variant="outline" onClick={async () => {
            const r = await sberCall<{ sent: number }>({ action: 'notify_test' });
            setMsg2(r.error ? { ok: false, text: r.error } : r.sent ? { ok: true, text: 'Проверочное сообщение отправлено вам в ВК' } : { ok: false, text: 'Не отправлено — привяжите свой ВК в Настройках' });
          }}><Icon name="Send" size={15} />Проверить на себе</Button>
        </div>
      )}
      {msg2 && <p className={`text-sm lg:col-span-2 ${msg2.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg2.text}</p>}
    </div>
  );
}
