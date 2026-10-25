import { blank, dateLong, dateShort, esc, initialsName, money, plural, rublesWords } from '@/lib/bizText';
import { DEFAULT_TARIFF, DEFAULT_VENDOR, LEGAL_VERSION, Tariff, Vendor, vendorRequisites } from '@/lib/bizLegal';

export interface BizOrg {
  id?: string; account_no?: string; org_type?: string; name?: string; full_name?: string; inn?: string; kpp?: string;
  ogrn?: string; okved?: string; legal_address?: string; postal_address?: string; director_name?: string;
  director_position?: string; director_basis?: string; contact_name?: string; email?: string; phone?: string;
  bank_name?: string; bik?: string; bank_account?: string; corr_account?: string;
  status?: string; license_until?: string | null; monthly_price?: number; notes?: string; created_at?: string;
  users_count?: number; docs_count?: number; last_login?: string | null; tariff?: string; users_limit?: number;
  consent?: Record<string, unknown>;
}

export interface BizDocument {
  id: string; org_id: string; doc_type: string; number: string; doc_date: string;
  period_from?: string | null; period_to?: string | null; months: number; amount: number; status: string;
  snapshot: { vendor?: Vendor; tariff?: Tariff; org?: BizOrg; base_number?: string; base_date?: string };
  note?: string; created_at?: string; signed_at?: string | null; org_name?: string; account_no?: string;
  custom_html?: string; title?: string; edited_at?: string | null; edited_by?: string;
}

export const DOC_TITLES: Record<string, string> = {
  license_agreement: 'Лицензионный договор',
  contract: 'Договор',
  service_contract: 'Договор на сопровождение',
  license_issue: 'Акт о выдаче лицензии',
  usage_certificate: 'Свидетельство о праве пользования (БИЗ)',
  certificate_web: 'Свидетельство — АнодБИЗ (сайт-платформа)',
  certificate_win: 'Свидетельство — ПО АБИЗ (ОС Windows)',
  access_director: 'Свидетельство о доступе — директор',
  access_deputy: 'Свидетельство о доступе — зам. директора',
  access_senior: 'Свидетельство о доступе — старший сотрудник',
  skud_commissioning: 'Свидетельство о вводе СКУД в эксплуатацию',
  skud_access: 'Свидетельство о доступе к СКУД (ключ-карты)',
  legal_registration: 'Свидетельство о регистрации и лицевом счёте',
  legal_data: 'Свидетельство о хранении и защите данных',
  invoice: 'Счёт на оплату',
  act: 'Акт предоставления прав',
  pd_assignment: 'Поручение на обработку ПДн',
  pd_consent: 'Согласие на обработку ПДн',
  nda: 'Соглашение о конфиденциальности',
  edo_agreement: 'Соглашение об ЭДО',
  supplementary: 'Дополнительное соглашение',
  reconciliation: 'Акт сверки',
  suspension_notice: 'Уведомление о приостановлении',
  termination: 'Соглашение о расторжении',
};

export const DOC_GROUPS: { title: string; types: string[] }[] = [
  { title: 'Договоры', types: ['license_agreement', 'contract', 'service_contract', 'supplementary', 'termination'] },
  { title: 'Лицензия и права', types: ['license_issue', 'usage_certificate', 'certificate_web', 'certificate_win', 'act'] },
  { title: 'Свидетельства о доступе', types: ['access_director', 'access_deputy', 'access_senior'] },
  { title: 'СКУД', types: ['skud_commissioning', 'skud_access'] },
  { title: 'Юридические свидетельства', types: ['legal_registration', 'legal_data'] },
  { title: 'Персональные данные и ЭДО', types: ['pd_assignment', 'pd_consent', 'nda', 'edo_agreement'] },
  { title: 'Расчёты и уведомления', types: ['invoice', 'reconciliation', 'suspension_notice'] },
];

export const DOC_STATUS: Record<string, { label: string; cls: string }> = {
  issued: { label: 'Выставлен', cls: 'bg-slate-100 text-slate-700' },
  sent: { label: 'Отправлен', cls: 'bg-blue-50 text-blue-700' },
  signed: { label: 'Подписан', cls: 'bg-emerald-50 text-emerald-700' },
  paid: { label: 'Оплачен', cls: 'bg-emerald-50 text-emerald-700' },
  cancelled: { label: 'Аннулирован', cls: 'bg-red-50 text-red-700' },
};

export const ORG_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Ожидает договора', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  active: { label: 'Лицензия активна', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  suspended: { label: 'Приостановлена', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  blocked: { label: 'Заблокирована', cls: 'bg-red-50 text-red-700 border-red-200' },
  terminated: { label: 'Договор расторгнут', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export const isIp = (o: BizOrg) => o.org_type === 'ИП';

export function orgTitle(o: BizOrg): string {
  if (isIp(o)) return `Индивидуальный предприниматель ${esc(o.director_name || o.name)}`;
  return esc(o.full_name || o.name);
}

export function orgParty(o: BizOrg, role: string): string {
  if (isIp(o)) {
    return `${orgTitle(o)}, ОГРНИП ${blank(o.ogrn, 15)}, ИНН ${blank(o.inn, 12)}, именуемый в дальнейшем «${role}», действующий на основании ${esc(o.director_basis || 'свидетельства о государственной регистрации')}`;
  }
  return `${orgTitle(o)}, ОГРН ${blank(o.ogrn, 13)}, ИНН ${blank(o.inn, 10)}, именуемое в дальнейшем «${role}», в лице ${esc(o.director_position || 'Генерального директора')} ${blank(o.director_name, 30)}, действующего на основании ${esc(o.director_basis || 'Устава')}`;
}

export function vendorParty(v: Vendor, role: string): string {
  return `${esc(v.full_name)}, ОГРН ${esc(v.ogrn)}, ИНН ${esc(v.inn)}, именуемое в дальнейшем «${role}», в лице ${esc(v.director_position || 'Генерального директора')} ${blank(v.director_name, 30)}, действующего на основании ${esc(v.director_basis || 'Устава')}`;
}

export function orgRequisites(o: BizOrg): string {
  return `<p><b>${orgTitle(o)}</b><br/>
  ${isIp(o) ? '' : `Сокращённое наименование: ${esc(o.name)}<br/>`}
  ИНН ${blank(o.inn)}${isIp(o) ? '' : ` / КПП ${blank(o.kpp, 9)}`}<br/>
  ${isIp(o) ? 'ОГРНИП' : 'ОГРН'} ${blank(o.ogrn)}<br/>
  ${isIp(o) ? 'Адрес регистрации' : 'Юридический адрес'}: ${blank(o.legal_address, 40)}<br/>
  Почтовый адрес: ${blank(o.postal_address || o.legal_address, 40)}<br/>
  Банк: ${blank(o.bank_name, 30)}, БИК ${blank(o.bik, 9)}<br/>
  Р/с ${blank(o.bank_account, 20)}, К/с ${blank(o.corr_account, 20)}<br/>
  E-mail: ${blank(o.email)}, тел. ${blank(o.phone)}<br/>
  Лицевой счёт БИЗ: <b>${esc(o.account_no)}</b></p>`;
}

export function signs(v: Vendor, o: BizOrg, left = 'Лицензиар', right = 'Лицензиат'): string {
  const oPos = isIp(o) ? 'Индивидуальный предприниматель' : (o.director_position || 'Генеральный директор');
  return `<table class="sign"><tr>
    <td><b>${left}:</b><br/>${esc(v.short_name)}<br/>${esc(v.director_position || 'Генеральный директор')}<br/><br/>_______________ / ${blank(initialsName(v.director_name || ''), 16)}<br/><span class="muted">М.П.</span></td>
    <td><b>${right}:</b><br/>${isIp(o) ? orgTitle(o) : esc(o.name)}<br/>${esc(oPos)}<br/><br/>_______________ / ${blank(initialsName(o.director_name || ''), 16)}<br/><span class="muted">М.П. (при наличии)</span></td>
  </tr></table>`;
}

export function headerLine(num: string, date: string, v: Vendor): string {
  return `<table class="plain"><tr><td>${esc(v.city || 'г. ____________')}</td><td class="right">${dateLong(date)}</td></tr></table>`
    + (num ? '' : '');
}

export function period(d: BizDocument): string {
  if (!d.period_from) return 'с даты выдачи лицензии на оплаченный период';
  return `с ${dateShort(d.period_from)} по ${dateShort(d.period_to)} (${d.months} ${plural(d.months, 'месяц', 'месяца', 'месяцев')})`;
}

export function baseRef(d: BizDocument): string {
  const s = d.snapshot;
  return s.base_number ? `Лицензионному договору № ${esc(s.base_number)} от ${dateShort(s.base_date)}` : 'Лицензионному договору (оферте)';
}

function licenseAgreement(d: BizDocument, v: Vendor, t: Tariff, o: BizOrg): string {
  return `<h1>ЛИЦЕНЗИОННЫЙ ДОГОВОР № ${esc(d.number)}</h1>
  <p class="center">о предоставлении права использования программ для ЭВМ структуры БИЗ<br/>(«АнодБИЗ» и «ПО АБИЗ») на условиях простой (неисключительной) лицензии</p>
  ${headerLine(d.number, d.doc_date, v)}
  <p>${vendorParty(v, 'Лицензиар')}, с одной стороны, и ${orgParty(o, 'Лицензиат')}, с другой стороны, совместно именуемые «Стороны», заключили настоящий договор о нижеследующем.</p>
  <h2>1. Предмет договора</h2>
  <p>1.1. Лицензиар предоставляет Лицензиату право использования программ для ЭВМ: веб-сервиса «АнодБИЗ» (https://bizwor.ru) и программы «ПО АБИЗ» для ОС Windows, входящих в структуру БИЗ (далее — Программы), на условиях простой (неисключительной) лицензии, а Лицензиат обязуется уплачивать вознаграждение (ст. 1235, 1286 ГК РФ).</p>
  <p>1.2. Способы использования: воспроизведение (запуск, запись в память ЭВМ), использование функциональных возможностей Программ через сеть «Интернет» и на рабочих местах Лицензиата для собственных хозяйственных нужд. Территория — весь мир. Тариф — «${esc(t.name || 'Пакет БИЗ')}». Лицевой счёт Лицензиата — <b>${esc(o.account_no)}</b>.</p>
  <p>1.3. Право использования предоставляется на оплаченные периоды. Начало каждого периода и выдача лицензии оформляются Актом о выдаче лицензии и Свидетельством о праве пользования.</p>
  <p>1.4. Лицензиат не вправе предоставлять сублицензии, распространять, модифицировать, декомпилировать Программы, обходить технические средства защиты.</p>
  <h2>2. Вознаграждение</h2>
  <p>2.1. Вознаграждение составляет ${money(Number(t.price ?? 1790))} (${rublesWords(Number(t.price ?? 1790))}) за один календарный месяц. ${esc(v.vat_note || 'НДС не облагается')}.</p>
  <p>2.2. Оплата — авансом на основании счёта Лицензиара в течение 5 (пяти) банковских дней. Обязательство по оплате исполнено с момента зачисления средств на счёт Лицензиара.</p>
  <p>2.3. По окончании оплаченного периода Стороны подписывают Акт предоставления прав. При отсутствии мотивированных возражений в течение 5 рабочих дней акт считается подписанным.</p>
  <h2>3. Права и обязанности</h2>
  <p>3.1. Лицензиар обязуется обеспечить доступ к Программам в оплаченный период, хранить данные Лицензиата на серверах в РФ, выпускать обновления и оказывать консультации по адресу ${esc(v.email || 'do@bizwor.ru')}.</p>
  <p>3.2. Лицензиат обязуется использовать Программы по назначению, обеспечить конфиденциальность учётных данных, своевременно вносить оплату, получить необходимые согласия своих работников на обработку персональных данных.</p>
  <p>3.3. Лицензиар вправе приостановить доступ при просрочке оплаты, нарушении п. 1.4 и по требованию уполномоченных органов. Данные Лицензиата при этом сохраняются не менее 30 дней.</p>
  <h2>4. Персональные данные</h2>
  <p>4.1. Лицензиат поручает Лицензиару обработку персональных данных, вносимых в Программы, на условиях Поручения на обработку персональных данных (ч. 3 ст. 6 Федерального закона № 152-ФЗ), опубликованного в Программах и являющегося неотъемлемой частью договора.</p>
  <h2>5. Ответственность</h2>
  <p>5.1. Совокупная ответственность Лицензиара ограничена суммой вознаграждения за последние 3 (три) месяца. Лицензиар не отвечает за упущенную выгоду и косвенные убытки. Стороны освобождаются от ответственности при обстоятельствах непреодолимой силы.</p>
  <h2>6. Срок действия</h2>
  <p>6.1. Договор вступает в силу с даты подписания и действует 1 (один) год с автоматическим продлением на каждый следующий год, если ни одна из Сторон не заявит об отказе за 30 дней до окончания срока.</p>
  <p>6.2. Лицензиат вправе в любое время отказаться от договора, уведомив Лицензиара письменно. Неиспользованное вознаграждение за полные месяцы возвращается по заявлению.</p>
  <h2>7. Прочие условия</h2>
  <p>7.1. Стороны признают юридическую силу документов, подписанных квалифицированной электронной подписью, а также скан-копий, направленных с адресов электронной почты, указанных в реквизитах, с последующим обменом оригиналами.</p>
  <p>7.2. Претензионный порядок обязателен (срок ответа — 10 рабочих дней). Споры рассматриваются в Арбитражном суде по месту нахождения Лицензиара.</p>
  <p>7.3. Во всём, что не урегулировано договором, Стороны руководствуются Лицензионным договором (офертой) ред. ${LEGAL_VERSION}, опубликованным в Программах, и законодательством РФ.</p>
  <h2>8. Реквизиты и подписи Сторон</h2>
  <table class="plain"><tr><td style="width:50%"><b>Лицензиар</b>${vendorRequisites(v)}</td><td><b>Лицензиат</b>${orgRequisites(o)}</td></tr></table>
  ${signs(v, o)}`;
}

function serviceContract(d: BizDocument, v: Vendor, t: Tariff, o: BizOrg): string {
  return `<h1>ДОГОВОР № ${esc(d.number)}</h1>
  <p class="center">на оказание услуг сопровождения программ структуры БИЗ</p>
  ${headerLine(d.number, d.doc_date, v)}
  <p>${vendorParty(v, 'Исполнитель')}, и ${orgParty(o, 'Заказчик')}, заключили настоящий договор о нижеследующем.</p>
  <h2>1. Предмет</h2>
  <p>1.1. Исполнитель оказывает Заказчику услуги по сопровождению программ «АнодБИЗ» и «ПО АБИЗ»: хостинг и хранение данных на серверах в РФ, резервное копирование, техническая поддержка, консультации, подключение рабочих мест, а Заказчик принимает и оплачивает услуги (ст. 779 ГК РФ).</p>
  <p>1.2. Договор заключён в связи с ${baseRef(d)}. Лицевой счёт Заказчика — <b>${esc(o.account_no)}</b>.</p>
  <h2>2. Стоимость</h2>
  <p>2.1. Стоимость базового сопровождения включена в тариф «${esc(t.name || 'Пакет БИЗ')}» (${money(Number(t.price ?? 1790))} в месяц) и отдельно не оплачивается. Дополнительные работы (доработки, перенос данных, выезд) оплачиваются по отдельно согласованному счёту. ${esc(v.vat_note || 'НДС не облагается')}.</p>
  <h2>3. Порядок оказания</h2>
  <p>3.1. Заявки принимаются на ${esc(v.email || 'do@bizwor.ru')}; срок реакции — до 2 рабочих дней. Услуги за месяц считаются принятыми при отсутствии мотивированных возражений в течение 5 рабочих дней.</p>
  <h2>4. Конфиденциальность</h2>
  <p>4.1. Стороны обязуются не раскрывать сведения, ставшие известными при исполнении договора, в течение срока действия договора и 3 лет после его окончания.</p>
  <h2>5. Срок</h2>
  <p>5.1. Договор действует в течение срока действия Лицензионного договора.</p>
  <h2>6. Реквизиты и подписи</h2>
  <table class="plain"><tr><td style="width:50%"><b>Исполнитель</b>${vendorRequisites(v)}</td><td><b>Заказчик</b>${orgRequisites(o)}</td></tr></table>
  ${signs(v, o, 'Исполнитель', 'Заказчик')}`;
}

function licenseIssue(d: BizDocument, v: Vendor, t: Tariff, o: BizOrg): string {
  return `<h1>АКТ О ВЫДАЧЕ ЛИЦЕНЗИИ № ${esc(d.number)}</h1>
  <p class="center">к ${baseRef(d)}</p>
  ${headerLine(d.number, d.doc_date, v)}
  <p>${vendorParty(v, 'Лицензиар')}, и ${orgParty(o, 'Лицензиат')}, составили настоящий акт о нижеследующем:</p>
  <p>1. Лицензиар выдал, а Лицензиат получил право использования программ для ЭВМ структуры БИЗ на условиях простой (неисключительной) лицензии:</p>
  <table>
    <tr><th>№</th><th>Наименование</th><th>Тариф</th><th>Период</th><th>Сумма</th></tr>
    <tr><td>1</td><td>Веб-сервис «АнодБИЗ» и программа «ПО АБИЗ»</td><td>${esc(t.name || 'Пакет БИЗ')} (${esc(t.code || 'BIZ')})</td><td>${period(d)}</td><td class="right">${money(d.amount)}</td></tr>
  </table>
  <p>2. Лицевой счёт Лицензиата: <b>${esc(o.account_no)}</b>. Лицензия действует до ${dateShort(d.period_to)} включительно и продлевается при оплате следующего периода.</p>
  <p>3. Доступ к Программам предоставлен учётным записям Лицензиата. Лицензиат претензий по объёму и порядку предоставления прав не имеет.</p>
  <p>4. Вознаграждение: ${money(d.amount)} (${rublesWords(d.amount)}). ${esc(v.vat_note || 'НДС не облагается')}.</p>
  ${signs(v, o)}`;
}

function invoice(d: BizDocument, v: Vendor, t: Tariff, o: BizOrg): string {
  const months = Math.max(1, d.months || 1);
  const price = d.amount / months;
  return `<table>
    <tr><td colspan="2" style="width:60%">${blank(v.bank_name, 30)}<br/><span class="muted">Банк получателя</span></td><td>БИК</td><td>${blank(v.bik, 9)}</td></tr>
    <tr><td colspan="2"></td><td>Сч. №</td><td>${blank(v.corr_account, 20)}</td></tr>
    <tr><td>ИНН ${esc(v.inn)}</td><td>КПП ${esc(v.kpp)}</td><td rowspan="2">Сч. №</td><td rowspan="2">${blank(v.bank_account, 20)}</td></tr>
    <tr><td colspan="2">${esc(v.short_name)}<br/><span class="muted">Получатель</span></td></tr>
  </table>
  <h1 style="text-align:left">Счёт на оплату № ${esc(d.number)} от ${dateLong(d.doc_date)}</h1>
  <table class="plain">
    <tr><td style="width:20%">Поставщик:</td><td><b>${esc(v.short_name)}, ИНН ${esc(v.inn)}, КПП ${esc(v.kpp)}, ${blank(v.legal_address, 30)}</b></td></tr>
    <tr><td>Покупатель:</td><td><b>${isIp(o) ? orgTitle(o) : esc(o.name)}, ИНН ${esc(o.inn)}${isIp(o) ? '' : `, КПП ${esc(o.kpp)}`}, ${esc(o.legal_address)}</b></td></tr>
    <tr><td>Основание:</td><td>${baseRef(d)}</td></tr>
  </table>
  <table>
    <tr><th>№</th><th>Наименование</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Сумма</th></tr>
    <tr><td>1</td><td>Вознаграждение за право использования программ «АнодБИЗ» и «ПО АБИЗ», тариф «${esc(t.name || 'Пакет БИЗ')}», лицевой счёт ${esc(o.account_no)}${d.period_from ? `, период ${period(d)}` : ''}</td><td class="right">${months}</td><td>мес.</td><td class="right">${money(price)}</td><td class="right">${money(d.amount)}</td></tr>
  </table>
  <p class="right"><b>Итого: ${money(d.amount)}</b><br/>${esc(v.vat_note || 'Без налога (НДС)')}<br/><b>Всего к оплате: ${money(d.amount)}</b></p>
  <p>Всего наименований 1, на сумму ${money(d.amount)}<br/><b>${rublesWords(d.amount)}</b></p>
  <p class="muted">Оплата в течение 5 банковских дней. В назначении платежа укажите: «Оплата по счёту № ${esc(d.number)}, лицевой счёт ${esc(o.account_no)}». ${esc(v.vat_note || 'НДС не облагается')}.</p>
  <table class="sign"><tr><td>Руководитель _______________ / ${blank(initialsName(v.director_name || ''), 16)}</td><td>Бухгалтер _______________ / ${blank(initialsName(v.director_name || ''), 16)}</td></tr></table>`;
}

function act(d: BizDocument, v: Vendor, t: Tariff, o: BizOrg): string {
  return `<h1>АКТ № ${esc(d.number)}</h1>
  <p class="center">о предоставлении права использования программ для ЭВМ<br/>к ${baseRef(d)}</p>
  ${headerLine(d.number, d.doc_date, v)}
  <p>${vendorParty(v, 'Лицензиар')}, и ${orgParty(o, 'Лицензиат')}, составили настоящий акт о том, что Лицензиар предоставил Лицензиату право использования программ «АнодБИЗ» и «ПО АБИЗ»:</p>
  <table>
    <tr><th>№</th><th>Наименование</th><th>Период</th><th>Кол-во, мес.</th><th>Сумма</th></tr>
    <tr><td>1</td><td>Простая (неисключительная) лицензия, тариф «${esc(t.name || 'Пакет БИЗ')}», лицевой счёт ${esc(o.account_no)}</td><td>${period(d)}</td><td class="right">${d.months || 1}</td><td class="right">${money(d.amount)}</td></tr>
  </table>
  <p>Итого: ${money(d.amount)} (${rublesWords(d.amount)}). ${esc(v.vat_note || 'НДС не облагается')}.</p>
  <p>Права предоставлены в полном объёме и в срок. Лицензиат претензий не имеет.</p>
  ${signs(v, o)}`;
}

export const BASE_RENDERERS: Record<string, (d: BizDocument, v: Vendor, t: Tariff, o: BizOrg) => string> = {
  license_agreement: licenseAgreement,
  service_contract: serviceContract,
  license_issue: licenseIssue,
  invoice,
  act,
};
