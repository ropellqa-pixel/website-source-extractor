import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import DocViewer from '@/components/biz/DocViewer';
import { bizCall } from '@/lib/bizApi';
import { BizDocument, BizOrg, DOC_GROUPS, DOC_STATUS, DOC_TITLES, ORG_STATUS } from '@/lib/bizDocs';
import { downloadWord, downloadZip } from '@/lib/bizRender';
import { dateShort, money } from '@/lib/bizText';
import { EXTRA_FIELDS, PRINT_NO_RE } from '@/lib/bizSkudCerts';

interface OrgUser { id: string; email: string; full_name?: string; role?: string; created_at: string; last_login?: string; is_biz_admin: boolean }
interface Audit { id: number; at: string; actor: string; action: string; details: Record<string, unknown> }

const FIELDS: [string, string][] = [
  ['name', 'Краткое наименование'], ['full_name', 'Полное наименование'], ['org_type', 'Форма'],
  ['inn', 'ИНН'], ['kpp', 'КПП'], ['ogrn', 'ОГРН/ОГРНИП'], ['okved', 'ОКВЭД'],
  ['director_name', 'Руководитель'], ['director_position', 'Должность'], ['director_basis', 'Основание'],
  ['legal_address', 'Юр. адрес'], ['postal_address', 'Почтовый адрес'], ['email', 'E-mail'], ['phone', 'Телефон'],
  ['contact_name', 'Контактное лицо'], ['bank_name', 'Банк'], ['bik', 'БИК'], ['bank_account', 'Р/с'], ['corr_account', 'К/с'],
  ['monthly_price', 'Цена в месяц, ₽'], ['users_limit', 'Лимит рабочих мест (0 — без огр.)'], ['license_until', 'Оплачено до'], ['notes', 'Заметки'],
];

const inp = 'h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm';

export default function OrgCard({ orgId, onClose, onChanged }: { orgId: string | null; onClose: () => void; onChanged: () => void }) {
  const [org, setOrg] = useState<BizOrg | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [docs, setDocs] = useState<BizDocument[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [tab, setTab] = useState<'info' | 'docs' | 'users' | 'log'>('info');
  const [view, setView] = useState<BizDocument | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [act, setAct] = useState({ months: '1', start: '' });
  const [issue, setIssue] = useState({ doc_type: 'invoice', months: '1', amount: '', period_from: '', doc_date: '', person_name: '', person_email: '' });
  const [people, setPeople] = useState<{ full_name: string; email: string; role: string }[]>([]);
  const isAccess = issue.doc_type.startsWith('access_') || issue.doc_type === 'skud_access';
  const extraFields = EXTRA_FIELDS[issue.doc_type];
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [printNo, setPrintNo] = useState('');
  const printOk = !printNo || PRINT_NO_RE.test(printNo.trim().toUpperCase());

  useEffect(() => {
    if (!orgId || !isAccess) return;
    bizCall<{ people: { full_name: string; email: string; role: string }[] }>({ action: 'admin_org_people', id: orgId }).then(r => setPeople(r.people || []));
  }, [orgId, isAccess]);

  const removeDoc = async (d: BizDocument) => {
    if (!window.confirm(`Удалить документ ${d.number}? Действие необратимо и будет записано в журнал.`)) return;
    const reason = window.prompt('Причина удаления (для журнала):', '') || '';
    let r = await bizCall<{ need_force?: boolean }>({ action: 'admin_doc_delete', id: d.id, reason });
    if (r.need_force) {
      if (!window.confirm(`${r.error}\n\nВсё равно удалить?`)) return;
      r = await bizCall({ action: 'admin_doc_delete', id: d.id, reason, force: true });
    }
    setMsg(r.error && !r.need_force ? `Ошибка: ${r.error}` : `Документ ${d.number} удалён`);
    await load(); onChanged();
  };

  const load = useCallback(async () => {
    if (!orgId) return;
    const r = await bizCall<{ org: BizOrg; users: OrgUser[]; documents: BizDocument[]; audit: Audit[] }>({ action: 'admin_org', id: orgId });
    if (r.error) { setMsg(r.error); return; }
    setOrg(r.org); setUsers(r.users); setDocs(r.documents); setAudit(r.audit);
    const f: Record<string, string> = {};
    FIELDS.forEach(([k]) => { const v = (r.org as Record<string, unknown>)[k]; f[k] = v == null ? '' : String(v).slice(0, k === 'license_until' ? 10 : undefined); });
    setForm(f);
  }, [orgId]);

  useEffect(() => { setTab('info'); setMsg(''); setOrg(null); load(); }, [load]);

  const run = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true); setMsg('');
    const r = await bizCall<{ issued?: string[]; number?: string }>(body);
    setBusy(false);
    if (r.error) { setMsg(`Ошибка: ${r.error}`); return; }
    const ws = (r as { workspace_error?: string }).workspace_error;
    setMsg(ws ? `Ошибка: лицензия выдана, но ${ws}` : ok + (r.issued?.length ? `: ${r.issued.join(', ')}` : r.number ? `: ${r.number}` : ''));
    await load(); onChanged();
  };

  const st = ORG_STATUS[org?.status || 'pending'];

  return (
    <Dialog open={!!orgId} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-[1000px] overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3 pr-12">
          <DialogTitle className="text-base">{org?.name || 'Организация'}</DialogTitle>
          {org && <span className="font-mono text-sm text-muted-foreground">л/с {org.account_no}</span>}
          {org && <span className={`rounded-full border px-2.5 py-0.5 text-xs ${st?.cls}`}>{st?.label}</span>}
          {org?.license_until && <span className="text-xs text-muted-foreground">до {dateShort(org.license_until)}</span>}
        </div>
        <div className="flex gap-1 border-b border-border px-4 pt-2">
          {([['info', 'Карточка и лицензия'], ['docs', `Документы (${docs.length})`], ['users', `Пользователи (${users.length})`], ['log', 'Журнал']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-t-lg px-3 py-2 text-sm ${tab === k ? 'border border-b-0 border-border bg-card font-semibold' : 'text-muted-foreground hover:text-foreground'}`}>{l}</button>
          ))}
        </div>
        <div className="max-h-[calc(92vh-110px)] overflow-auto p-5">
          {msg && <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${msg.startsWith('Ошибка') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{msg}</div>}
          {!org ? <Icon name="Loader2" className="mx-auto animate-spin" /> : tab === 'info' ? (
            <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
              <div className="grid gap-2.5 sm:grid-cols-2">
                {FIELDS.map(([k, l]) => (
                  <label key={k} className={k === 'notes' || k.includes('address') || k === 'full_name' ? 'sm:col-span-2' : ''}>
                    <span className="mb-0.5 block text-xs text-muted-foreground">{l}</span>
                    {k === 'notes' ? (
                      <textarea value={form[k] || ''} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className="min-h-[70px] w-full rounded-lg border border-input bg-card p-2.5 text-sm" />
                    ) : k === 'org_type' ? (
                      <select value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className={inp}>{['ООО', 'АО', 'ПАО', 'НКО', 'ИП'].map(t => <option key={t}>{t}</option>)}</select>
                    ) : (
                      <input type={k === 'license_until' ? 'date' : 'text'} value={form[k] || ''} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className={inp} />
                    )}
                  </label>
                ))}
                <button disabled={busy} onClick={() => run({ action: 'admin_save_org', id: org.id, org: form }, 'Сохранено')} className="h-10 rounded-lg bg-primary text-sm font-medium text-primary-foreground sm:col-span-2">Сохранить карточку</button>
                {org.consent && Object.keys(org.consent).length > 0 && (
                  <p className="text-xs text-muted-foreground sm:col-span-2">Согласия при регистрации: {String((org.consent as Record<string, unknown>).at || '')} · IP {String((org.consent as Record<string, unknown>).ip || '')}</p>
                )}
              </div>
              <div className="space-y-4">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                  <p className="mb-2 font-semibold">Выдать / продлить лицензию</p>
                  <label className="mb-2 block text-xs">Месяцев<input value={act.months} onChange={e => setAct(a => ({ ...a, months: e.target.value }))} className={inp} /></label>
                  <label className="mb-3 block text-xs">С даты (пусто — сегодня или продолжение текущей лицензии)<input type="date" value={act.start} onChange={e => setAct(a => ({ ...a, start: e.target.value }))} className={inp} /></label>
                  <p className="mb-2 text-xs text-muted-foreground">Будут выпущены: Акт о выдаче лицензии, 3 Свидетельства (БИЗ, АнодБИЗ, ПО АБИЗ), Акт. Лицензионный договор отметится подписанным. Для организации создаётся отдельное хранилище данных, доступ откроется.</p>
                  <button disabled={busy} onClick={() => run({ action: 'admin_activate', id: org.id, months: Number(act.months), start: act.start || undefined }, 'Лицензия выдана')} className="h-10 w-full rounded-lg bg-emerald-600 text-sm font-medium text-white hover:bg-emerald-700">Выдать лицензию</button>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <p className="mb-2 font-semibold">Статус доступа</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(['active', 'suspended', 'blocked', 'pending', 'terminated'] as const).map(s => (
                      <button key={s} disabled={busy || org.status === s} onClick={() => run({ action: 'admin_set_status', id: org.id, status: s }, `Статус: ${ORG_STATUS[s].label}`)}
                        className={`rounded-lg border px-2 py-1.5 text-xs disabled:opacity-50 ${ORG_STATUS[s].cls}`}>{ORG_STATUS[s].label}</button>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <p className="mb-2 font-semibold">Выставить документ</p>
                  <select value={issue.doc_type} onChange={e => setIssue(i => ({ ...i, doc_type: e.target.value }))} className={`${inp} mb-2`}>
                    {DOC_GROUPS.map(g => (
                      <optgroup key={g.title} label={g.title}>
                        {g.types.map(k => <option key={k} value={k}>{DOC_TITLES[k]}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  {isAccess && (
                    <div className="mb-2 space-y-2">
                      <select value={issue.person_email} onChange={e => {
                        const p = people.find(x => x.email === e.target.value);
                        setIssue(i => ({ ...i, person_email: e.target.value, person_name: p?.full_name || i.person_name }));
                      }} className={inp}>
                        <option value="">— выберите сотрудника —</option>
                        {people.map(p => <option key={p.email} value={p.email}>{p.full_name} ({p.role === 'director' ? 'директор' : p.role === 'deputy_director' ? 'зам. директора' : 'старший сотрудник'})</option>)}
                      </select>
                      <input value={issue.person_name} onChange={e => setIssue(i => ({ ...i, person_name: e.target.value }))} placeholder="ФИО полностью" className={inp} />
                      <input value={issue.person_email} onChange={e => setIssue(i => ({ ...i, person_email: e.target.value }))} placeholder="Логин (e-mail)" className={inp} />
                      <p className="text-[11px] text-muted-foreground">Срок доступа по умолчанию — до окончания лицензии организации.</p>
                    </div>
                  )}
                  {extraFields && (
                    <div className="mb-2 grid grid-cols-2 gap-2 rounded-lg bg-secondary/50 p-2">
                      <label className="col-span-2 text-xs">Номер отпечатка (1 буква и 6 цифр)
                        <input value={printNo} onChange={e => setPrintNo(e.target.value.toUpperCase())} placeholder="А123456" maxLength={7} className={`${inp} font-mono ${printOk ? '' : 'border-red-500'}`} />
                      </label>
                      {extraFields.map(f => (
                        <label key={f.key} className={`text-xs ${f.wide ? 'col-span-2' : ''}`}>{f.label}
                          <input value={extra[f.key] ?? f.def ?? ''} onChange={e => setExtra(x => ({ ...x, [f.key]: e.target.value }))} placeholder={f.placeholder} className={inp} />
                        </label>
                      ))}
                    </div>
                  )}
                  {!extraFields || issue.doc_type === 'skud_access' ? (
                  <div className="mb-2 grid grid-cols-2 gap-2">
                    <label className="text-xs">Месяцев<input value={issue.months} onChange={e => setIssue(i => ({ ...i, months: e.target.value }))} className={inp} /></label>
                    <label className="text-xs">Сумма (пусто — авто)<input value={issue.amount} onChange={e => setIssue(i => ({ ...i, amount: e.target.value }))} className={inp} /></label>
                    <label className="text-xs">Период с<input type="date" value={issue.period_from} onChange={e => setIssue(i => ({ ...i, period_from: e.target.value }))} className={inp} /></label>
                    <label className="text-xs">Дата документа<input type="date" value={issue.doc_date} onChange={e => setIssue(i => ({ ...i, doc_date: e.target.value }))} className={inp} /></label>
                  </div>
                  ) : (
                    <label className="mb-2 block text-xs">Дата документа<input type="date" value={issue.doc_date} onChange={e => setIssue(i => ({ ...i, doc_date: e.target.value }))} className={inp} /></label>
                  )}
                  <button disabled={busy} onClick={() => {
                    const base = docs.find(d => d.doc_type === 'license_agreement' && d.status !== 'cancelled');
                    if (!printOk) { setMsg('Номер отпечатка: 1 буква и 6 цифр, например А123456'); return; }
                    const ex = extraFields ? Object.fromEntries(extraFields.map(f => [f.key, extra[f.key] ?? f.def ?? ''])) : undefined;
                    run({ action: 'admin_issue', org_id: org.id, ...issue, months: Number(issue.months || 0), base_id: base?.id, extra: ex, print_no: printNo.trim() }, 'Документ выпущен');
                  }} className="h-9 w-full rounded-lg border border-border text-sm hover:bg-secondary">Выпустить с номером</button>
                </div>
              </div>
            </div>
          ) : tab === 'docs' ? (
            <>
            <div className="mb-3 flex justify-end">
              <button onClick={() => downloadZip(docs, `Документы ${org.name} лс ${org.account_no}`, org)} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-secondary"><Icon name="Archive" size={16} /> Скачать все (ZIP)</button>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2">Документ</th><th>Дата</th><th>Период</th><th>Сумма</th><th>Статус</th><th /></tr></thead>
              <tbody className="divide-y divide-border">
                {docs.map(d => (
                  <tr key={d.id}>
                    <td className="py-2"><b>{d.title || DOC_TITLES[d.doc_type]}</b>{d.custom_html ? <span className="ml-1 text-[10px] text-amber-600">изм.</span> : null}<br /><span className="font-mono text-xs">{d.number}</span></td>
                    <td>{dateShort(d.doc_date)}</td>
                    <td className="text-xs">{d.period_from ? `${dateShort(d.period_from)} — ${dateShort(d.period_to)}` : '—'}</td>
                    <td>{Number(d.amount) ? money(Number(d.amount)) : '—'}</td>
                    <td>
                      <select value={d.status} onChange={e => run({ action: 'admin_doc_status', id: d.id, status: e.target.value }, 'Статус документа изменён')} className={`rounded-full px-2 py-0.5 text-xs ${DOC_STATUS[d.status]?.cls}`}>
                        {Object.entries(DOC_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </td>
                    <td className="whitespace-nowrap">
                      <button onClick={() => setView(d)} className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-secondary">Открыть / править</button>
                      <button onClick={() => downloadWord(d, org)} className="ml-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-secondary" title="Скачать Word"><Icon name="FileDown" size={14} /></button>
                      <button onClick={() => removeDoc(d)} className="ml-1 rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50" title="Удалить документ"><Icon name="Trash2" size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          ) : tab === 'users' ? (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2">Пользователь</th><th>Роль</th><th>Создан</th><th>Последний вход</th><th>Админ БИЗ</th></tr></thead>
              <tbody className="divide-y divide-border">
                {users.map(u => (
                  <tr key={u.id}>
                    <td className="py-2">{u.full_name || '—'}<br /><span className="text-xs text-muted-foreground">{u.email}</span></td>
                    <td>{u.role || '—'}</td>
                    <td>{dateShort(u.created_at)}</td>
                    <td>{u.last_login ? new Date(u.last_login).toLocaleString('ru-RU') : '—'}</td>
                    <td><input type="checkbox" checked={u.is_biz_admin} onChange={e => run({ action: 'admin_set_biz_admin', user_id: u.id, value: e.target.checked }, 'Права изменены')} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {audit.map(a => (
                <li key={a.id} className="rounded-lg bg-secondary/50 px-3 py-2"><span className="text-xs text-muted-foreground">{new Date(a.at).toLocaleString('ru-RU')} · {a.actor}</span><br /><b>{a.action}</b> <span className="text-xs">{JSON.stringify(a.details)}</span></li>
              ))}
            </ul>
          )}
        </div>
        <DocViewer doc={view} org={org || undefined} onClose={() => setView(null)} editable onSaved={load} />
      </DialogContent>
    </Dialog>
  );
}
