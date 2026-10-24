import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import AnodBizLogo from '@/components/AnodBizLogo';
import { bizCall } from '@/lib/bizApi';
import { useAuth } from '@/lib/auth';
import { useBizPublic } from '@/pages/Legal';

type Org = Record<string, string>;

const inputCls = 'h-11 w-full rounded-xl border border-input bg-card px-3.5 text-[15px] text-foreground focus:border-ring focus:outline-none focus:ring-4 focus:ring-ring/15';

function F({ label, value, onChange, placeholder, type = 'text', hint, required }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; hint?: string; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium text-foreground/80">{label}{required && <span className="text-red-500"> *</span>}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export default function Register() {
  const { vendor, tariff } = useBizPublic();
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [org, setOrg] = useState<Org>({ org_type: 'ООО' });
  const [authData, setAuthData] = useState({ full_name: '', email: '', password: '', password2: '' });
  const [consent, setConsent] = useState({ offer: false, license: false, privacy: false, pd: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>('');
  const ip = org.org_type === 'ИП';
  const set = (k: string) => (v: string) => setOrg(o => ({ ...o, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (authData.password !== authData.password2) { setError('Пароли не совпадают'); return; }
    const payloadOrg = { ...org, name: ip ? `ИП ${org.director_name || ''}`.trim() : org.name, full_name: ip ? `Индивидуальный предприниматель ${org.director_name || ''}` : org.full_name };
    setBusy(true);
    const r = await bizCall<{ ok?: boolean; account_no?: string }>({ action: 'register', org: payloadOrg, auth: authData, consent });
    if (r.error || !r.ok) { setBusy(false); setError(r.error || 'Не удалось зарегистрироваться'); return; }
    setDone(r.account_no || '');
    try { await signIn(authData.email.trim().toLowerCase(), authData.password); } catch { /* */ }
    setBusy(false);
  };

  if (done) {
    return (
      <div className="auth-bg flex min-h-[100dvh] items-center justify-center px-4 py-8">
        <div className="w-full max-w-[520px] rounded-3xl border border-white/70 bg-card/95 p-8 text-center shadow-pop">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><Icon name="CheckCircle2" size={30} /></div>
          <h1 className="text-2xl font-bold">Организация зарегистрирована</h1>
          <p className="mt-2 text-muted-foreground">Ваш лицевой счёт</p>
          <p className="my-2 font-mono text-4xl font-bold tracking-[0.2em]">{done}</p>
          <p className="mt-4 text-sm text-muted-foreground">Лицензионный договор и счёт уже сформированы в личном кабинете. Чтобы открыть доступ, заключите лицензионный договор на подписку БИЗ.</p>
          <button onClick={() => navigate('/license')} className="mt-6 h-12 w-full rounded-xl bg-primary font-medium text-primary-foreground hover:bg-primary/90">Перейти к документам</button>
        </div>
      </div>
    );
  }

  const legalLink = (slug: string, text: string) => <Link to={`/legal/${slug}`} target="_blank" className="underline underline-offset-2 hover:text-foreground">{text}</Link>;

  return (
    <div className="auth-bg min-h-[100dvh] px-4 py-8">
      <div className="mx-auto w-full max-w-[760px]">
        <div className="mb-6 text-center">
          <AnodBizLogo size="lg" />
          <h1 className="mt-4 font-head text-[28px] font-extrabold tracking-[-0.04em]">Регистрация организации в БИЗ</h1>
          <p className="text-[15px] text-muted-foreground">АнодБИЗ и ПО АБИЗ · {tariff.name} — {tariff.price} ₽ в {tariff.period}</p>
        </div>

        <form onSubmit={submit} className="space-y-5 rounded-3xl border border-white/70 bg-card/95 p-6 shadow-pop sm:p-8">
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3" role="alert">
              <Icon name="AlertCircle" size={16} className="mt-0.5 shrink-0 text-red-600" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <section>
            <h2 className="mb-3 font-semibold">1. Форма</h2>
            <div className="flex flex-wrap gap-2">
              {['ООО', 'АО', 'ПАО', 'НКО', 'ИП'].map(t => (
                <button type="button" key={t} onClick={() => setOrg(o => ({ ...o, org_type: t }))}
                  className={`rounded-xl border px-4 py-2 text-sm font-medium ${org.org_type === t ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-secondary'}`}>
                  {t === 'ИП' ? 'Индивидуальный предприниматель' : t}
                </button>
              ))}
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <h2 className="font-semibold sm:col-span-2">2. Сведения {ip ? 'о предпринимателе' : 'об организации'}</h2>
            {!ip && <F label="Краткое наименование" required value={org.name || ''} onChange={set('name')} placeholder='ООО "Ромашка"' />}
            {!ip && <F label="Полное наименование" value={org.full_name || ''} onChange={set('full_name')} placeholder='Общество с ограниченной ответственностью "Ромашка"' />}
            <F label={ip ? 'ФИО предпринимателя' : 'ФИО руководителя'} required value={org.director_name || ''} onChange={set('director_name')} placeholder="Иванов Иван Иванович" />
            {!ip && <F label="Должность руководителя" value={org.director_position || ''} onChange={set('director_position')} placeholder="Генеральный директор" />}
            {!ip && <F label="Действует на основании" value={org.director_basis || ''} onChange={set('director_basis')} placeholder="Устава" />}
            <F label="ИНН" required value={org.inn || ''} onChange={set('inn')} placeholder={ip ? '12 цифр' : '10 цифр'} />
            {!ip && <F label="КПП" required value={org.kpp || ''} onChange={set('kpp')} placeholder="9 цифр" />}
            <F label={ip ? 'ОГРНИП' : 'ОГРН'} required value={org.ogrn || ''} onChange={set('ogrn')} placeholder={ip ? '15 цифр' : '13 цифр'} />
            <F label="ОКВЭД (основной)" value={org.okved || ''} onChange={set('okved')} placeholder="47.11" />
            <div className="sm:col-span-2"><F label={ip ? 'Адрес регистрации' : 'Юридический адрес'} required value={org.legal_address || ''} onChange={set('legal_address')} placeholder="Индекс, регион, город, улица, дом" /></div>
            <div className="sm:col-span-2"><F label="Почтовый адрес" value={org.postal_address || ''} onChange={set('postal_address')} hint="Если совпадает с юридическим — оставьте пустым" /></div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <h2 className="font-semibold sm:col-span-2">3. Банковские реквизиты</h2>
            <div className="sm:col-span-2"><F label="Банк" value={org.bank_name || ''} onChange={set('bank_name')} placeholder='ПАО "Сбербанк"' /></div>
            <F label="БИК" value={org.bik || ''} onChange={set('bik')} placeholder="9 цифр" />
            <F label="Расчётный счёт" value={org.bank_account || ''} onChange={set('bank_account')} placeholder="20 цифр" />
            <F label="Корр. счёт" value={org.corr_account || ''} onChange={set('corr_account')} placeholder="20 цифр" />
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <h2 className="font-semibold sm:col-span-2">4. Контакты для документов</h2>
            <F label="E-mail организации" required type="email" value={org.email || ''} onChange={set('email')} />
            <F label="Телефон" required value={org.phone || ''} onChange={set('phone')} placeholder="+7" />
            <F label="Контактное лицо" value={org.contact_name || ''} onChange={set('contact_name')} />
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <h2 className="font-semibold sm:col-span-2">5. Учётная запись руководителя</h2>
            <F label="ФИО пользователя" required value={authData.full_name} onChange={v => setAuthData(a => ({ ...a, full_name: v }))} />
            <F label="E-mail для входа" required type="email" value={authData.email} onChange={v => setAuthData(a => ({ ...a, email: v }))} />
            <F label="Пароль" required type="password" value={authData.password} onChange={v => setAuthData(a => ({ ...a, password: v }))} hint="Не менее 8 символов" />
            <F label="Повторите пароль" required type="password" value={authData.password2} onChange={v => setAuthData(a => ({ ...a, password2: v }))} />
          </section>

          <section className="space-y-2 rounded-2xl bg-secondary/50 p-4 text-sm text-muted-foreground">
            {([
              ['license', <>Принимаю условия {legalLink('license', 'Лицензионного договора (оферты)')} на использование программ БИЗ</>],
              ['offer', <>Принимаю {legalLink('offer', 'Договор-оферту на сопровождение')} и {legalLink('dpa', 'Поручение на обработку ПДн')}</>],
              ['privacy', <>Ознакомлен(а) с {legalLink('privacy', 'Политикой обработки персональных данных')}</>],
              ['pd', <>Даю {legalLink('consent', 'согласие на обработку персональных данных')}</>],
            ] as const).map(([k, text]) => (
              <label key={k} className="flex cursor-pointer items-start gap-2.5">
                <input type="checkbox" checked={consent[k]} onChange={e => setConsent(c => ({ ...c, [k]: e.target.checked }))} className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" />
                <span>{text}</span>
              </label>
            ))}
            <p className="pt-1 text-xs">Правообладатель: {vendor.short_name}, ИНН {vendor.inn}. После регистрации доступ откроется после заключения лицензионного договора и оплаты.</p>
          </section>

          <button type="submit" disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {busy ? <Icon name="Loader2" size={18} className="animate-spin" /> : <Icon name="Building2" size={18} />} Зарегистрировать организацию
          </button>
          <p className="text-center text-sm text-muted-foreground">Уже зарегистрированы? <Link to="/login" className="font-medium text-foreground underline">Войти</Link></p>
        </form>
      </div>
    </div>
  );
}
