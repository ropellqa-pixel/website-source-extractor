export type ConfiguratorKind = 'condition' | 'function' | 'mode';

export type ParamType = 'number' | 'select' | 'code' | 'codes' | 'weekdays' | 'employee' | 'text' | 'cycle';

export type ParamValue = string | number | string[] | number[];

export interface ConfigParams {
  template: string;
  [key: string]: ParamValue;
}

export interface ConfiguratorRecord {
  id: string;
  company_id?: string | null;
  name: string;
  kind: ConfiguratorKind;
  params: ConfigParams;
  is_active: boolean;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ParamOption {
  value: string;
  label: string;
}

export interface ParamDef {
  key: string;
  label: string;
  type: ParamType;
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  options?: ParamOption[];
  hint?: string;
  placeholder?: string;
  withRest?: boolean;
  withAny?: boolean;
}

export interface SummaryCtx {
  employeeName: (id: string) => string;
}

export interface ConfiguratorTemplate {
  id: string;
  kind: ConfiguratorKind;
  title: string;
  description: string;
  icon: string;
  params: ParamDef[];
  summary: (p: ConfigParams, ctx: SummaryCtx) => string;
}

export const SHIFT_CODES = ['Д', 'Н', 'Дп', 'Нп'] as const;

export const SHIFT_CELL_COLORS: Record<string, string> = {
  '': 'bg-slate-100 text-slate-400',
  'Д': 'bg-green-500/20 text-green-700',
  'Н': 'bg-blue-500/20 text-blue-700',
  'Дп': 'bg-amber-500/20 text-amber-700',
  'Нп': 'bg-purple-500/20 text-purple-700',
};

export const WEEKDAYS: { value: number; short: string; full: string }[] = [
  { value: 1, short: 'Пн', full: 'понедельник' },
  { value: 2, short: 'Вт', full: 'вторник' },
  { value: 3, short: 'Ср', full: 'среда' },
  { value: 4, short: 'Чт', full: 'четверг' },
  { value: 5, short: 'Пт', full: 'пятница' },
  { value: 6, short: 'Сб', full: 'суббота' },
  { value: 7, short: 'Вс', full: 'воскресенье' },
];

export const KIND_META: Record<ConfiguratorKind, { label: string; plural: string; description: string; icon: string; badge: string; accent: string }> = {
  condition: {
    label: 'Условие',
    plural: 'Условия',
    description: 'Правила и ограничения: какие смены могут идти друг за другом, сколько подряд, в какие дни и с кем.',
    icon: 'ShieldCheck',
    badge: 'bg-rose-50 text-rose-700 border-rose-200',
    accent: 'text-rose-600 bg-rose-50',
  },
  function: {
    label: 'Функция',
    plural: 'Функции',
    description: 'Логика действий генератора: автозамены, балансировка часов, пометки подмены, уведомления.',
    icon: 'Workflow',
    badge: 'bg-sky-50 text-sky-700 border-sky-200',
    accent: 'text-sky-600 bg-sky-50',
  },
  mode: {
    label: 'Режим',
    plural: 'Режимы',
    description: 'Формат работы сотрудника: 2/2, сутки через трое, пятидневка, вахта или собственный цикл.',
    icon: 'CalendarRange',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    accent: 'text-emerald-600 bg-emerald-50',
  },
};

export function codeLabel(code: string): string {
  if (code === '') return 'выходной';
  if (code === '*') return 'любая смена';
  return code;
}

export function getStr(p: ConfigParams, key: string, def = ''): string {
  const v = p[key];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : def;
}

export function getNum(p: ConfigParams, key: string, def = 0): number {
  const v = Number(p[key]);
  return Number.isFinite(v) ? v : def;
}

export function getArr<T extends string | number>(p: ConfigParams, key: string): T[] {
  const v = p[key];
  return Array.isArray(v) ? (v as T[]) : [];
}

const REST_ALIASES = new Set(['', 'в', 'вых', '-', '—', '0', 'о', 'x']);

export function parseCycle(text: string): string[] {
  if (!text || !text.trim()) return [];
  return text.split(/[,;]/).map(s => {
    const t = s.trim();
    if (REST_ALIASES.has(t.toLowerCase())) return '';
    const norm = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    return (SHIFT_CODES as readonly string[]).includes(norm) ? norm : '';
  });
}

export function cycleText(cycle: string[]): string {
  return cycle.map(c => c || 'В').join(' → ');
}

export function parseDayList(text: string): number[] {
  if (!text || !text.trim()) return [];
  const out: number[] = [];
  for (const part of text.split(/[,;]+/).map(s => s.trim()).filter(Boolean)) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      if (!isNaN(a) && !isNaN(b)) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i);
    } else {
      const n = parseInt(part);
      if (!isNaN(n)) out.push(n);
    }
  }
  return out.filter(d => d >= 1 && d <= 31);
}

const weekdaysText = (list: number[]) =>
  list.length ? WEEKDAYS.filter(w => list.includes(w.value)).map(w => w.short).join(', ') : 'дни не выбраны';

const codesText = (list: string[]) => (list.length ? list.map(codeLabel).join(', ') : 'любые смены');

const CODE_PARAM = (key: string, label: string, def: string, extra: Partial<ParamDef> = {}): ParamDef => ({
  key, label, type: 'code', default: def, ...extra,
});

const OFFSET_PARAM: ParamDef = {
  key: 'offset', label: 'Сдвиг цикла', type: 'number', default: 0, min: 0, max: 30, suffix: 'дн.',
  hint: 'Сдвигает начало цикла, чтобы совместить график с реальными выходами сотрудника',
};

const SCOPE_PARAM: ParamDef = {
  key: 'scope', label: 'Область', type: 'select', default: 'day',
  options: [
    { value: 'day', label: 'В один и тот же день' },
    { value: 'shift', label: 'В одну смену (день/ночь)' },
  ],
};

export const TEMPLATES: ConfiguratorTemplate[] = [
  {
    id: 'after_x_y', kind: 'condition', icon: 'ArrowRightLeft',
    title: 'После X следует Y',
    description: 'Что обязательно или запрещено ставить на следующий день после указанной смены.',
    params: [
      CODE_PARAM('from', 'После смены', 'Н', { withAny: true }),
      { key: 'rule', label: 'Правило', type: 'select', default: 'must', options: [{ value: 'must', label: 'Обязательно' }, { value: 'forbid', label: 'Запрещено' }] },
      CODE_PARAM('to', 'На следующий день', '', { withRest: true }),
    ],
    summary: p => `После «${codeLabel(getStr(p, 'from'))}» ${getStr(p, 'rule') === 'forbid' ? 'запрещено' : 'обязательно'} «${codeLabel(getStr(p, 'to'))}»`,
  },
  {
    id: 'forbid_sequence', kind: 'condition', icon: 'Ban',
    title: 'Запрет последовательности',
    description: 'Запрещает цепочку смен, например Д → Н или Н → В → Д.',
    params: [{ key: 'pattern', label: 'Последовательность', type: 'cycle', default: 'Д,Н', placeholder: 'Д,Н', hint: 'Коды через запятую, В — выходной' }],
    summary: p => `Запрещено: ${cycleText(parseCycle(getStr(p, 'pattern')))}`,
  },
  {
    id: 'required_sequence', kind: 'condition', icon: 'ListOrdered',
    title: 'Обязательная последовательность',
    description: 'Если стоит смена X, то следующие дни заполняются строго по цепочке.',
    params: [
      CODE_PARAM('from', 'Если смена', 'Д'),
      { key: 'then', label: 'То далее', type: 'cycle', default: 'Н', placeholder: 'Н,В,В', hint: 'Цепочка на следующие дни' },
    ],
    summary: p => `Если «${codeLabel(getStr(p, 'from'))}», далее: ${cycleText(parseCycle(getStr(p, 'then')))}`,
  },
  {
    id: 'max_consecutive', kind: 'condition', icon: 'Repeat',
    title: 'Максимум подряд',
    description: 'Ограничивает количество одинаковых смен подряд.',
    params: [
      CODE_PARAM('code', 'Смена', '*', { withAny: true }),
      { key: 'n', label: 'Не больше', type: 'number', default: 3, min: 1, max: 14, suffix: 'подряд' },
    ],
    summary: p => `Не больше ${getNum(p, 'n')} × «${codeLabel(getStr(p, 'code'))}» подряд`,
  },
  {
    id: 'min_rest_after', kind: 'condition', icon: 'BedDouble',
    title: 'Отдых после серии смен',
    description: 'После N рабочих смен подряд — минимум M выходных подряд.',
    params: [
      { key: 'n', label: 'После смен подряд', type: 'number', default: 2, min: 1, max: 14 },
      { key: 'rest', label: 'Минимум выходных', type: 'number', default: 2, min: 1, max: 7 },
    ],
    summary: p => `После ${getNum(p, 'n')} смен подряд — не менее ${getNum(p, 'rest')} вых.`,
  },
  {
    id: 'max_per_week', kind: 'condition', icon: 'CalendarDays',
    title: 'Максимум смен в неделю',
    description: 'Лимит смен за календарную неделю (Пн–Вс).',
    params: [
      CODE_PARAM('code', 'Смена', '*', { withAny: true }),
      { key: 'n', label: 'Не больше', type: 'number', default: 4, min: 0, max: 7, suffix: 'в неделю' },
    ],
    summary: p => `До ${getNum(p, 'n')} × «${codeLabel(getStr(p, 'code'))}» в неделю`,
  },
  {
    id: 'max_per_month', kind: 'condition', icon: 'CalendarMinus',
    title: 'Максимум смен в месяц',
    description: 'Верхняя граница количества смен за месяц.',
    params: [{ key: 'n', label: 'Не больше', type: 'number', default: 15, min: 0, max: 31, suffix: 'смен' }],
    summary: p => `Не более ${getNum(p, 'n')} смен в месяц`,
  },
  {
    id: 'min_per_month', kind: 'condition', icon: 'CalendarPlus',
    title: 'Минимум смен в месяц',
    description: 'Генератор будет стараться дать сотруднику не меньше N смен.',
    params: [{ key: 'n', label: 'Не меньше', type: 'number', default: 10, min: 0, max: 31, suffix: 'смен' }],
    summary: p => `Не менее ${getNum(p, 'n')} смен в месяц`,
  },
  {
    id: 'weekday_ban', kind: 'condition', icon: 'CalendarX',
    title: 'Запрет на дни недели',
    description: 'Не ставить выбранные смены в выбранные дни недели.',
    params: [
      { key: 'codes', label: 'Смены (пусто — все)', type: 'codes', default: [] },
      { key: 'weekdays', label: 'Дни недели', type: 'weekdays', default: [6, 7] },
    ],
    summary: p => `${codesText(getArr<string>(p, 'codes'))} запрещены: ${weekdaysText(getArr<number>(p, 'weekdays'))}`,
  },
  {
    id: 'weekend_only', kind: 'condition', icon: 'Sun',
    title: 'Только выходные / будни',
    description: 'Сотрудник работает только в субботу-воскресенье или только в будни.',
    params: [{ key: 'scope', label: 'Работает', type: 'select', default: 'weekend', options: [{ value: 'weekend', label: 'Только в выходные (Сб, Вс)' }, { value: 'weekdays', label: 'Только в будни (Пн–Пт)' }] }],
    summary: p => (getStr(p, 'scope') === 'weekdays' ? 'Только будни' : 'Только выходные'),
  },
  {
    id: 'not_with', kind: 'condition', icon: 'UserX',
    title: 'Не в одну смену с сотрудником',
    description: 'Два сотрудника не должны работать вместе.',
    params: [{ key: 'employee', label: 'Сотрудник', type: 'employee', default: '' }, SCOPE_PARAM],
    summary: (p, ctx) => `Не вместе с: ${ctx.employeeName(getStr(p, 'employee')) || 'не выбран'}${getStr(p, 'scope') === 'shift' ? ' (в одну смену)' : ''}`,
  },
  {
    id: 'only_with', kind: 'condition', icon: 'Users',
    title: 'Только вместе с сотрудником',
    description: 'Сотрудник выходит только в те дни, когда работает указанный коллега.',
    params: [{ key: 'employee', label: 'Сотрудник', type: 'employee', default: '' }, SCOPE_PARAM],
    summary: (p, ctx) => `Только вместе с: ${ctx.employeeName(getStr(p, 'employee')) || 'не выбран'}${getStr(p, 'scope') === 'shift' ? ' (в одну смену)' : ''}`,
  },
  {
    id: 'min_rest_hours', kind: 'condition', icon: 'Timer',
    title: 'Минимум часов отдыха',
    description: 'Минимальный перерыв между окончанием одной смены и началом следующей. День начинается в 08:00, ночь — в 20:00.',
    params: [
      { key: 'hours', label: 'Отдых не меньше', type: 'number', default: 24, min: 0, max: 96, suffix: 'ч' },
      { key: 'day_hours', label: 'Длительность Д', type: 'number', default: 12, min: 1, max: 24, suffix: 'ч' },
      { key: 'night_hours', label: 'Длительность Н', type: 'number', default: 12, min: 1, max: 24, suffix: 'ч' },
    ],
    summary: p => `Отдых между сменами ≥ ${getNum(p, 'hours')} ч (Д=${getNum(p, 'day_hours')}ч, Н=${getNum(p, 'night_hours')}ч)`,
  },

  {
    id: 'equal_all', kind: 'function', icon: 'Equal',
    title: 'Поровну смен у всех',
    description: 'Выравнивает количество смен между всеми сотрудниками табеля — СТ, МЛ и ЛБ вместе.',
    params: [{ key: 'weight', label: 'Сила выравнивания', type: 'select', default: 'high', options: [{ value: 'medium', label: 'Средняя' }, { value: 'high', label: 'Сильная' }, { value: 'max', label: 'Максимальная' }] }],
    summary: p => `Смены поровну у всех (${({ medium: 'средне', high: 'сильно', max: 'максимально' } as Record<string, string>)[getStr(p, 'weight')] || 'сильно'})`,
  },
  {
    id: 'auto_substitute', kind: 'function', icon: 'UserRoundCog',
    title: 'Автозамена при отсутствии',
    description: 'Кем заменять сотрудника, если он выпал из графика.',
    params: [{ key: 'by', label: 'Кем заменять', type: 'select', default: 'any', options: [{ value: 'any', label: 'Любым свободным' }, { value: 'senior', label: 'Старшим (СТ)' }, { value: 'junior', label: 'Младшим (МЛ)' }] }],
    summary: p => `Замена: ${({ any: 'любой', senior: 'старший', junior: 'младший' } as Record<string, string>)[getStr(p, 'by')] || 'любой'}`,
  },
  {
    id: 'even_nights', kind: 'function', icon: 'MoonStar',
    title: 'Равномерное распределение ночей',
    description: 'Выравнивает количество ночных смен между всеми сотрудниками с этой функцией.',
    params: [{ key: 'weight', label: 'Сила выравнивания', type: 'select', default: 'medium', options: [{ value: 'low', label: 'Слабая' }, { value: 'medium', label: 'Средняя' }, { value: 'high', label: 'Сильная' }] }],
    summary: p => `Ночи поровну (${({ low: 'слабо', medium: 'средне', high: 'сильно' } as Record<string, string>)[getStr(p, 'weight')] || 'средне'})`,
  },
  {
    id: 'weekend_priority', kind: 'function', icon: 'Heart',
    title: 'Приоритет выходных по желанию',
    description: 'Генератор старается оставить выбранные дни недели свободными.',
    params: [{ key: 'weekdays', label: 'Желаемые выходные', type: 'weekdays', default: [6, 7] }],
    summary: p => `Желаемые выходные: ${weekdaysText(getArr<number>(p, 'weekdays'))}`,
  },
  {
    id: 'balance_hours', kind: 'function', icon: 'Scale',
    title: 'Балансировка часов до нормы',
    description: 'Добирает смены до нормы часов и не превышает её.',
    params: [
      { key: 'norm', label: 'Норма', type: 'number', default: 168, min: 0, max: 400, suffix: 'ч/мес' },
      { key: 'shift_hours', label: 'Часов в смене', type: 'number', default: 12, min: 1, max: 24, suffix: 'ч' },
    ],
    summary: p => `Норма ${getNum(p, 'norm')} ч (смена ${getNum(p, 'shift_hours')} ч)`,
  },
  {
    id: 'carry_over', kind: 'function', icon: 'CalendarClock',
    title: 'Перенос недоработки',
    description: 'Недоработанные часы переносятся в план следующего месяца.',
    params: [{ key: 'max_hours', label: 'Переносить не больше', type: 'number', default: 24, min: 0, max: 200, suffix: 'ч' }],
    summary: p => `Перенос недоработки до ${getNum(p, 'max_hours')} ч`,
  },
  {
    id: 'auto_mark_sub', kind: 'function', icon: 'Replace',
    title: 'Авто-пометка подмены',
    description: 'Если сотрудник вышел вне своего режима, смена помечается как подмена: Д → Дп, Н → Нп.',
    params: [],
    summary: () => 'Вне режима: Д → Дп, Н → Нп',
  },
  {
    id: 'overtime_cap', kind: 'function', icon: 'Gauge',
    title: 'Ограничение сверхурочных',
    description: 'Не даёт превысить предел часов в месяц.',
    params: [
      { key: 'max_hours', label: 'Максимум', type: 'number', default: 192, min: 0, max: 400, suffix: 'ч/мес' },
      { key: 'shift_hours', label: 'Часов в смене', type: 'number', default: 12, min: 1, max: 24, suffix: 'ч' },
    ],
    summary: p => `Не более ${getNum(p, 'max_hours')} ч в месяц`,
  },
  {
    id: 'notify_deputy', kind: 'function', icon: 'BellRing',
    title: 'Уведомлять при нарушении',
    description: 'После генерации зам. директор увидит список нарушенных условий.',
    params: [],
    summary: () => 'Сообщать о нарушениях условий',
  },
  {
    id: 'fixed_days', kind: 'function', icon: 'Pin',
    title: 'Фиксированные дни',
    description: 'В указанные числа месяца сотруднику ставится конкретная смена или выходной.',
    params: [
      { key: 'days', label: 'Числа месяца', type: 'text', default: '1,15', placeholder: '1,5,10-12' },
      CODE_PARAM('code', 'Смена', 'Д', { withRest: true }),
    ],
    summary: p => `${getStr(p, 'days') || '—'} → «${codeLabel(getStr(p, 'code'))}»`,
  },
  {
    id: 'alternate_weeks', kind: 'function', icon: 'ArrowLeftRight',
    title: 'Чередование день/ночь по неделям',
    description: 'Одну неделю — дневные смены, следующую — ночные.',
    params: [{ key: 'start', label: 'Чётные недели', type: 'select', default: 'day', options: [{ value: 'day', label: 'Дневные' }, { value: 'night', label: 'Ночные' }] }],
    summary: p => `Чередование по неделям, чётные — ${getStr(p, 'start') === 'night' ? 'ночи' : 'дни'}`,
  },

  {
    id: 'mode_2_2', kind: 'mode', icon: 'Columns2', title: '2/2',
    description: 'Два дня работы, два дня отдыха.',
    params: [CODE_PARAM('code', 'Смена', 'Д'), OFFSET_PARAM],
    summary: p => `2/2, смена «${getStr(p, 'code')}»`,
  },
  {
    id: 'mode_3_3', kind: 'mode', icon: 'Columns3', title: '3/3',
    description: 'Три дня работы, три дня отдыха.',
    params: [CODE_PARAM('code', 'Смена', 'Д'), OFFSET_PARAM],
    summary: p => `3/3, смена «${getStr(p, 'code')}»`,
  },
  {
    id: 'mode_1_3', kind: 'mode', icon: 'Clock4', title: '1/3 (сутки через трое)',
    description: 'Одна смена, затем три дня отдыха.',
    params: [CODE_PARAM('code', 'Смена', 'Д'), OFFSET_PARAM],
    summary: p => `Сутки через трое, «${getStr(p, 'code')}»`,
  },
  {
    id: 'mode_5_2', kind: 'mode', icon: 'Briefcase', title: '5/2 будни',
    description: 'Работа с понедельника по пятницу, суббота и воскресенье — выходные.',
    params: [CODE_PARAM('code', 'Смена', 'Д')],
    summary: p => `Пятидневка, «${getStr(p, 'code')}»`,
  },
  {
    id: 'mode_dn', kind: 'mode', icon: 'SunMoon', title: 'Д-Н-В-В (сутки по 12)',
    description: 'День, ночь, затем два выходных.',
    params: [{ key: 'line', label: 'Линия', type: 'select', default: 'main', options: [{ value: 'main', label: 'Д → Н' }, { value: 'sub', label: 'Дп → Нп' }] }, OFFSET_PARAM],
    summary: p => (getStr(p, 'line') === 'sub' ? 'Дп → Нп → В → В' : 'Д → Н → В → В'),
  },
  {
    id: 'mode_days', kind: 'mode', icon: 'Sunrise', title: 'Только дни',
    description: 'Сотрудник ставится только на дневные смены (Д, Дп).',
    params: [],
    summary: () => 'Только дневные смены',
  },
  {
    id: 'mode_nights', kind: 'mode', icon: 'Moon', title: 'Только ночи',
    description: 'Сотрудник ставится только на ночные смены (Н, Нп).',
    params: [],
    summary: () => 'Только ночные смены',
  },
  {
    id: 'mode_floating', kind: 'mode', icon: 'Waves', title: 'Плавающий график',
    description: 'Фиксированное число смен в месяц, дни выбирает генератор. Можно отметить желаемые свободные дни.',
    params: [
      { key: 'shifts', label: 'Смен в месяц', type: 'number', default: 12, min: 1, max: 31 },
      { key: 'free', label: 'Свободные дни недели', type: 'weekdays', default: [] },
    ],
    summary: p => `${getNum(p, 'shifts')} смен в месяц${getArr<number>(p, 'free').length ? `, свободны: ${weekdaysText(getArr<number>(p, 'free'))}` : ''}`,
  },
  {
    id: 'mode_watch', kind: 'mode', icon: 'Tent', title: 'Вахта',
    description: 'N дней работы подряд, затем M дней отдыха.',
    params: [
      { key: 'work', label: 'Дней работы', type: 'number', default: 7, min: 1, max: 30 },
      { key: 'rest', label: 'Дней отдыха', type: 'number', default: 7, min: 1, max: 30 },
      CODE_PARAM('code', 'Смена', 'Д'),
      OFFSET_PARAM,
    ],
    summary: p => `Вахта ${getNum(p, 'work')}/${getNum(p, 'rest')}, «${getStr(p, 'code')}»`,
  },
  {
    id: 'mode_part_time', kind: 'mode', icon: 'PieChart', title: 'Неполная занятость',
    description: 'Ограничение количества смен в неделю.',
    params: [{ key: 'n', label: 'Максимум', type: 'number', default: 3, min: 1, max: 7, suffix: 'смен в неделю' }],
    summary: p => `До ${getNum(p, 'n')} смен в неделю`,
  },
  {
    id: 'mode_custom', kind: 'mode', icon: 'PencilRuler', title: 'Пользовательский цикл',
    description: 'Свой повторяющийся цикл смен, например Д,Д,Н,Н,В,В.',
    params: [
      { key: 'cycle', label: 'Цикл', type: 'cycle', default: 'Д,Д,Н,Н,В,В', placeholder: 'Д,Д,Н,Н,В,В', hint: 'Коды через запятую, В — выходной' },
      OFFSET_PARAM,
    ],
    summary: p => `Цикл: ${cycleText(parseCycle(getStr(p, 'cycle')))}`,
  },
];

export const TEMPLATE_MAP = new Map(TEMPLATES.map(t => [t.id, t]));

export function templatesOf(kind: ConfiguratorKind): ConfiguratorTemplate[] {
  return TEMPLATES.filter(t => t.kind === kind);
}

export function defaultParams(tpl: ConfiguratorTemplate): ConfigParams {
  const p: ConfigParams = { template: tpl.id };
  for (const d of tpl.params) p[d.key] = Array.isArray(d.default) ? [...d.default] as ParamValue : d.default;
  return p;
}

export function summarize(rec: Pick<ConfiguratorRecord, 'params'>, ctx: SummaryCtx): string {
  const tpl = TEMPLATE_MAP.get(rec.params?.template);
  if (!tpl) return 'Неизвестный шаблон';
  try {
    return tpl.summary({ ...defaultParams(tpl), ...rec.params }, ctx);
  } catch {
    return tpl.title;
  }
}

export function absDay(year: number, month: number, dayIdx: number): number {
  return Math.floor(Date.UTC(year, month, dayIdx + 1) / 86400000);
}

export function weekdayOf(year: number, month: number, dayIdx: number): number {
  const g = new Date(year, month, dayIdx + 1).getDay();
  return ((g + 6) % 7) + 1;
}

export function modeCycle(p: ConfigParams): string[] | null {
  const code = getStr(p, 'code', 'Д');
  switch (p.template) {
    case 'mode_2_2': return [code, code, '', ''];
    case 'mode_3_3': return [code, code, code, '', '', ''];
    case 'mode_1_3': return [code, '', '', ''];
    case 'mode_dn': return getStr(p, 'line') === 'sub' ? ['Дп', 'Нп', '', ''] : ['Д', 'Н', '', ''];
    case 'mode_watch': {
      const w = Math.max(1, Math.min(60, getNum(p, 'work', 7)));
      const r = Math.max(1, Math.min(60, getNum(p, 'rest', 7)));
      return [...Array(w).fill(code), ...Array(r).fill('')];
    }
    case 'mode_custom': {
      const c = parseCycle(getStr(p, 'cycle'));
      return c.length ? c : null;
    }
    default: return null;
  }
}

export interface ModeDayRule {
  must?: string;
  off?: boolean;
  allow?: string[];
}

export function modeDayRule(p: ConfigParams, abs: number, weekday: number): ModeDayRule | null {
  if (p.template === 'mode_5_2') return weekday <= 5 ? { must: getStr(p, 'code', 'Д') } : { off: true };
  if (p.template === 'mode_days') return { allow: ['Д', 'Дп'] };
  if (p.template === 'mode_nights') return { allow: ['Н', 'Нп'] };
  const cycle = modeCycle(p);
  if (!cycle) return null;
  const len = cycle.length;
  const idx = (((abs + getNum(p, 'offset', 0)) % len) + len) % len;
  const c = cycle[idx];
  return c ? { must: c } : { off: true };
}