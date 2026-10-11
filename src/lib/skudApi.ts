import func2url from '../../backend/func2url.json';

const URL = (func2url as Record<string, string>)['skud-api'];

export interface SkudEvent {
  id: number;
  time: string;
  kind: string;
  kind_label: string;
  direction: 'in' | 'out' | null;
  granted: boolean;
  card: string | null;
  profile_id: string | null;
  name: string | null;
  department: string | null;
  note: string | null;
  source: string;
  door: string | null;
  camera_id: string | null;
}

export interface SkudCard {
  id: string;
  card: string;
  profile_id: string | null;
  name: string | null;
  label: string | null;
  status: 'active' | 'blocked';
  valid_from: string | null;
  valid_to: string | null;
  synced: boolean;
  last_used: string | null;
}

export interface SkudController {
  id: string;
  name: string;
  serial: string | null;
  model: string | null;
  camera_id: string | null;
  camera_name: string | null;
  open_seconds: number;
  last_seen_at: string | null;
  online: boolean;
  last_ip: string | null;
  fw: string | null;
  door_open: boolean | null;
  key: string;
}

export interface Employee { id: string; name: string; department: string }

export async function skudCall<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T & { error?: string }> {
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

const MSK = { timeZone: 'Europe/Moscow' } as const;
export const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { ...MSK, day: '2-digit', month: '2-digit', year: 'numeric' });
export const fmtTime = (s: string) => new Date(s).toLocaleTimeString('ru-RU', { ...MSK, hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const mskDay = (d: Date) => d.toLocaleDateString('sv-SE', MSK);
export const mskSec = (s: string) => {
  const [h, m, sec] = new Date(s).toLocaleTimeString('ru-RU', { ...MSK, hour12: false }).split(':').map(Number);
  return h * 3600 + m * 60 + sec;
};
export const fmtDur = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
};
