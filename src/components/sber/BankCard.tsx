import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { rub } from '@/lib/accountingApi';
import { sberCall, sberUrl, type SberBank } from '@/lib/sberApi';

const KEYS: [string, string][] = [
  ['client_id', 'Client ID (секрет SBER_CLIENT_ID)'], ['client_secret', 'Client Secret (секрет SBER_CLIENT_SECRET)'],
  ['certificate', 'Сертификат .p12 (Админ-панель → СберБизнес)'],
];

interface Props { bank: SberBank; isDeputy: boolean; canSync: boolean; onChanged: () => void; connections?: number }

export default function BankCard({ bank, isDeputy, canSync, onChanged, connections = 1 }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [settings, setSettings] = useState<{ account: string; limit_payment: string; limit_day: string } | null>(null);

  const run = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action); setMsg(null);
    const r = await sberCall<{ url?: string; added?: number }>({ action, ...extra });
    setBusy(null);
    if (r.error) { setMsg({ ok: false, text: r.error }); return; }
    if (action === 'connect' && r.url) { window.location.href = r.url; return; }
    if (action === 'sync') setMsg({ ok: true, text: `Загружено новых операций: ${r.added ?? 0}` });
    if (action === 'bank_settings') setSettings(null);
    onChanged();
  };

  if (!bank.connected) {
    return (
      <div className="rounded-2xl border bg-card p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white"><Icon name="Landmark" size={24} /></div>
          <div className="flex-1 space-y-2">
            <h2 className="text-lg font-semibold">Подключение СберБизнес</h2>
            <p className="text-sm text-muted-foreground">
              После подключения выписка по расчётному счёту будет сама загружаться в бухгалтерию каждый день, а директор сможет оплачивать заявки прямо отсюда.
            </p>
            {isDeputy ? (
              <>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {KEYS.map(([k, n]) => (
                    <div key={k} className="flex items-center gap-2 text-sm">
                      <Icon name={bank.configured[k] ? 'CircleCheck' : 'CircleDashed'} size={16} className={bank.configured[k] ? 'text-emerald-600' : 'text-muted-foreground'} />
                      <span className="text-xs">{n}</span>
                    </div>
                  ))}
                </div>
                {!bank.ready && (
                  <div className="rounded-xl bg-secondary p-3 text-xs text-muted-foreground">
                    Адрес возврата (redirect URI), который нужно указать в заявке в Сбер: <code className="select-all break-all text-foreground">{sberUrl}</code>
                  </div>
                )}
                <Button onClick={() => run('connect', { origin: window.location.origin })} disabled={!bank.ready || !!busy} className="bg-emerald-600 hover:bg-emerald-700">
                  <Icon name="Link" size={16} />{busy ? 'Открываю СберБизнес…' : 'Подключить СберБизнес'}
                </Button>
                <p className="text-xs text-muted-foreground">Или добавьте подключения по Access/Refresh Token в Админ-панели → СберБизнес — можно несколько.</p>
              </>
            ) : <p className="text-sm text-amber-700">Подключение выполняет заместитель директора.</p>}
            {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}
          </div>
        </div>
      </div>
    );
  }

  const dayLeft = Math.max(0, bank.limit_day - bank.paid_today);

  return (
    <div className="rounded-2xl border bg-gradient-to-br from-emerald-600 to-emerald-700 p-5 text-white shadow-sm">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-2 text-sm text-emerald-100">
            <Icon name="ShieldCheck" size={16} />СберБизнес подключён{bank.test && ' · тестовый контур'}
          </div>
          <div className="mt-1 text-xl font-semibold">{bank.org?.name}</div>
          <div className="text-sm text-emerald-100">ИНН {bank.org?.inn} · счёт •••• {bank.account?.slice(-4)}{connections > 1 && ` · подключений: ${connections}`}</div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-emerald-100">Выписка</div>
            <div className="font-medium">{bank.last_sync ? new Date(bank.last_sync).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'ещё не загружалась'}</div>
            {bank.last_sync_error && <div className="text-xs text-amber-200">{bank.last_sync_error}</div>}
          </div>
          <div>
            <div className="text-emerald-100">Лимит на сегодня</div>
            <div className="font-medium tabular-nums">{rub(dayLeft)}</div>
            <div className="text-xs text-emerald-100">платёж до {rub(bank.limit_payment)}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canSync && (
            <Button size="sm" variant="secondary" onClick={() => run('sync', { days: 7 })} disabled={!!busy}>
              <Icon name="RefreshCw" size={15} className={busy === 'sync' ? 'animate-spin' : ''} />Обновить выписку
            </Button>
          )}
          {isDeputy && (
            <Button size="sm" variant="secondary" onClick={() => setSettings(settings ? null : { account: bank.account || '', limit_payment: String(bank.limit_payment), limit_day: String(bank.limit_day) })}>
              <Icon name="Settings" size={15} />Настройки
            </Button>
          )}
        </div>
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-emerald-100' : 'text-amber-200'}`}>{msg.text}</p>}
      {settings && (
        <div className="mt-4 grid gap-3 rounded-xl bg-white/10 p-4 sm:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-emerald-100">Расчётный счёт</span>
            <select value={settings.account} onChange={(e) => setSettings({ ...settings, account: e.target.value })} className="h-10 w-full rounded-md border-0 bg-white px-2 text-sm text-foreground">
              {bank.org?.accounts.map((a) => <option key={a.number} value={a.number}>{a.number}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-emerald-100">Лимит одного платежа, ₽</span>
            <Input className="bg-white text-foreground" inputMode="decimal" value={settings.limit_payment} onChange={(e) => setSettings({ ...settings, limit_payment: e.target.value })} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-emerald-100">Лимит оплат в день, ₽</span>
            <Input className="bg-white text-foreground" inputMode="decimal" value={settings.limit_day} onChange={(e) => setSettings({ ...settings, limit_day: e.target.value })} />
          </label>
          <div className="space-y-2 sm:col-span-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => run('bank_settings', settings)} disabled={!!busy}>Сохранить</Button>
              <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => confirm('Отключить СберБизнес? Ключи доступа банка будут удалены.') && run('disconnect')}>Отключить банк</Button>
            </div>
            {bank.cron_key && (
              <p className="text-xs text-emerald-100">
                Ссылка ежедневной автозагрузки (вставьте в планировщик, раз в сутки): <code className="select-all break-all text-white">{sberUrl}?cron={bank.cron_key}</code>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
