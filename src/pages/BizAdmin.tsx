import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import OrgCard from '@/components/biz/OrgCard';
import DocViewer from '@/components/biz/DocViewer';
import { bizCall } from '@/lib/bizApi';
import { BizDocument, BizOrg, DOC_STATUS, DOC_TITLES, ORG_STATUS } from '@/lib/bizDocs';
import { LEGAL_DOCS, Tariff, Vendor } from '@/lib/bizLegal';
import { dateShort, money } from '@/lib/bizText';
import { downloadLegalWord, downloadWord, downloadZip } from '@/lib/bizRender';

interface Overview {
  organizations: BizOrg[]; documents: BizDocument[];
  audit: { id: number; at: string; actor: string; org_id: string; action: string; details: Record<string, unknown> }[];
  settings: { vendor?: Vendor; tariff?: Tariff };
}

const VENDOR_FIELDS: [keyof Vendor, string][] = [
  ['short_name', 'Краткое наименование'], ['full_name', 'Полное наименование'], ['inn', 'ИНН'], ['kpp', 'КПП'], ['ogrn', 'ОГРН'],
  ['director_name', 'ФИО руководителя'], ['director_position', 'Должность'], ['director_basis', 'Действует на основании'],
  ['legal_address', 'Юридический адрес'], ['postal_address', 'Почтовый адрес'], ['city', 'Город (для договоров)'],
  ['bank_name', 'Банк'], ['bik', 'БИК'], ['bank_account', 'Расчётный счёт'], ['corr_account', 'Корр. счёт'],
  ['email', 'E-mail'], ['phone', 'Телефон'], ['site', 'Сайт'], ['vat_note', 'Отметка о НДС'],
];

const inp = 'h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm';

export default function BizAdmin() {
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'orgs' | 'docs' | 'log' | 'settings' | 'legal'>('orgs');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<BizDocument | null>(null);
  const [vendor, setVendor] = useState<Vendor>({});
  const [tariff, setTariff] = useState<Tariff>({});
  const [saved, setSaved] = useState('');

  const load = useCallback(async () => {
    const r = await bizCall<Overview>({ action: 'admin_overview' });
    if (r.error) { setErr(r.error); return; }
    setData(r);
    setVendor(r.settings.vendor || {});
    setTariff(r.settings.tariff || {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const removeDoc = async (d: BizDocument) => {
    if (!window.confirm(`Удалить документ ${d.number} (${d.org_name})? Действие необратимо и будет записано в журнал.`)) return;
    const reason = window.prompt('Причина удаления (для журнала):', '') || '';
    let r = await bizCall<{ need_force?: boolean }>({ action: 'admin_doc_delete', id: d.id, reason });
    if (r.need_force) {
      if (!window.confirm(`${r.error}\n\nВсё равно удалить?`)) return;
      r = await bizCall({ action: 'admin_doc_delete', id: d.id, reason, force: true });
    }
    if (r.error && !r.need_force) window.alert(r.error);
    load();
  };

  const orgs = useMemo(() => (data?.organizations || []).filter(o =>
    (!status || o.status === status) &&
    (!q || `${o.name} ${o.inn} ${o.account_no} ${o.email} ${o.director_name}`.toLowerCase().includes(q.toLowerCase()))), [data, q, status]);

  const docs = useMemo(() => (data?.documents || []).filter(d =>
    !q || `${d.number} ${d.org_name} ${d.account_no}`.toLowerCase().includes(q.toLowerCase())), [data, q]);

  const stats = useMemo(() => {
    const os = data?.organizations || [];
    const active = os.filter(o => o.status === 'active');
    return {
      total: os.length, active: active.length, pending: os.filter(o => o.status === 'pending').length,
      mrr: active.reduce((s, o) => s + Number(o.monthly_price || 0), 0),
      paid: (data?.documents || []).filter(d => d.doc_type === 'invoice' && d.status === 'paid').reduce((s, d) => s + Number(d.amount || 0), 0),
    };
  }, [data]);

  if (err) return <div className="p-8 text-center text-muted-foreground"><Icon name="ShieldAlert" size={32} className="mx-auto mb-2" />{err}</div>;
  if (!data) return <div className="flex min-h-[50vh] items-center justify-center"><Icon name="Loader2" size={32} className="animate-spin" /></div>;

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><img src="/biz/nemzor-logo.png" alt="" className="h-9 w-9 rounded-lg object-contain" /> Личный кабинет {vendor.short_name || 'ООО "Компания "Немзор"'}</h1>
          <p className="text-sm text-muted-foreground">Правообладатель БИЗ: все организации, лицензии, договоры и документы АнодБИЗ и ПО АБИЗ</p>
        </div>
        <button onClick={load} className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-secondary"><Icon name="RefreshCw" size={16} /> Обновить</button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[['Организаций', stats.total, 'Building2'], ['Активных лицензий', stats.active, 'BadgeCheck'], ['Ждут договора', stats.pending, 'Clock'],
          ['Ежемесячно (активные)', money(stats.mrr), 'TrendingUp'], ['Оплачено по счетам', money(stats.paid), 'Wallet']].map(([l, v, i]) => (
          <div key={String(l)} className="rounded-2xl border border-border bg-card p-4">
            <Icon name={String(i)} size={18} className="mb-1 text-muted-foreground" />
            <p className="text-xl font-bold">{v}</p>
            <p className="text-xs text-muted-foreground">{l}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([['orgs', 'Организации'], ['docs', 'Все документы'], ['log', 'Журнал действий'], ['settings', 'Реквизиты и тариф'], ['legal', 'Правовые документы']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-xl px-3.5 py-2 text-sm ${tab === k ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}>{l}</button>
        ))}
        {(tab === 'orgs' || tab === 'docs') && (
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск: название, ИНН, лицевой счёт, номер" className="ml-auto h-9 w-full rounded-lg border border-input bg-card px-3 text-sm sm:w-80" />
        )}
        {tab === 'orgs' && (
          <select value={status} onChange={e => setStatus(e.target.value)} className="h-9 rounded-lg border border-input bg-card px-2 text-sm">
            <option value="">Все статусы</option>
            {Object.entries(ORG_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        )}
      </div>

      {tab === 'orgs' && (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5">Л/с</th><th>Организация</th><th>ИНН</th><th>Руководитель / контакты</th><th>Статус</th><th>Оплачено до</th><th>Польз.</th><th>Док.</th><th>Последний вход</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {orgs.map(o => (
                <tr key={o.id} onClick={() => setOpen(o.id || null)} className="cursor-pointer hover:bg-secondary/50">
                  <td className="px-4 py-2.5 font-mono font-semibold">{o.account_no}</td>
                  <td><b>{o.name || '—'}</b><br /><span className="text-xs text-muted-foreground">{o.org_type} · с {dateShort(o.created_at)}</span></td>
                  <td className="font-mono text-xs">{o.inn}</td>
                  <td className="text-xs">{o.director_name}<br />{o.email} {o.phone}</td>
                  <td><span className={`rounded-full border px-2 py-0.5 text-xs ${ORG_STATUS[o.status || 'pending']?.cls}`}>{ORG_STATUS[o.status || 'pending']?.label}</span></td>
                  <td>{o.license_until ? dateShort(o.license_until) : '—'}</td>
                  <td>{o.users_count}</td>
                  <td>{o.docs_count}</td>
                  <td className="text-xs">{o.last_login ? new Date(o.last_login).toLocaleString('ru-RU') : '—'}</td>
                </tr>
              ))}
              {orgs.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Ничего не найдено</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'docs' && (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <div className="flex justify-end border-b border-border px-4 py-2">
            <button onClick={() => downloadZip(docs, 'Документы БИЗ — все организации')} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-secondary"><Icon name="Archive" size={16} /> Скачать все ({docs.length}) ZIP</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="px-4 py-2.5">Номер</th><th>Тип</th><th>Организация</th><th>Дата</th><th>Сумма</th><th>Статус</th><th /></tr></thead>
            <tbody className="divide-y divide-border">
              {docs.map(d => (
                <tr key={d.id}>
                  <td className="px-4 py-2 font-mono text-xs">{d.number}</td>
                  <td>{d.title || DOC_TITLES[d.doc_type]}</td>
                  <td><button onClick={() => setOpen(d.org_id)} className="text-left hover:underline">{d.org_name}</button><br /><span className="font-mono text-xs text-muted-foreground">л/с {d.account_no}</span></td>
                  <td>{dateShort(d.doc_date)}</td>
                  <td>{Number(d.amount) ? money(Number(d.amount)) : '—'}</td>
                  <td><span className={`rounded-full px-2 py-0.5 text-xs ${DOC_STATUS[d.status]?.cls}`}>{DOC_STATUS[d.status]?.label}</span></td>
                  <td className="whitespace-nowrap"><button onClick={() => setView(d)} className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-secondary">Открыть / править</button>
                    <button onClick={() => downloadWord(d)} className="ml-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-secondary" title="Скачать Word"><Icon name="FileDown" size={14} /></button>
                    <button onClick={() => removeDoc(d)} className="ml-1 rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50" title="Удалить"><Icon name="Trash2" size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'log' && (
        <div className="space-y-1.5 rounded-2xl border border-border bg-card p-4 text-sm">
          {data.audit.map(a => (
            <div key={a.id} className="flex flex-wrap gap-2 rounded-lg bg-secondary/40 px-3 py-2">
              <span className="text-xs text-muted-foreground">{new Date(a.at).toLocaleString('ru-RU')}</span>
              <b>{a.action}</b><span className="text-xs">{a.actor}</span>
              {a.org_id && <button onClick={() => setOpen(a.org_id)} className="text-xs underline">организация</button>}
              <span className="w-full truncate text-xs text-muted-foreground">{JSON.stringify(a.details)}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'settings' && (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="grid gap-2.5 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2">
            <h2 className="font-semibold sm:col-span-2">Реквизиты правообладателя (подставляются во все документы)</h2>
            {VENDOR_FIELDS.map(([k, l]) => (
              <label key={k} className={k.includes('address') || k === 'full_name' ? 'sm:col-span-2' : ''}>
                <span className="mb-0.5 block text-xs text-muted-foreground">{l}</span>
                <input value={String(vendor[k] || '')} onChange={e => setVendor(v => ({ ...v, [k]: e.target.value }))} className={inp} />
              </label>
            ))}
          </div>
          <div className="space-y-4">
            <div className="space-y-2 rounded-2xl border border-border bg-card p-5">
              <h2 className="font-semibold">Тариф</h2>
              <label className="block text-xs">Название<input value={tariff.name || ''} onChange={e => setTariff(t => ({ ...t, name: e.target.value }))} className={inp} /></label>
              <label className="block text-xs">Код<input value={tariff.code || ''} onChange={e => setTariff(t => ({ ...t, code: e.target.value }))} className={inp} /></label>
              <label className="block text-xs">Цена, ₽ в месяц<input value={String(tariff.price ?? '')} onChange={e => setTariff(t => ({ ...t, price: Number(e.target.value) || 0 }))} className={inp} /></label>
            </div>
            <button onClick={async () => {
              const r = await bizCall({ action: 'admin_save_settings', vendor, tariff });
              setSaved(r.error ? `Ошибка: ${r.error}` : 'Сохранено. Новые документы будут выпускаться с этими реквизитами.');
              load();
            }} className="h-11 w-full rounded-xl bg-primary font-medium text-primary-foreground">Сохранить реквизиты и тариф</button>
            {saved && <p className="text-sm text-muted-foreground">{saved}</p>}
            <p className="text-xs text-muted-foreground">Уже выпущенные документы сохраняют реквизиты на дату выпуска (как и положено юридически).</p>
          </div>
        </div>
      )}

      {tab === 'legal' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LEGAL_DOCS.map(d => (
            <div key={d.slug} className="rounded-2xl border border-border bg-card p-5">
              <Icon name="Scale" size={20} className="mb-2 text-muted-foreground" />
              <p className="font-semibold">{d.short}</p>
              <p className="mb-3 text-xs text-muted-foreground">{d.title}</p>
              <div className="flex gap-2">
                <Link to={`/legal/${d.slug}`} target="_blank" className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary">Открыть</Link>
                <button onClick={() => downloadLegalWord(d.slug, d.title, vendor, tariff)} className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary"><Icon name="FileDown" size={14} /> Word</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <OrgCard orgId={open} onClose={() => setOpen(null)} onChanged={load} />
      <DocViewer doc={view} onClose={() => setView(null)} editable onSaved={load} />
    </div>
  );
}
