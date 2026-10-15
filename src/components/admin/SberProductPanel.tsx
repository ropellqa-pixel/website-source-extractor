import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { sberCall, sberUrl } from '@/lib/sberApi';

export type SberProduct = {
  code: string; title: string; app: string; active: boolean; main: boolean; in_use: boolean; scope: string; scope_v1: string; scope_v2: string;
  client_id: string; redirect_uri: string; back_url: string;
  cert: { subject: string; org: string; valid_to: string; file_name: string; uploaded_at: string; uploaded_by: string } | null;
  configured: { client_id: boolean; client_secret: boolean };
  updated_at: string | null; updated_by: string | null;
};

const Ok = ({ on }: { on: boolean }) => <Icon name={on ? 'CircleCheck' : 'CircleDashed'} size={14} className={on ? 'text-emerald-600' : ''} />;

const fmtDate = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

export default function SberProductPanel({ p, onSaved }: { p: SberProduct; onSaved: (list: SberProduct[]) => void }) {
  const [form, setForm] = useState({ client_id: p.client_id, redirect_uri: p.redirect_uri, back_url: p.back_url, scope_v1: p.scope_v1, scope_v2: p.scope_v2 || p.scope, client_secret: '' });
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const call = async (action: string, payload: Record<string, unknown>, ok: string) => {
    setBusy(action); setMsg(null);
    const r = await sberCall<{ products: SberProduct[] }>({ action, code: p.code, ...payload });
    setBusy(null);
    if (r.error) { setMsg({ ok: false, text: r.error }); return false; }
    onSaved(r.products); setMsg({ ok: true, text: ok });
    return true;
  };

  const pick = (f: File) => {
    const reader = new FileReader();
    reader.onload = () => setFile({ name: f.name, data: String(reader.result) });
    reader.readAsDataURL(f);
  };

  const dirty = !!form.client_secret || (['client_id', 'redirect_uri', 'back_url', 'scope_v1', 'scope_v2'] as const).some((k) => form[k].trim() !== ((k === 'scope_v2' ? p.scope_v2 || p.scope : p[k]) || '').trim());
  const cert = p.cert;
  const daysLeft = cert ? Math.ceil((new Date(cert.valid_to).getTime() - Date.now()) / 86400000) : null;
  const ready = p.configured.client_id && p.configured.client_secret && !!cert;

  return (
    <div className="grid max-w-4xl gap-4 lg:grid-cols-2">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-4 lg:col-span-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600/10"><Icon name="Landmark" size={20} className="text-emerald-600" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-medium">Sber API: {p.app}{p.main && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] text-white">основная интеграция</span>}</div>
          <div className="text-sm text-muted-foreground">{p.title} · {ready ? 'настроено' : 'не все данные заполнены'}</div>
          {p.main && !p.in_use && <div className="mt-1 text-xs text-amber-700">Пока не заполнены Client ID, Client Secret и сертификат — банк работает через PAY</div>}
          {p.main && p.in_use && <div className="mt-1 text-xs text-emerald-700">Сейчас система работает с банком через это приложение</div>}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={p.active} onChange={(e) => call('product_save', { active: e.target.checked }, e.target.checked ? 'Активирован' : 'Отключён')} />
          <span className={p.active ? 'font-medium text-emerald-700' : 'text-muted-foreground'}>{p.active ? 'Активирован' : 'Не активирован'}</span>
        </label>
      </div>

      <div className="space-y-3 rounded-2xl border bg-card p-5">
        <div className="flex items-center gap-2"><Icon name="FileKey" fallback="KeyRound" size={18} className="text-emerald-600" /><h3 className="font-medium">Сертификат шифрования</h3></div>
        {cert ? (
          <div className={`rounded-xl p-3 text-sm ${daysLeft !== null && daysLeft <= 30 ? 'bg-amber-500/10' : 'bg-emerald-500/10'}`}>
            <div className="font-medium">{cert.subject || cert.org}</div>
            <div className="text-muted-foreground">Действует до <b className="text-foreground">{fmtDate(cert.valid_to)}</b>{daysLeft !== null && <> · {daysLeft > 0 ? `осталось ${daysLeft} дн.` : 'истёк'}</>}</div>
            <div className="mt-1 text-xs text-muted-foreground">{cert.file_name} · загрузил {cert.uploaded_by}, {fmtDate(cert.uploaded_at)}</div>
            <button className="mt-2 text-xs text-red-600 hover:underline" onClick={() => confirm('Удалить сертификат этого раздела?') && call('product_cert_delete', {}, 'Сертификат удалён')}>Удалить</button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Свой сертификат для этого приложения — файл <b>.p12</b> или <b>.pfx</b> с паролем.</p>
        )}
        <input ref={fileRef} type="file" accept=".p12,.pfx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }} />
        <button onClick={() => fileRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 text-sm text-muted-foreground hover:border-primary hover:text-foreground">
          <Icon name={file ? 'FileCheck' : 'Upload'} size={18} />{file ? file.name : cert ? 'Заменить сертификат' : 'Выбрать файл .p12 / .pfx'}
        </button>
        {file && (
          <>
            <Input type="password" autoComplete="new-password" placeholder="Пароль от сертификата" value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="flex gap-2">
              {dirty && <p className="flex items-center gap-1.5 text-xs text-amber-700"><Icon name="TriangleAlert" size={14} />Есть несохранённые изменения — нажмите «Сохранить»</p>}
        <Button disabled={!!busy} onClick={async () => { if (await call('product_cert_upload', { file_name: file.name, file: file.data, password }, 'Сертификат загружен и проверен')) { setFile(null); setPassword(''); } }}>
                {busy === 'product_cert_upload' ? 'Проверяю…' : 'Загрузить'}
              </Button>
              <Button variant="ghost" onClick={() => { setFile(null); setPassword(''); }}>Отмена</Button>
            </div>
          </>
        )}
      </div>

      <div className="space-y-3 rounded-2xl border bg-card p-5">
        <div className="flex items-center gap-2"><Icon name="KeyRound" size={18} className="text-emerald-600" /><h3 className="font-medium">Настройки приложения</h3></div>
        <label className="block space-y-1 text-sm">
          <span className="flex items-center gap-1.5 text-muted-foreground"><Ok on={!!p.client_id} />Client ID</span>
          <Input value={form.client_id} placeholder="Вставьте из кабинета Sber API" onChange={(e) => setForm({ ...form, client_id: e.target.value })} className="font-mono text-xs" />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="flex items-center gap-1.5 text-muted-foreground"><Ok on={p.configured.client_secret} />Client Secret</span>
          <Input type="password" autoComplete="off" placeholder={p.configured.client_secret ? 'Сохранён — введите, чтобы заменить' : 'Вставьте из кабинета Sber API'}
            value={form.client_secret} onChange={(e) => setForm({ ...form, client_secret: e.target.value })} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="flex items-center gap-1.5 text-muted-foreground"><Ok on={!!p.redirect_uri} />Redirect URI</span>
          <Input value={form.redirect_uri} placeholder={sberUrl} onChange={(e) => setForm({ ...form, redirect_uri: e.target.value })} className="font-mono text-xs" />
          {!form.redirect_uri && <button type="button" className="text-xs text-emerald-700 hover:underline" onClick={() => setForm({ ...form, redirect_uri: sberUrl })}>Подставить адрес системы</button>}
        </label>
        <label className="block space-y-1 text-sm">
          <span className="flex items-center gap-1.5 text-muted-foreground"><Ok on={!!p.back_url} />Back URL — возврат после подписи платёжки</span>
          <Input value={form.back_url} placeholder={`${window.location.origin}/sber`} onChange={(e) => setForm({ ...form, back_url: e.target.value })} className="font-mono text-xs" />
          {!form.back_url && <button type="button" className="text-xs text-emerald-700 hover:underline" onClick={() => setForm({ ...form, back_url: `${window.location.origin}/sber` })}>Подставить адрес системы</button>}
        </label>
        {(['scope_v1', 'scope_v2'] as const).map((k) => (
          <label key={k} className="block space-y-1 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground"><Ok on={!!p[k]} />Scope для авторизации {k === 'scope_v1' ? 'v1' : 'v2 (используется для входа)'}</span>
            <textarea value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} rows={3} placeholder="openid …"
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" />
          </label>
        ))}
        <Button disabled={!!busy} onClick={async () => { if (await call('product_save', form, 'Сохранено')) setForm({ ...form, client_id: '', client_secret: '' }); }}>
          {busy === 'product_save' ? 'Сохраняю…' : 'Сохранить'}
        </Button>
        <p className="text-xs text-muted-foreground">Ключи и сертификат хранятся зашифрованно и обратно не показываются.</p>
      </div>

      {msg && <p className={`text-sm lg:col-span-2 ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}
      {p.updated_by && <p className="text-xs text-muted-foreground lg:col-span-2">Последнее изменение: {p.updated_by}, {new Date(p.updated_at!).toLocaleString('ru-RU')}</p>}
    </div>
  );
}
