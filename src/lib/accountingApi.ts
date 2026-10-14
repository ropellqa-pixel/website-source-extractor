import func2url from '../../backend/func2url.json';

const URL = (func2url as Record<string, string>)['accounting-api'];

export type Kind = 'income' | 'expense';
export type PayType = 'salary' | 'percent' | 'hourly' | 'tabel';
export type Section = 'entries' | 'profit' | 'salary';

export interface Category { id: number; kind: Kind; name: string; archived: boolean }

export interface Entry {
  id: number | string; kind: Kind; date: string; amount: number; category_id: number | null; category: string;
  comment: string | null; from_salary: boolean; linked: 'collection' | 'salary' | null; created_by: string | null;
}

export interface ProfitData {
  income: number; expense: number; profit: number;
  by_category: { kind: Kind; category: string; total: number; count: number; linked?: 'collection' | 'salary' | null }[];
  by_month: { month: string; income: number; expense: number }[];
}

export interface Staff {
  id: number; name: string; profile_id: string | null; position: string | null; pay_type: PayType; rate: number;
  active: boolean; accrued: number; paid: number; debt: number; sheet: number | null;
}

export interface Accrual {
  id: number; staff_id: number; period: string; pay_type: PayType; rate: number; base: number; bonus: number;
  amount: number; comment: string | null; created_at: string;
}

export interface Payment { id: number; staff_id: number; date: string; amount: number; period: string | null; comment: string | null }

export interface SalaryData {
  period: string; staff: Staff[]; accruals: Accrual[]; payments: Payment[]; total_debt: number;
  profiles?: { id: string; name: string }[];
}

export interface Me { can_edit: boolean; perms: Record<Section, boolean>; role: string; categories: Category[] }

export const PAY_LABELS: Record<PayType, string> = { tabel: 'Из «Зарплаты»', salary: 'Оклад', percent: 'Процент от выручки', hourly: 'По часам' };

export async function accCall<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T & { error?: string }> {
  let token = '';
  try { token = localStorage.getItem('anod_session_token') || ''; } catch { /* */ }
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Authorization': token } : {}) },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok && !json?.error) return { error: 'Ошибка сервера' } as T & { error?: string };
    return json;
  } catch {
    return { error: 'Нет связи с сервером' } as T & { error?: string };
  }
}

export const rub = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n) + ' ₽';
export const fmtDay = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('ru-RU');
export const today = () => new Date().toLocaleDateString('sv-SE');
export const thisMonth = () => today().slice(0, 7);

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const monthLabel = (p: string) => { const [y, m] = p.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; };

export function monthRange(p: string): [string, string] {
  const [y, m] = p.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return [`${p}-01`, `${p}-${String(last).padStart(2, '0')}`];
}

export function shiftMonth(p: string, delta: number) {
  const [y, m] = p.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
