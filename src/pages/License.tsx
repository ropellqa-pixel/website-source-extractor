import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import AnodBizLogo from '@/components/AnodBizLogo';
import DocViewer from '@/components/biz/DocViewer';
import { useAuth } from '@/lib/auth';
import { bizCall, BIZ_EMAIL } from '@/lib/bizApi';
import { LEGAL_DOCS } from '@/lib/bizLegal';
import { BizDocument, BizOrg, DOC_STATUS, DOC_TITLES, ORG_STATUS } from '@/lib/bizDocs';
import { dateShort, money } from '@/lib/bizText';
import { downloadWord, downloadZip } from '@/lib/bizRender';

interface LicenseResp {
  org: BizOrg | null;
  license: { allowed: boolean; status?: string; reason?: string; license_until?: string | null };
  documents: BizDocument[];
  is_biz_admin: boolean;
}

export function useLicense() {
  const [data, setData] = useState<LicenseResp | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    const r = await bizCall<LicenseResp>({ action: 'my_license' });
    setData(r.error ? null : r);
    setLoading(false);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { data, loading, reload };
}

export function LicenseContent({ data, blocked }: { data: LicenseResp; blocked?: boolean }) {
  const [view, setView] = useState<BizDocument | null>(null);
  const o = data.org;
  const st = ORG_STATUS[o?.status || 'pending'];
  const mailBody = encodeURIComponent(
    `Здравствуйте!\n\nПрошу заключить лицензионный договор на подписку БИЗ (BIZ).\nОрганизация: ${o?.name || ''}\nИНН: ${o?.inn || ''}\nЛицевой счёт: ${o?.account_no || ''}\n\nВо вложении: подписанный лицензионный договор, карточка организации с реквизитами, платёжное поручение.\n`);
  const mailSubject = encodeURIComponent(`Лицензионный договор БИЗ — лицевой счёт ${o?.account_no || ''}`);

  return (
    <div className="space-y-5">
      {blocked && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <div className="flex items-start gap-3">
            <Icon name="Lock" size={26} className="mt-0.5 shrink-0" />
            <div>
              <h1 className="text-xl font-bold">Заключите лицензионный договор на подписку БИЗ (BIZ)</h1>
              <p className="mt-1 text-[15px]">
                {data.license.reason === 'expired' ? 'Срок оплаченной лицензии истёк. ' : ''}
                {data.license.reason === 'blocked' || data.license.reason === 'suspended' ? 'Доступ организации приостановлен. ' : ''}
                {data.license.reason === 'workspace' ? 'Лицензия оформлена, отдельное рабочее пространство вашей организации подготавливается — мы сообщим на почту о готовности. ' : ''}
                Напишите на <a className="font-semibold underline" href={`mailto:${BIZ_EMAIL}?subject=${mailSubject}&body=${mailBody}`}>{BIZ_EMAIL}</a> и прикрепите все необходимые документы. После проверки и оплаты доступ к АнодБИЗ и ПО АБИЗ откроется автоматически.
              </p>
              <a href={`mailto:${BIZ_EMAIL}?subject=${mailSubject}&body=${mailBody}`} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 font-medium text-white hover:bg-amber-700">
                <Icon name="Mail" size={18} /> Написать на {BIZ_EMAIL}
              </a>
            </div>
          </div>
          <div className="mt-5 rounded-2xl bg-white/70 p-4 text-sm">
            <p className="mb-2 font-semibold">Что прикрепить к письму:</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Лицензионный договор (ниже) — распечатать, подписать, поставить печать (при наличии), скан PDF.</li>
              <li>Карточку {o?.org_type === 'ИП' ? 'предпринимателя' : 'организации'} с реквизитами.</li>
              <li>{o?.org_type === 'ИП' ? 'Лист записи ЕГРИП и копию паспорта (страница с ФИО)' : 'Решение/приказ о назначении руководителя или доверенность подписанта'}.</li>
              <li>Платёжное поручение по выставленному счёту (если уже оплатили).</li>
            </ol>
          </div>
        </div>
      )}

      {o && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Лицевой счёт</p>
            <p className="mt-1 font-mono text-3xl font-bold tracking-[0.15em]">{o.account_no}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Статус</p>
            <span className={`mt-2 inline-block rounded-full border px-3 py-1 text-sm font-medium ${st?.cls}`}>{st?.label}</span>
            {o.license_until && <p className="mt-2 text-sm text-muted-foreground">Оплачено до {dateShort(o.license_until)}</p>}
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Тариф</p>
            <p className="mt-1 text-lg font-semibold">Пакет БИЗ</p>
            <p className="text-sm text-muted-foreground">{money(Number(o.monthly_price || 1790))} в месяц</p>
          </div>
        </div>
      )}

      {o && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-1 font-semibold">{o.name}</h2>
          <p className="text-sm text-muted-foreground">ИНН {o.inn}{o.kpp ? ` · КПП ${o.kpp}` : ''} · {o.org_type === 'ИП' ? 'ОГРНИП' : 'ОГРН'} {o.ogrn}</p>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card">
        <div className="flex items-center border-b border-border px-5 py-3">
          <span className="font-semibold">Документы организации</span>
          {data.documents.length > 0 && <button onClick={() => downloadZip(data.documents, `Документы БИЗ лс ${o?.account_no || ''}`, o || undefined)} className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-secondary"><Icon name="Archive" size={16} /> Скачать все</button>}
        </div>
        {data.documents.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Документов пока нет</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.documents.map(d => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Icon name={d.doc_type.includes('certificate') ? 'Award' : d.doc_type === 'invoice' ? 'Receipt' : 'FileText'} size={18} className="text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{d.title || DOC_TITLES[d.doc_type]} № {d.number}</p>
                  <p className="text-xs text-muted-foreground">от {dateShort(d.doc_date)}{d.period_to ? ` · период до ${dateShort(d.period_to)}` : ''}{Number(d.amount) ? ` · ${money(Number(d.amount))}` : ''}</p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs ${DOC_STATUS[d.status]?.cls}`}>{DOC_STATUS[d.status]?.label}</span>
                <button onClick={() => setView(d)} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-secondary">Открыть</button>
                <button onClick={() => downloadWord(d, o || undefined)} className="rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-secondary" title="Скачать Word"><Icon name="FileDown" size={16} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-3 font-semibold">Правовые документы БИЗ</h2>
        <div className="flex flex-wrap gap-2">
          {LEGAL_DOCS.map(d => (
            <Link key={d.slug} to={`/legal/${d.slug}`} target="_blank" className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-secondary">{d.short}</Link>
          ))}
        </div>
      </div>
      <DocViewer doc={view} org={o || undefined} onClose={() => setView(null)} />
    </div>
  );
}

export default function License() {
  const { data, loading } = useLicense();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  if (loading) return <div className="flex min-h-[60vh] items-center justify-center"><Icon name="Loader2" size={32} className="animate-spin" /></div>;
  if (!data) return <div className="p-6 text-center text-muted-foreground">Не удалось загрузить данные лицензии</div>;
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex items-center gap-3">
        <AnodBizLogo size="sm" />
        <h1 className="text-xl font-bold">Лицензия БИЗ</h1>
        {!data.license.allowed && (
          <button onClick={async () => { await signOut(); navigate('/login'); }} className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-secondary">
            <Icon name="LogOut" size={16} /> Выйти
          </button>
        )}
      </div>
      <LicenseContent data={data} blocked={!data.license.allowed} />
    </div>
  );
}
