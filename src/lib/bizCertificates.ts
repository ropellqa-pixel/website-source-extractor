import { blank, dateLong, dateShort, esc, initialsName } from '@/lib/bizText';
import { Tariff, Vendor } from '@/lib/bizLegal';
import { absUrl, letterhead, MARK_URL } from '@/lib/bizLetterhead';
import type { BizDocument, BizOrg } from '@/lib/bizDocs';

interface CertKind {
  theme: string; product: string; subtitle: string; scope: string[]; ways: string; env: string;
}

const KINDS: Record<string, CertKind> = {
  usage_certificate: {
    theme: 'navy',
    product: 'Программный комплекс структуры БИЗ<br/>«АнодБИЗ» и «ПО АБИЗ»',
    subtitle: 'о праве пользования программами для ЭВМ структуры БИЗ',
    scope: ['Веб-сервис «АнодБИЗ» — платформа для управления бизнесом', 'Программа для ЭВМ «ПО АБИЗ» для ОС Windows', 'Обновления, базы данных и документация'],
    ways: 'воспроизведение (запуск, запись в память ЭВМ), удалённый доступ через сеть «Интернет», использование функциональных возможностей по назначению',
    env: 'сеть «Интернет» (https://bizwor.ru) и рабочие места Лицензиата под управлением ОС Windows',
  },
  certificate_web: {
    theme: 'teal',
    product: '«АнодБИЗ»<br/><span class="c-small">веб-сервис (сайт-платформа) для управления бизнесом</span>',
    subtitle: 'о праве пользования веб-сервисом «АнодБИЗ»',
    scope: ['Доступ к платформе «АнодБИЗ» через сеть «Интернет» по адресу https://bizwor.ru', 'Все функциональные модули тарифа: табель, зарплата, документы, СКУД, камеры, чат, бухгалтерия', 'Хранение данных Лицензиата на серверах в Российской Федерации'],
    ways: 'воспроизведение в браузере, удалённый доступ к функциям программы через сеть «Интернет» (модель SaaS)',
    env: 'сеть «Интернет», любой современный браузер',
  },
  certificate_win: {
    theme: 'burgundy',
    product: '«ПО АБИЗ»<br/><span class="c-small">программное обеспечение для ОС Windows</span>',
    subtitle: 'о праве пользования программным обеспечением «ПО АБИЗ»',
    scope: ['Установка и запуск программы «ПО АБИЗ» на рабочих местах Лицензиата', 'Режим киоска, вход по картам доступа и PIN-коду, видеорегистрация СКУД', 'Получение обновлений программы в период действия лицензии'],
    ways: 'запись в память ЭВМ (установка), воспроизведение (запуск), использование функциональных возможностей по назначению',
    env: 'ЭВМ Лицензиата под управлением ОС Windows 10/11 (x64)',
  },
};

export const CERT_TYPES = Object.keys(KINDS);

export const CERT_CSS = `
  .bizdoc .cert2 { position: relative; height: 281mm; display: flex; flex-direction: column; padding: 12pt 18pt 10pt; font-size: 11pt; line-height: 1.3; border: 2.5pt solid var(--c1); outline: 1pt solid var(--c1); outline-offset: -7pt; box-sizing: border-box; overflow: hidden; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .bizdoc .cert2 > * { position: relative; z-index: 1; }
  .bizdoc .cert2 .c-bg { position: absolute; inset: 0; z-index: 0; opacity: .3; background:
      radial-gradient(circle at 15% 12%, var(--c2) 0, transparent 45%),
      radial-gradient(circle at 88% 90%, var(--c2) 0, transparent 50%),
      repeating-linear-gradient(45deg, var(--c3) 0 1px, transparent 1px 9px),
      repeating-linear-gradient(-45deg, var(--c3) 0 1px, transparent 1px 9px),
      linear-gradient(160deg, var(--c4), #ffffff 55%, var(--c4)); }
  .bizdoc .cert2 .c-mark { position: absolute; z-index: 0; left: 50%; top: 55%; width: 13cm; height: 13cm; transform: translate(-50%, -50%); opacity: .08; background-size: contain; background-repeat: no-repeat; background-position: center; }
  .bizdoc .cert2 .lh { border-bottom-color: var(--c1); margin-bottom: 6pt; }
  .bizdoc .cert2 .lh-logo { width: 58pt; height: 58pt; }
  .bizdoc .cert2 .lh-req { border-color: var(--c1); }
  .bizdoc .c-title { text-align: center; font-size: 28pt; font-weight: bold; letter-spacing: 6pt; color: var(--c1); margin: 4pt 0 0; font-family: 'Times New Roman', serif; }
  .bizdoc .c-sub { text-align: center; font-size: 12.5pt; font-weight: bold; margin: 2pt 0 4pt; text-transform: uppercase; letter-spacing: .5pt; }
  .bizdoc .c-num { text-align: center; font-size: 11.5pt; margin-bottom: 4pt; }
  .bizdoc .c-num b { color: var(--c1); }
  .bizdoc .c-rule { height: 0; border-top: 1pt solid var(--c1); width: 50%; margin: 4pt auto 6pt; }
  .bizdoc .c-holder { text-align: center; font-size: 16pt; font-weight: bold; margin: 6pt 0 2pt; color: #111; }
  .bizdoc .c-holder-req { text-align: center; font-size: 10.5pt; margin-bottom: 6pt; }
  .bizdoc .c-product { text-align: center; font-size: 16pt; font-weight: bold; color: var(--c1); margin: 4pt 0 6pt; line-height: 1.2; }
  .bizdoc .c-small { font-size: 11pt; font-weight: normal; color: #222; }
  .bizdoc .cert2 table.c-tab td { border: 1px solid var(--c1); background: rgba(255,255,255,.75); font-size: 10pt; padding: 2pt 6pt; }
  .bizdoc .cert2 table.c-tab td:first-child { width: 38%; font-weight: bold; color: var(--c1); }
  .bizdoc .c-scope { margin: 2pt 0 4pt 14pt; padding: 0; font-size: 10.5pt; }
  .bizdoc .cert2 p { margin: 0 0 4pt; }
  .bizdoc .c-foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: auto; padding-top: 8pt; gap: 10pt; font-size: 10.5pt; }
  .bizdoc .cert2 .lh { flex-shrink: 0; }
  .bizdoc .c-seal { width: 3cm; height: 3cm; flex-shrink: 0; border: 1.5pt dashed var(--c1); border-radius: 50%; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 9pt; color: var(--c1); }
  .bizdoc .c-verify { font-size: 8.5pt; color: #333; text-align: center; margin-top: 6pt; border-top: 1px solid var(--c1); padding-top: 4pt; }
  .bizdoc .cert2.navy { --c1: #1e3a6e; --c2: #6f8fc9; --c3: #9fb4dc; --c4: #dfe7f5; }
  .bizdoc .cert2.teal { --c1: #0f5e5a; --c2: #4fb3a9; --c3: #8fd1c8; --c4: #d9f1ee; }
  .bizdoc .cert2.burgundy { --c1: #6b1f2e; --c2: #c27a86; --c3: #ddb0b7; --c4: #f5e3e6; }
`;

export function renderCertificate(d: BizDocument, v: Vendor, t: Tariff, o: BizOrg): string {
  const k = KINDS[d.doc_type] || KINDS.usage_certificate;
  const ip = o.org_type === 'ИП';
  const holder = ip ? `Индивидуальный предприниматель ${esc(o.director_name || o.name)}` : esc(o.full_name || o.name);
  const base = d.snapshot?.base_number ? `Лицензионный договор № ${esc(d.snapshot.base_number)} от ${dateShort(d.snapshot.base_date)}` : 'Лицензионный договор (оферта)';
  const periodTxt = d.period_from ? `с ${dateShort(d.period_from)} по ${dateShort(d.period_to)} включительно` : 'на оплаченный период действия лицензии';
  return `<div class="cert2 ${k.theme}">
    <div class="c-bg"></div>
    <div class="c-mark" style="background-image:url('${absUrl(MARK_URL)}')"></div>
    ${letterhead(v)}
    <div class="c-title">СВИДЕТЕЛЬСТВО</div>
    <div class="c-sub">${k.subtitle}</div>
    <div class="c-num">№ <b>${esc(d.number)}</b> от ${dateLong(d.doc_date)}</div>
    <div class="c-rule"></div>
    <p class="center">Настоящее свидетельство выдано</p>
    <div class="c-holder">${holder}</div>
    <div class="c-holder-req">ИНН ${esc(o.inn)}${ip ? '' : ` · КПП ${esc(o.kpp)}`} · ${ip ? 'ОГРНИП' : 'ОГРН'} ${esc(o.ogrn)} · лицевой счёт БИЗ <b>${esc(o.account_no)}</b></div>
    <p class="center">и подтверждает, что указанное лицо является законным пользователем (лицензиатом) на условиях простой (неисключительной) лицензии (ст. 1235, 1286 ГК РФ)</p>
    <div class="c-product">${k.product}</div>
    <table class="c-tab">
      <tr><td>Основание</td><td>${base}</td></tr>
      <tr><td>Правообладатель</td><td>${esc(v.full_name)}, ИНН ${esc(v.inn)}, ОГРН ${esc(v.ogrn)}</td></tr>
      <tr><td>Тариф</td><td>${esc(t.name || 'Пакет БИЗ')} (${esc(t.code || 'BIZ')})</td></tr>
      <tr><td>Срок права пользования</td><td>${periodTxt}</td></tr>
      <tr><td>Способы использования</td><td>${k.ways}</td></tr>
      <tr><td>Среда использования</td><td>${k.env}</td></tr>
      <tr><td>Территория</td><td>весь мир</td></tr>
      <tr><td>Количество рабочих мест</td><td>${o.users_limit ? esc(String(o.users_limit)) : 'без ограничения'}</td></tr>
    </table>
    <p style="margin-top:6pt"><b>Объём предоставленных прав:</b></p>
    <ul class="c-scope">${k.scope.map(s => `<li>${s}</li>`).join('')}</ul>
    <p style="font-size:10pt">Исключительное право на программы для ЭВМ принадлежит правообладателю. Свидетельство не является документом, подтверждающим переход исключительного права, и действует в течение срока права пользования.</p>
    <div class="c-foot">
      <div>${esc(v.director_position || 'Генеральный директор')}<br/>${esc(v.short_name)}<br/><br/>_________________ / ${blank(initialsName(v.director_name || ''), 16)}</div>
      <div class="c-seal">М.П.</div>
    </div>
    <div class="c-verify">Проверка подлинности: направьте номер свидетельства на ${esc(v.email || 'do@bizwor.ru')} · ${esc(v.site || 'https://bizwor.ru')}</div>
  </div>`;
}
