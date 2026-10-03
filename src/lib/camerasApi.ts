import func2url from '../../backend/func2url.json';

const URL = (func2url as Record<string, string>)['cameras-api'];

export interface Camera {
  id: string;
  name: string;
  order_index: number;
  is_default: boolean;
  network_mode: string;
  serial?: string;
  username?: string;
}

export interface RecordRange { start: string; end: string }

const RETRY_ACTIONS = new Set(['live', 'playback', 'snapshot', 'records']);

export async function camerasCall<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T & { error?: string }> {
  const attempts = RETRY_ACTIONS.has(String(body.action)) ? 3 : 1;
  let last = await camerasCallOnce<T>(body);
  for (let i = 1; i < attempts && last.error && /не ответила|timeout|сервер/i.test(last.error); i++) {
    await new Promise((r) => setTimeout(r, 700));
    last = await camerasCallOnce<T>(body);
  }
  return last;
}

async function camerasCallOnce<T>(body: Record<string, unknown>): Promise<T & { error?: string }> {
  let token = '';
  try { token = localStorage.getItem('anod_session_token') || ''; } catch { /* */ }
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Authorization': token } : {}) },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok && !json?.error) return { error: 'Камера не ответила вовремя' } as T & { error?: string };
    return json;
  } catch {
    return { error: 'Нет связи с сервером' } as T & { error?: string };
  }
}

export const pad = (n: number) => String(n).padStart(2, '0');
export const toDayStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const secOfDay = (s: string) => {
  const t = s.slice(11, 19).split(':').map(Number);
  return t[0] * 3600 + t[1] * 60 + (t[2] || 0);
};
export const fmtSec = (s: number) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(Math.floor(s % 60))}`;