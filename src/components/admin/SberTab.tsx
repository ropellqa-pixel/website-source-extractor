import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { sberCall, sberUrl, type SberOverview } from '@/lib/sberApi';

type Cert = { subject: string; org: string; serial: string; valid_from: string; valid_to: string; file_name: string; uploaded_at: string; uploaded_by: string };

const fmtDate = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

export default function SberTab() {
  const [bank, setBank] = useState<(SberOverview['bank'] & { cert?: Cert | null }) | null>(null);
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await sberCall<SberOverview>({ action: 'overview' });
    if (r.error) setMsg({ ok: false, text: r.error }); else setBank(r.bank);
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

  const cert = bank?.cert;
  const daysLeft = cert ? Math.ceil((new Date(cert.valid_to).getTime() - Date.now()) / 86400000) : null;
  const keys: [string, string][] = [['client_id', 'SBER_CLIENT_ID'], ['client_secret', 'SBER_CLIENT_SECRET'], ['redirect_uri', 'SBER_REDIRECT_URI']];

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
    </div>
  );
}
