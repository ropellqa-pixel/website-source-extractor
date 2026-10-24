import { blank, dateLong, dateShort, esc, initialsName } from '@/lib/bizText';
import { Tariff, Vendor } from '@/lib/bizLegal';
import { absUrl, letterhead, MARK_URL } from '@/lib/bizLetterhead';
import type { BizDocument, BizOrg } from '@/lib/bizDocs';

interface RoleKind { theme: string; role: string; roleGen: string; level: string; rights: string[] }

const ROLES: Record<string, RoleKind> = {
  access_director: {
    theme: 'gold',
    role: 'Директор',
    roleGen: 'директора',
    level: 'Полный доступ (высший уровень)',
    rights: [
      'Все разделы АнодБИЗ и ПО АБИЗ, включая финансы, бухгалтерию и банк',
      'Создание, изменение и блокировка учётных записей сотрудников, назначение ролей',
      'Подписание платежей и управление интеграциями',
      'Доступ к документам по лицензии и Личному кабинету',
    ],
  },
  access_deputy: {
    theme: 'navy',
    role: 'Заместитель директора',
    roleGen: 'заместителя директора',
    level: 'Расширенный административный доступ',
    rights: [
      'Все рабочие разделы АнодБИЗ и ПО АБИЗ',
      'Административная панель: должности, права, формулы, справочники',
      'Управление рабочими местами (ПК) и устройствами СКУД',
      'Управление сотрудниками в пределах полномочий, выданных директором',
    ],
  },
  access_senior: {
    theme: 'teal',
    role: 'Старший сотрудник',
    roleGen: 'старшего сотрудника',
    level: 'Доступ уровня старшего сотрудника',
    rights: [
      'Рабочие разделы: табель, документы, чат, ДТО, СКУД (в части карт доступа)',
      'Просмотр банковских операций и формирование запросов без права подписи',
      'Работа на рабочих местах ПО АБИЗ, вход по карте и PIN-коду',
      'Без права изменения учётных записей и настроек организации',
    ],
  },
};

export const ACCESS_CERT_TYPES = Object.keys(ROLES);

export const ACCESS_CERT_CSS = `
  .bizdoc .cert2.gold { --c1: #7a5a12; --c2: #d9b45a; --c3: #e8d29b; --c4: #f8efd8; }
  .bizdoc .c-person { text-align: center; font-size: 17pt; font-weight: bold; margin: 2pt 0 0; }
  .bizdoc .c-role { text-align: center; font-size: 13pt; color: var(--c1); font-weight: bold; text-transform: uppercase; letter-spacing: 1pt; margin-bottom: 4pt; }
`;

export function renderAccessCertificate(d: BizDocument, v: Vendor, t: Tariff, o: BizOrg): string {
  const k = ROLES[d.doc_type] || ROLES.access_senior;
  const ip = o.org_type === 'ИП';
  const s = d.snapshot as Record<string, unknown>;
  const person = String(s?.person_name || '');
  const email = String(s?.person_email || '');
  const orgName = ip ? `ИП ${esc(o.director_name || o.name)}` : esc(o.name);
  const base = d.snapshot?.base_number ? `Лицензионного договора № ${esc(d.snapshot.base_number)} от ${dateShort(d.snapshot.base_date)}` : 'Лицензионного договора';
  const periodTxt = d.period_from ? `с ${dateShort(d.period_from)} по ${dateShort(d.period_to)} включительно` : 'на срок действия лицензии организации';
  return `<div class="cert2 ${k.theme}">
    <div class="c-bg"></div>
    <div class="c-mark" style="background-image:url('${absUrl(MARK_URL)}')"></div>
    ${letterhead(v)}
    <div class="c-title">СВИДЕТЕЛЬСТВО</div>
    <div class="c-sub">о предоставлении доступа ${k.roleGen}<br/>к программам «АнодБИЗ» и «ПО АБИЗ»</div>
    <div class="c-num">№ <b>${esc(d.number)}</b> от ${dateLong(d.doc_date)}</div>
    <div class="c-rule"></div>
    <p class="center">Настоящее свидетельство удостоверяет, что</p>
    <div class="c-person">${person ? esc(person) : blank('', 40)}</div>
    <div class="c-role">${k.role}</div>
    <p class="center">${orgName}, ИНН ${esc(o.inn)}, лицевой счёт БИЗ <b>${esc(o.account_no)}</b>,<br/>предоставлен персональный доступ к программам для ЭВМ структуры БИЗ на основании ${base} и решения руководителя организации-лицензиата.</p>
    <table class="c-tab">
      <tr><td>Пользователь</td><td>${person ? esc(person) : blank('', 30)}</td></tr>
      <tr><td>Учётная запись (логин)</td><td>${email ? esc(email) : blank('', 30)}</td></tr>
      <tr><td>Роль в системе</td><td>${k.role}</td></tr>
      <tr><td>Уровень доступа</td><td>${k.level}</td></tr>
      <tr><td>Срок доступа</td><td>${periodTxt}</td></tr>
      <tr><td>Тариф организации</td><td>${esc(t.name || 'Пакет БИЗ')} (${esc(t.code || 'BIZ')})</td></tr>
    </table>
    <p style="margin-top:6pt"><b>Права пользователя:</b></p>
    <ul class="c-scope">${k.rights.map(r => `<li>${r}</li>`).join('')}</ul>
    <p style="font-size:10pt">Доступ является персональным и не подлежит передаче третьим лицам. Пользователь обязан сохранять конфиденциальность пароля и соблюдать требования Федерального закона № 152-ФЗ при работе с персональными данными. Доступ прекращается при увольнении пользователя, изменении его роли, окончании или приостановлении лицензии организации.</p>
    <div class="c-foot">
      <div>Лицензиар:<br/>${esc(v.director_position || 'Генеральный директор')}<br/>${esc(v.short_name)}<br/><br/>_______________ / ${blank(initialsName(v.director_name || ''), 14)}</div>
      <div class="c-seal">М.П.</div>
      <div>Лицензиат:<br/>${ip ? 'Индивидуальный предприниматель' : esc(o.director_position || 'Генеральный директор')}<br/>${orgName}<br/><br/>_______________ / ${blank(initialsName(o.director_name || ''), 14)}</div>
    </div>
    <div class="c-verify">Проверка подлинности: направьте номер свидетельства на ${esc(v.email || 'do@bizwor.ru')} · ${esc(v.site || 'https://bizwor.ru')}</div>
  </div>`;
}
