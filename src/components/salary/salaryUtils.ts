import { db } from '@/lib/sdk';
import type { FieldDef } from '@/lib/access';
import { cellValue, type GridRow } from '@/components/salary/SalaryGrid';

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: string;
  department: string;
  status: string;
  vk_id: string;
}

export interface SalaryRow {
  id?: string;
  profile_id: string;
  hours_worked: number;
  revenue: number;
  days_in_month: number;
  vacation_pay: number;
  non_cash: number;
  overtime: number;
  tax: number;
  underpayment: number;
  month_year: string;
  extra?: Record<string, number | string> | null;
  responsible_user_id?: string;
  user_id?: string;
}

export interface ManagerRow {
  id?: string;
  profile_id: string;
  osn_hours: number;
  dop_hours: number;
  doplaty: number;
  vacation_pay: number;
  non_cash: number;
  underpayment: number;
  hourly_rate: number;
  month_year: string;
  extra?: Record<string, number | string> | null;
  user_id?: string;
}

export const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function getDaysForMonth(month: number, year: number): number {
  if (month === 2 && ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)) return 29;
  return DAYS_IN_MONTH[month - 1] || 30;
}

export const DEFAULT_FX: Record<string, string> = {
  rate: 'revenue / (days * 24) * percent / 100',
  total: '(rate * hours + vacation) - non_cash - overtime - tax + underpayment',
  week: 'total / 4',
  manager_rate: 'rate * (1 + manager_percent / 100)',
  manager_total: '((osn_hours * manager_rate) + vacation) - non_cash + doplaty + dop_hours * rate + underpayment',
  manager_week: 'manager_total / 4',
};
const F = (key: string, v: string, label: string, kind: FieldDef['kind']): FieldDef => ({ key, var: v, label, visible: true, builtin: true, kind });
export const DEFAULT_FIELDS: Record<'salary' | 'manager' | 'collection', FieldDef[]> = {
  salary: [F('hours_worked', 'hours', 'ЧАСЫ', 'accrual'), F('vacation_pay', 'vacation', 'ОТПУСК', 'accrual'), F('non_cash', 'non_cash', 'БЕЗНАЛ', 'deduction'),
    F('overtime', 'overtime', 'ПЕРЕБОР', 'deduction'), F('tax', 'tax', 'НАЛОГ', 'deduction'), F('underpayment', 'underpayment', 'НЕДОПЛАТА', 'accrual')],
  manager: [F('osn_hours', 'osn_hours', 'ОСН. ЧАСЫ', 'accrual'), F('dop_hours', 'dop_hours', 'ДОП. ЧАСЫ', 'accrual'), F('doplaty', 'doplaty', 'ДОПЛАТЫ', 'accrual'),
    F('vacation_pay', 'vacation', 'ОТПУСК', 'accrual'), F('non_cash', 'non_cash', 'БЕЗНАЛ', 'deduction'), F('underpayment', 'underpayment', 'НЕДОПЛАТА', 'accrual')],
  collection: [F('sbis_value', 'sbis', 'Сбис ₽', 'number'), F('fact_value', 'fact', 'Факт ₽', 'number')],
};

export function rowEnv(row: Record<string, unknown>, fields: FieldDef[]) {
  const env: Record<string, number> = {};
  fields.forEach((f) => { const v = cellValue(row as GridRow, f); env[f.var] = typeof v === 'number' ? v : 0; });
  return env;
}

export function fmt(n: number) {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function loadGlobalSettings() {
  const { data } = await db.from('salary_settings').select('*').is('month_year', null).limit(1);
  if (data && data.length > 0) return data[0];
  return null;
}

export async function loadGlobalManagerSettings() {
  const { data } = await db.from('manager_settings').select('*').is('month_year', null).limit(1);
  if (data && data.length > 0) return data[0];
  return null;
}
