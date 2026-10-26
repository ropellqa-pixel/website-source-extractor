import { apiUrl } from '@/lib/apiUrls';

export const SBIS_URL = apiUrl('accounting-api');

export type PayKind = 'cash' | 'bank' | 'certificate' | 'salary';

export interface SbisJob {
  kind: 'backfill' | 'range' | 'auto'; from: string; to: string; done: boolean; error: string | null;
  percent: number; orders: number; cursor: string; by: string;
}

export interface SbisStatus {
  configured: boolean; has_keys: boolean; points: number[]; point_names: Record<string, string>;
  include: Record<PayKind, boolean>; exclude_sber: string[]; backfill_done: string | null; last_auto: string | null;
  client_id: string | null; cron_key: string | null; data_from: string | null; data_to: string | null; days: number;
  job: Partial<SbisJob>;
}

export interface SbisDay {
  date: string; cash: number; certificate: number; salary: number; bank_sbis: number; returns: number; checks: number;
  turnover: number; sber: number; sber_excluded: number; total: number;
}

export interface SbisReport {
  from: string; to: string; days: SbisDay[];
  totals: Omit<SbisDay, 'date'>; include: Record<PayKind, boolean>; exclude_sber: string[];
  bank_categories: { category: string; total: number; excluded: boolean }[];
}

export const PAY_LABELS: Record<PayKind, string> = {
  cash: 'Наличные', certificate: 'Сертификаты', salary: 'Под зарплату', bank: 'Безнал / QR / терминал (идёт на расчётный счёт)',
};

export async function sbisCall<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T & { error?: string }> {
  let token = '';
  try { token = localStorage.getItem('anod_session_token') || ''; } catch { /* */ }
  try {
    const res = await fetch(SBIS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Authorization': token } : {}) },
      body: JSON.stringify({ ...body, action: `sbis_${body.action}` }),
    });
    const json = await res.json();
    if (!res.ok && !json?.error) return { error: 'Ошибка сервера' } as T & { error?: string };
    return json;
  } catch {
    return { error: 'Нет связи с сервером' } as T & { error?: string };
  }
}

export async function runJob(first: Record<string, unknown>, onProgress: (j: Partial<SbisJob>) => void): Promise<string | null> {
  let r = await sbisCall<{ job: Partial<SbisJob> }>(first);
  for (let i = 0; i < 2000; i++) {
    if (r.error) return r.error;
    onProgress(r.job || {});
    if (!r.job || r.job.done) return null;
    if (r.job.error) await new Promise((ok) => setTimeout(ok, 20000));
    r = await sbisCall<{ job: Partial<SbisJob> }>({ action: 'continue' });
  }
  return null;
}

export function downloadBase64(b64: string, name: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
