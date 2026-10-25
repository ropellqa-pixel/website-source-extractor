import { blank, dateLong, dateShort, esc, initialsName } from '@/lib/bizText';
import { Tariff, Vendor } from '@/lib/bizLegal';
import { absUrl, letterhead, MARK_URL } from '@/lib/bizLetterhead';
import type { BizDocument, BizOrg } from '@/lib/bizDocs';

export interface ExtraField { key: string; label: string; placeholder?: string; wide?: boolean; def?: string }

export const PRINT_NO_RE = /^[А-ЯЁA-Z]\d{6}$/;

export const EXTRA_FIELDS: Record<string, ExtraField[]> = {
  skud_commissioning: [
    { key: 'object_name', label: 'Объект (помещение)', placeholder: 'Кафе «Рассвет», служебный вход', wide: true },
    { key: 'object_address', label: 'Адрес объекта', placeholder: 'г. Вельск, ул. Дзержинского, д. 1', wide: true },
    { key: 'controller_model', label: 'Контроллер — модель', placeholder: 'Z-5R Web' },
    { key: 'controller_serial', label: 'Контроллер — серийный №' },
    { key: 'reader_model', label: 'Считыватель — модель', placeholder: 'Matrix-II EH' },
    { key: 'reader_serial', label: 'Считыватель — серийный №' },
    { key: 'button_model', label: 'Кнопка выхода — модель', placeholder: 'ST-EX010' },
    { key: 'button_count', label: 'Кнопок выхода, шт.', def: '1' },
    { key: 'lock_type', label: 'Замок / исполнительное устройство', placeholder: 'Электромагнитный замок 280 кг' },
    { key: 'doors', label: 'Точек прохода, шт.', def: '1' },
    { key: 'installer', label: 'Монтаж и наладку выполнил', placeholder: 'ООО «Компания «Немзор»', wide: true },
    { key: 'commission_date', label: 'Дата ввода в эксплуатацию', placeholder: 'дд.мм.гггг' },
  ],
  skud_access: [
    { key: 'person_position', label: 'Должность сотрудника', placeholder: 'Старший повар' },
    { key: 'card_1', label: 'Ключ-карта № 1' },
    { key: 'card_2', label: 'Ключ-карта № 2' },
    { key: 'card_3', label: 'Ключ-карта № 3' },
    { key: 'card_4', label: 'Ключ-карта № 4' },
    { key: 'card_type', label: 'Тип карт', def: 'EM-Marine 125 кГц' },
    { key: 'zones', label: 'Зоны (точки) доступа', placeholder: 'Служебный вход, склад, кабинет директора', wide: true },
    { key: 'schedule', label: 'Режим доступа', def: 'круглосуточно, без ограничений', wide: true },
  ],
  legal_registration: [],
  legal_data: [
    { key: 'data_location', label: 'Место хранения данных', def: 'серверы на территории Российской Федерации', wide: true },
  ],
};

interface Kind { theme: string; subtitle: string }
const KINDS: Record<string, Kind> = {
  skud_commissioning: { theme: 'graphite', subtitle: 'о вводе в эксплуатацию<br/>системы контроля и управления доступом (СКУД)' },
  skud_access: { theme: 'violet', subtitle: 'о предоставлении доступа<br/>к работе с системой контроля и управления доступом (СКУД)' },
  legal_registration: { theme: 'green', subtitle: 'о регистрации организации в системе БИЗ<br/>и присвоении лицевого счёта' },
  legal_data: { theme: 'copper', subtitle: 'о раздельном хранении и защите данных организации<br/>в системе БИЗ' },
};

export const SKUD_CERT_TYPES = Object.keys(KINDS);

export const SKUD_CERT_CSS = `
  .bizdoc .cert2.graphite { --c1: #263544; --c2: #7d93a8; --c3: #aebccb; --c4: #e3e9ef; }
  .bizdoc .cert2.violet { --c1: #4a2675; --c2: #9c7cc6; --c3: #c6b3df; --c4: #efe8f7; }
  .bizdoc .cert2.green { --c1: #1d5a2c; --c2: #6fb37f; --c3: #a9d4b3; --c4: #e3f2e6; }
  .bizdoc .cert2.copper { --c1: #7f4416; --c2: #cc8d5a; --c3: #e2bc9b; --c4: #f8ebdf; }
  .bizdoc .c-print { align-self: center; font-size: 9pt; color: var(--c1); border: 1px solid var(--c1); border-radius: 3pt; padding: 1pt 8pt; margin: -2pt 0 2pt; background: rgba(255,255,255,.85); letter-spacing: .5pt; }
  .bizdoc .c-print b { font-family: 'Courier New', monospace; font-size: 10pt; }
  .bizdoc .c-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5pt; margin: 2pt 0 5pt; }
  .bizdoc .c-card { border: 1.2pt solid var(--c1); border-radius: 5pt; padding: 4pt 4pt 3pt; text-align: center; background: linear-gradient(135deg, #fff, var(--c4)); }
  .bizdoc .c-card i { display: block; font-style: normal; font-size: 7.5pt; color: var(--c1); text-transform: uppercase; letter-spacing: .5pt; }
  .bizdoc .c-card b { display: block; font-family: 'Courier New', monospace; font-size: 10.5pt; margin-top: 1pt; word-break: break-all; }
  .bizdoc .c-two { display: flex; gap: 10pt; }
  .bizdoc .c-two > div { flex: 1; }
`;

type S = Record<string, unknown>;
const val = (s: S, k: string, n = 24) => (s[k] ? esc(String(s[k])) : blank('', n));

function holderOf(o: BizOrg) {
  const ip = o.org_type === 'ИП';
  return {
    ip,
    full: ip ? `Индивидуальный предприниматель ${esc(o.director_name || o.name)}` : esc(o.full_name || o.name),
    short: ip ? `ИП ${esc(o.director_name || o.name)}` : esc(o.name),
    req: `ИНН ${esc(o.inn)}${ip ? '' : ` · КПП ${esc(o.kpp)}`} · ${ip ? 'ОГРНИП' : 'ОГРН'} ${esc(o.ogrn)} · лицевой счёт БИЗ <b>${esc(o.account_no)}</b>`,
  };
}

function shell(d: BizDocument, v: Vendor, o: BizOrg, body: string, twoSides: boolean): string {
  const k = KINDS[d.doc_type];
  const s = d.snapshot as S;
  const h = holderOf(o);
  const vendorSign = `${twoSides ? 'Исполнитель:<br/>' : ''}${esc(v.director_position || 'Генеральный директор')}<br/>${esc(v.short_name)}<br/><br/>_______________ / ${blank(initialsName(v.director_name || ''), 14)}`;
  const orgSign = `Заказчик:<br/>${h.ip ? 'Индивидуальный предприниматель' : esc(o.director_position || 'Генеральный директор')}<br/>${h.short}<br/><br/>_______________ / ${blank(initialsName(o.director_name || ''), 14)}`;
  return `<div class="cert2 ${k.theme}">
    <div class="c-bg"></div>
    <div class="c-mark" style="background-image:url('${absUrl(MARK_URL)}')"></div>
    ${letterhead(v)}
    <div class="c-title">СВИДЕТЕЛЬСТВО</div>
    <div class="c-sub">${k.subtitle}</div>
    <div class="c-num">№ <b>${esc(d.number)}</b> от ${dateLong(d.doc_date)}</div>
    ${s.print_no ? `<div class="c-print">Отпечаток № <b>${esc(String(s.print_no))}</b></div>` : ''}
    <div class="c-rule"></div>
    ${body}
    <div class="c-foot">
      <div>${vendorSign}</div>
      <div class="c-seal">М.П.</div>
      ${twoSides ? `<div>${orgSign}</div>` : ''}
    </div>
    <div class="c-verify">Проверка подлинности: направьте номер свидетельства${s.print_no ? ' и номер отпечатка' : ''} на ${esc(v.email || 'do@bizwor.ru')} · ${esc(v.site || 'https://bizwor.ru')}</div>
  </div>`;
}

function commissioning(d: BizDocument, v: Vendor, o: BizOrg): string {
  const s = d.snapshot as S;
  const h = holderOf(o);
  const cdate = s.commission_date ? esc(String(s.commission_date)) : dateShort(d.doc_date);
  return shell(d, v, o, `
    <p class="center">Настоящее свидетельство удостоверяет, что на объекте</p>
    <div class="c-holder">${h.full}</div>
    <div class="c-holder-req">${h.req}</div>
    <p class="center">смонтирована, налажена, испытана и <b>введена в эксплуатацию с ${cdate}</b> система контроля и управления доступом (СКУД), подключённая к программам «АнодБИЗ» и «ПО АБИЗ».</p>
    <table class="c-tab">
      <tr><td>Объект</td><td>${val(s, 'object_name', 40)}</td></tr>
      <tr><td>Адрес объекта</td><td>${val(s, 'object_address', 40)}</td></tr>
      <tr><td>Контроллер СКУД</td><td>${val(s, 'controller_model')}, зав. № ${val(s, 'controller_serial', 14)}</td></tr>
      <tr><td>Считыватель карт доступа</td><td>${val(s, 'reader_model')}, зав. № ${val(s, 'reader_serial', 14)}</td></tr>
      <tr><td>Кнопка выхода</td><td>${val(s, 'button_model')} — ${val(s, 'button_count', 3)} шт.</td></tr>
      <tr><td>Исполнительное устройство</td><td>${val(s, 'lock_type', 30)}</td></tr>
      <tr><td>Количество точек прохода</td><td>${val(s, 'doors', 3)}</td></tr>
      <tr><td>Программное обеспечение</td><td>«АнодБИЗ» (раздел «СКУД») и «ПО АБИЗ», лицевой счёт ${esc(o.account_no)}</td></tr>
      <tr><td>Монтаж и наладку выполнил</td><td>${s.installer ? esc(String(s.installer)) : esc(v.short_name)}</td></tr>
      ${s.print_no ? `<tr><td>Номер отпечатка</td><td><b>${esc(String(s.print_no))}</b></td></tr>` : ''}
    </table>
    <p style="margin-top:3pt"><b>Проведённые испытания:</b></p>
    <ul class="c-scope">
      <li>Проход по ключ-картам, отказ в доступе по незарегистрированным картам</li>
      <li>Выход по кнопке, разблокировка замка при пропадании питания (пожарная безопасность)</li>
      <li>Передача событий проходов в журнал СКУД программы «АнодБИЗ» и учёт рабочего времени</li>
    </ul>
    <p style="font-size:9.5pt">Оборудование принято Заказчиком в исправном состоянии, замечаний к работе системы нет. Гарантийное обслуживание осуществляется в период действия лицензии БИЗ. Заказчик обязуется не вносить изменений в схему подключения без согласования с Исполнителем.</p>`, true);
}

function skudAccess(d: BizDocument, v: Vendor, o: BizOrg): string {
  const s = d.snapshot as S;
  const h = holderOf(o);
  const person = String(s.person_name || '');
  const cards = [1, 2, 3, 4].map(i => `<div class="c-card"><i>Ключ-карта ${i}</i><b>${s[`card_${i}`] ? esc(String(s[`card_${i}`])) : '________'}</b></div>`).join('');
  const issued = [1, 2, 3, 4].filter(i => s[`card_${i}`]).length || 4;
  const periodTxt = d.period_from ? `с ${dateShort(d.period_from)} по ${dateShort(d.period_to)} включительно` : 'на срок действия лицензии организации';
  return shell(d, v, o, `
    <p class="center">Настоящее свидетельство удостоверяет, что</p>
    <div class="c-person">${person ? esc(person) : blank('', 40)}</div>
    <div class="c-role">${s.person_position ? esc(String(s.person_position)) : 'должностное лицо'}</div>
    <p class="center">${h.short}, ИНН ${esc(o.inn)}, лицевой счёт БИЗ <b>${esc(o.account_no)}</b>,<br/>предоставлен персональный доступ к работе с системой контроля и управления доступом (СКУД). Выданы ключ-карты (карты доступа):</p>
    <div class="c-cards">${cards}</div>
    <table class="c-tab">
      <tr><td>Сотрудник</td><td>${person ? esc(person) : blank('', 30)}${s.person_position ? `, ${esc(String(s.person_position))}` : ''}</td></tr>
      <tr><td>Выдано карт доступа</td><td>${issued} шт., тип: ${val(s, 'card_type', 16)}</td></tr>
      <tr><td>Зоны (точки) доступа</td><td>${val(s, 'zones', 40)}</td></tr>
      <tr><td>Режим доступа</td><td>${val(s, 'schedule', 30)}</td></tr>
      <tr><td>Срок действия доступа</td><td>${periodTxt}</td></tr>
      ${s.print_no ? `<tr><td>Номер отпечатка</td><td><b>${esc(String(s.print_no))}</b></td></tr>` : ''}
    </table>
    <p style="margin-top:3pt"><b>Сотрудник обязан:</b></p>
    <ul class="c-scope">
      <li>Использовать ключ-карты лично, не передавать их другим лицам</li>
      <li>При утере или повреждении карты немедленно сообщить руководителю для её блокировки</li>
      <li>Вернуть все ключ-карты при увольнении или изменении должности</li>
    </ul>
    <p style="font-size:9.5pt">Проходы по картам фиксируются в журнале СКУД программы «АнодБИЗ» и используются для учёта рабочего времени. Сотрудник ознакомлен с порядком использования СКУД и обработкой его персональных данных (152-ФЗ).<br/>Карты получил: _______________ / ${person ? esc(initialsName(person)) : blank('', 14)} &nbsp;&nbsp; «___» ____________ 20___ г.</p>`, true);
}

function registration(d: BizDocument, v: Vendor, t: Tariff, o: BizOrg): string {
  const h = holderOf(o);
  const s = d.snapshot as S;
  return shell(d, v, o, `
    <p class="center">Настоящее свидетельство удостоверяет, что</p>
    <div class="c-holder">${h.full}</div>
    <div class="c-holder-req">${h.req}</div>
    <p class="center">зарегистрировано в реестре пользователей системы БИЗ правообладателя ${esc(v.short_name)}, и ему присвоен лицевой счёт</p>
    <div class="c-product" style="font-size:22pt;letter-spacing:3pt">${esc(o.account_no)}</div>
    <table class="c-tab">
      <tr><td>Полное наименование</td><td>${h.full}</td></tr>
      <tr><td>ИНН / ${h.ip ? 'ОГРНИП' : 'КПП / ОГРН'}</td><td>${esc(o.inn)}${h.ip ? '' : ` / ${esc(o.kpp)}`} / ${esc(o.ogrn)}</td></tr>
      <tr><td>Юридический адрес</td><td>${o.legal_address ? esc(o.legal_address) : blank('', 40)}</td></tr>
      <tr><td>Руководитель</td><td>${esc(o.director_position || (h.ip ? 'Индивидуальный предприниматель' : 'Генеральный директор'))} ${esc(o.director_name || '')}</td></tr>
      <tr><td>Лицевой счёт БИЗ</td><td><b>${esc(o.account_no)}</b></td></tr>
      <tr><td>Тариф</td><td>${esc(t.name || 'Пакет БИЗ')} (${esc(t.code || 'BIZ')})</td></tr>
      <tr><td>Дата регистрации</td><td>${o.created_at ? dateShort(o.created_at) : dateShort(d.doc_date)}</td></tr>
      ${s.print_no ? `<tr><td>Номер отпечатка</td><td><b>${esc(String(s.print_no))}</b></td></tr>` : ''}
    </table>
    <p style="margin-top:3pt"><b>Лицевой счёт используется:</b></p>
    <ul class="c-scope">
      <li>Для идентификации организации в договорах, счетах, актах и свидетельствах БИЗ</li>
      <li>Для учёта оплат и сроков действия лицензии</li>
      <li>При обращении в поддержку и проверке подлинности документов</li>
    </ul>
    <p style="font-size:9.5pt">Регистрация не является государственной регистрацией и подтверждает договорные отношения с правообладателем в соответствии со ст. 1235, 1286 ГК РФ. Лицевой счёт закрепляется за организацией бессрочно и не передаётся другим лицам.</p>`, false);
}

function dataProtection(d: BizDocument, v: Vendor, o: BizOrg): string {
  const h = holderOf(o);
  const s = d.snapshot as S;
  return shell(d, v, o, `
    <p class="center">Настоящее свидетельство выдано</p>
    <div class="c-holder">${h.full}</div>
    <div class="c-holder-req">${h.req}</div>
    <p class="center">и подтверждает, что данные организации в системе БИЗ хранятся в <b>отдельном изолированном хранилище</b>, недоступном другим организациям-пользователям, и обрабатываются в соответствии с законодательством Российской Федерации.</p>
    <table class="c-tab">
      <tr><td>Оператор хостинга данных</td><td>${esc(v.full_name)}, ИНН ${esc(v.inn)}</td></tr>
      <tr><td>Место хранения данных</td><td>${val(s, 'data_location', 40)}</td></tr>
      <tr><td>Изоляция данных</td><td>отдельное хранилище, закреплённое за лицевым счётом ${esc(o.account_no)}</td></tr>
      <tr><td>Доступ к данным</td><td>только сотрудники организации по персональным учётным записям</td></tr>
      <tr><td>Передача данных</td><td>по защищённому соединению (HTTPS / TLS)</td></tr>
      <tr><td>Основание</td><td>ст. 18 ч. 5, ст. 19 Федерального закона от 27.07.2006 № 152-ФЗ; ст. 1235 ГК РФ</td></tr>
      ${s.print_no ? `<tr><td>Номер отпечатка</td><td><b>${esc(String(s.print_no))}</b></td></tr>` : ''}
    </table>
    <p style="margin-top:3pt"><b>Правообладатель гарантирует:</b></p>
    <ul class="c-scope">
      <li>Хранение и обработку персональных данных граждан РФ на территории Российской Федерации</li>
      <li>Неразглашение данных организации третьим лицам, кроме случаев, предусмотренных законом</li>
      <li>Резервное копирование данных и выдачу их копии по запросу организации</li>
    </ul>
    <p style="font-size:9.5pt">Организация является оператором персональных данных своих сотрудников и поручает правообладателю их обработку по договору поручения. Свидетельство действует в течение срока действия лицензии БИЗ.</p>`, false);
}

export function renderSkudCertificate(d: BizDocument, v: Vendor, t: Tariff, o: BizOrg): string {
  if (d.doc_type === 'skud_commissioning') return commissioning(d, v, o);
  if (d.doc_type === 'skud_access') return skudAccess(d, v, o);
  if (d.doc_type === 'legal_registration') return registration(d, v, t, o);
  return dataProtection(d, v, o);
}
