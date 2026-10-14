import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { sberCall, sberUrl, type SberOverview } from '@/lib/sberApi';

type Cert = { subject: string; org: string; serial: string; valid_from: string; valid_to: string; file_name: string; uploaded_at: string; uploaded_by: string };

const fmtDate = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

export default function SberTab() {
  const [bank, setBank] = useState<(SberOverview['bank'] & { cert?: Cert | null; scope_v1?: string | null; scope_v2?: string | null; has_tokens?: boolean | null; sign_url_template?: string | null }) | null>(null);
  const [scopes, setScopes] = useState({ scope_v1: '', scope_v2: '', sign_url_template: '' });
  const [tokens, setTokens] = useState({ access_token: '', refresh_token: '' });
  const [msg2, setMsg2] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy2, setBusy2] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await sberCall<SberOverview>({ action: 'overview' });
    if (r.error) { setMsg({ ok: false, text: r.error }); return; }
    const b = r.bank as typeof bank;
    setBank(b);
    setScopes({ scope_v1: b?.scope_v1 || '', scope_v2: b?.scope_v2 || '', sign_url_template: b?.sign_url_template || '' });
  }, []);
  useEffect(() => { load(); }, [load]);

  const pick = (f: File) => {
    const reader = new FileReader();
    reader.onload = () => setFile({ name: f.name, data: String(reader.result) });
    reader.readAsDataURL(f);
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true); setMsg(null);
    const r = await sberCall({ action: 'cert_upload', file_name: file.name, file: file.data, password });
    setBusy(false);
    if (r.error) { setMsg({ ok: false, text: r.error }); return; }
    setFile(null); setPassword('');
    setMsg({ ok: true, text: 'Сертификат загружен и проверен' });
    load();
  };

  const save2 = async (action: string, payload: Record<string, unknown>) => {
    setBusy2(action); setMsg2(null);
    const r = await sberCall<{ org?: { name: string } }>({ action, ...payload });
    setBusy2(null);
    if (r.error) { setMsg2({ ok: false, text: r.error }); return; }
    if (action === 'tokens_save') { setTokens({ access_token: '', refresh_token: '' }); setMsg2({ ok: true, text: `Банк подключён: ${r.org?.name || ''}` }); }
    else setMsg2({ ok: true, text: 'Сохранено' });
    load();
  };

  const cert = bank?.cert;
  const daysLeft = cert ? Math.ceil((new Date(cert.valid_to).getTime() - Date.now()) / 86400000) : null;
  const keys: [string, string][] = [['client_id', 'SBER_CLIENT_ID'], ['client_secret', 'SBER_CLIENT_SECRET']];

  return (
    <div className="grid max-w-4xl gap-4 lg:grid-cols-2">
      <div className="space-y-3 rounded-2xl border bg-card p-5">
        <div className="flex items-center gap-2">
          <Icon name="FileKey" fallback="KeyRound" size={18} className="text-emerald-600" />
          <h3 className="font-medium">Сертификат организации</h3>
        </div>
        {cert ? (
          <div className={`rounded-xl p-3 text-sm ${daysLeft !== null && daysLeft <= 30 ? 'bg-amber-500/10' : 'bg-emerald-500/10'}`}>
            <div className="font-medium">{cert.subject || cert.org}</div>
            <div className="text-muted-foreground">Действует до <b className="text-foreground">{fmtDate(cert.valid_to)}</b>
              {daysLeft !== null && <> · {daysLeft > 0 ? `осталось ${daysLeft} дн.` : 'истёк'}</>}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{cert.file_name} · загрузил {cert.uploaded_by}, {fmtDate(cert.uploaded_at)}</div>
            {daysLeft !== null && daysLeft <= 30 && (
              <div className="mt-2 flex items-center gap-1.5 text-amber-800"><Icon name="TriangleAlert" size={15} />Скоро истекает — выпустите новый в СберБизнес и загрузите сюда</div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Сертификат ещё не загружен. Его выпускают в СберБизнес раз в год — файл <b>.p12</b> или <b>.pfx</b> с паролем.</p>
        )}

        <input ref={fileRef} type="file" accept=".p12,.pfx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }} />
        <button onClick={() => fileRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 text-sm text-muted-foreground hover:border-primary hover:text-foreground">
          <Icon name={file ? 'FileCheck' : 'Upload'} size={18} />{file ? file.name : cert ? 'Выбрать новый файл сертификата' : 'Выбрать файл .p12 / .pfx'}
        </button>
        {file && (
          <>
            <Input type="password" autoComplete="new-password" placeholder="Пароль от сертификата" value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="flex gap-2">
              <Button onClick={upload} disabled={busy}>{busy ? 'Проверяю…' : 'Загрузить'}</Button>
              <Button variant="ghost" onClick={() => { setFile(null); setPassword(''); }}>Отмена</Button>
            </div>
          </>
        )}
        {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}
        <p className="text-xs text-muted-foreground">
          Файл и пароль хранятся в зашифрованном виде и никому не показываются. Перед сохранением проверяется, что пароль подходит и срок не истёк.
        </p>
      </div>

      <div className="space-y-3 rounded-2xl border bg-card p-5">
        <div className="flex items-center gap-2">
          <Icon name="Landmark" size={18} className="text-emerald-600" />
          <h3 className="font-medium">Подключение к банку</h3>
        </div>
        {bank && (
          <>
            <div className="space-y-1.5">
              {keys.map(([k, n]) => (
                <div key={k} className="flex items-center gap-2 text-sm">
                  <Icon name={bank.configured[k] ? 'CircleCheck' : 'CircleDashed'} size={16} className={bank.configured[k] ? 'text-emerald-600' : 'text-muted-foreground'} />
                  <code className="text-xs">{n}</code><span className="text-xs text-muted-foreground">— в секретах проекта</span>
                </div>
              ))}
              <div className="flex items-center gap-2 text-sm">
                <Icon name={cert ? 'CircleCheck' : 'CircleDashed'} size={16} className={cert ? 'text-emerald-600' : 'text-muted-foreground'} />
                Сертификат <span className="text-xs text-muted-foreground">— загружается здесь</span>
              </div>
            </div>
            <div className="rounded-xl bg-secondary p-3 text-xs text-muted-foreground">
              Адрес возврата для заявки в Сбер: <code className="select-all break-all text-foreground">{sberUrl}</code>
            </div>
            <div className={`flex items-center gap-2 text-sm ${bank.connected ? 'text-emerald-700' : 'text-muted-foreground'}`}>
              <Icon name={bank.connected ? 'ShieldCheck' : 'ShieldOff'} size={16} />
              {bank.connected ? `Подключено: ${bank.org?.name || ''}` : 'Банк ещё не подключён'}
            </div>
            <Button asChild variant="outline"><Link to="/sber"><Icon name="ArrowRight" size={15} />Перейти в раздел СБЕР</Link></Button>
          </>
        )}
      </div>

      <div className="space-y-3 rounded-2xl border bg-card p-5">
        <div className="flex items-center gap-2"><Icon name="ListChecks" size={18} className="text-emerald-600" /><h3 className="font-medium">Scope (права доступа)</h3></div>
        <p className="text-xs text-muted-foreground">Скопируйте из кабинета Сбер API. Можно через пробел или запятую.</p>
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">Scope для авторизации v1</span>
          <textarea value={scopes.scope_v1} onChange={(e) => setScopes({ ...scopes, scope_v1: e.target.value })} rows={3} className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">Scope для авторизации v2 (используется для входа)</span>
          <textarea value={scopes.scope_v2} onChange={(e) => setScopes({ ...scopes, scope_v2: e.target.value })} rows={3} className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">Ссылка подписания платёжки (если Сбер дал свою, с {'{externalId}'})</span>
          <Input value={scopes.sign_url_template} placeholder="необязательно" onChange={(e) => setScopes({ ...scopes, sign_url_template: e.target.value })} className="font-mono text-xs" />
        </label>
        <Button size="sm" onClick={() => save2('scopes_save', scopes)} disabled={!!busy2}>Сохранить</Button>
      </div>

      <div className="space-y-3 rounded-2xl border bg-card p-5">
        <div className="flex items-center gap-2"><Icon name="KeyRound" size={18} className="text-emerald-600" /><h3 className="font-medium">Ключи доступа (токены)</h3></div>
        <p className="text-xs text-muted-foreground">
          Если в кабинете Сбер API выданы Access Token и Refresh Token — вставьте их, банк подключится без входа через СберБизнес.
          Дальше токены обновляются сами. {bank?.has_tokens && <b className="text-emerald-700">Токены уже сохранены.</b>}
        </p>
        <Input type="password" autoComplete="off" placeholder="Access Token" value={tokens.access_token} onChange={(e) => setTokens({ ...tokens, access_token: e.target.value })} />
        <Input type="password" autoComplete="off" placeholder="Refresh Token" value={tokens.refresh_token} onChange={(e) => setTokens({ ...tokens, refresh_token: e.target.value })} />
        <Button size="sm" onClick={() => save2('tokens_save', tokens)} disabled={!!busy2 || (!tokens.access_token && !tokens.refresh_token)}>
          {busy2 === 'tokens_save' ? 'Проверяю в банке…' : 'Сохранить и подключить'}
        </Button>
        <p className="text-xs text-muted-foreground">Хранятся зашифрованно, обратно не показываются.</p>
      </div>
      {msg2 && <p className={`text-sm lg:col-span-2 ${msg2.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg2.text}</p>}
    </div>
  );
}
