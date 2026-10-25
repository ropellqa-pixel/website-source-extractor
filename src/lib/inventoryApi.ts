import { apiUrl } from '@/lib/apiUrls';

const URL = apiUrl('inventory-api');

export type DocKind = 'income' | 'writeoff' | 'recount';

export interface InvItem {
  id: number; code: string; name: string; category: string; unit: string; qty: number; price: number;
  location: string; note: string; created_at: string;
}

export interface InvDoc {
  id: number; number: string; kind: DocKind; doc_date: string; reason: string; comment: string; total: number;
  created_by: string; created_at: string; lines?: number | InvLine[]; qty?: number;
}

export interface InvLine {
  id: number; item_id: number; item_code: string; item_name: string; qty: number; qty_before: number; qty_after: number;
  price: number; unit: string;
}

export interface InvOverview {
  items: InvItem[]; docs: InvDoc[]; categories: Record<string, string>; kinds: Record<DocKind, string>;
  reasons: string[]; can_edit: boolean; can_writeoff: boolean;
}

export async function invCall<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T & { error?: string }> {
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

const LATIN: Record<string, string> = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', X: 'Х', Y: 'У' };

export function normCode(s: string): string {
  return s.trim().toUpperCase().replace(/[ -]/g, '').replace(/[ABEKMHOPCTXY]/g, c => LATIN[c]);
}

export function matches(item: InvItem, q: string): boolean {
  if (!q.trim()) return true;
  const n = normCode(q);
  return item.code.includes(n) || item.name.toLowerCase().includes(q.trim().toLowerCase());
}

export const qtyFmt = (n: number) => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
export const KIND_STYLE: Record<DocKind, string> = {
  income: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  writeoff: 'bg-red-50 text-red-700 border-red-200',
  recount: 'bg-sky-50 text-sky-700 border-sky-200',
};
