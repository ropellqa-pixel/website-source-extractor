import { db } from '@/lib/sdk';

export interface PlanEvent {
  id: string;
  company_id: string;
  plan_date: string;
  status: string;
  color: string;
  note: string;
  created_by: string;
  created_by_name: string;
  created_at?: string;
}

export const PRESETS = [
  { status: 'Средней важности', color: '#9BE15D' },
  { status: 'Планирование', color: '#9BE15D' },
  { status: 'Оплата', color: '#EF4444' },
];

export const SWATCHES = ['#9BE15D', '#EF4444', '#F59E0B', '#FACC15', '#3B82F6', '#8B5CF6', '#EC4899', '#14B8A6'];

export const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const pad = (n: number) => String(n).padStart(2, '0');

export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromYmd(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDayLong(s: string): string {
  const d = fromYmd(s);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}

export function textColorFor(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return '#111827';
  const ch = [0, 2, 4].map(i => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return lum > 0.4 ? '#111827' : '#FFFFFF';
}

export function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* empty */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function fetchPlans(companyId: string, from: string, to: string): Promise<PlanEvent[]> {
  const { data, error } = await db
    .from('plan_events')
    .select('*')
    .eq('company_id', companyId)
    .gte('plan_date', from)
    .lte('plan_date', to)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((Array.isArray(data) ? data : []) as PlanEvent[]).map(p => ({ ...p, plan_date: String(p.plan_date).slice(0, 10) }));
}

export async function createPlan(p: Omit<PlanEvent, 'id' | 'created_at'>): Promise<void> {
  const { error } = await db.from('plan_events').insert({ id: newId(), ...p });
  if (error) throw new Error(error.message);
}

export async function updatePlan(id: string, patch: Partial<Pick<PlanEvent, 'status' | 'color' | 'note'>>): Promise<void> {
  const { error } = await db.from('plan_events').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deletePlan(id: string): Promise<void> {
  const { error } = await db.from('plan_events').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
