import { apiUrl } from '@/lib/apiUrls';

const URL = apiUrl('skud-api');

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
  card_type: 'employee' | 'guest' | 'master';
  has_pin: boolean;
  schedule_id: number | null;
  written_at: string;
  written_by: string | null;
  expires_at?: string;
  removed_at?: string;
  expiry_state?: 'ok' | 'warn' | 'grace';
}

export interface SkudSchedule { id: number; name: string; days: number; from: string; to: string; zone: number }
export interface SkudOutput { addr: number; name: string }

export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export function daysLabel(mask: number) {
  if (mask === 127) return 'каждый день';
  if (mask === 31) return 'будни';
  if (mask === 96) return 'выходные';
  return WEEKDAYS.filter((_, i) => mask & (1 << i)).join(', ');
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
  inside_camera_id: string | null;
  pre_seconds: number;
  post_seconds: number;
  recorder_device: string | null;
  recorder_quality: 'sd' | 'hd';
  recorder_online: boolean;
  recorder_status: string | null;
  recorder_host: string | null;
  gate_host: string | null;
  gate_port: number;
  gate_address: number;
  gate_status: string | null;
  gate_online: boolean;
  emergency_open: boolean;
  antipassback: boolean;
  outputs: SkudOutput[];
  timing: SkudTiming;
  gate_params: { relay_tenths?: number; pass_tenths?: number; hold_sec?: number; confirm_sec?: number; at?: string } | null;
}

export interface SkudTiming {
  ctrl_poll_ms: number;
  server_sync_sec: number;
  reconnect_sec: number;
  clock_sync_hours: number;
  enroll_sec: number;
  site_refresh_sec: number;
  open_cmd_ttl_sec: number;
  emergency_repeat_min: number;
  relay_tenths: number;
  pass_tenths: number;
  hold_sec: number;
  confirm_sec: number;
}

export interface SkudClip {
  id: number;
  opening_id: number | null;
  camera_id: string;
  camera: string | null;
  mode: 'door' | 'inside';
  from: string;
  to: string;
  status: 'pending' | 'taken' | 'done' | 'failed' | 'missing' | 'deleted';
  url: string | null;
  size: number | null;
  error: string | null;
}

export interface SkudMark { t: string; kind: string; name: string | null
  inside?: string[];
  count?: number;
}

export interface SkudOpening {
  id: number;
  opened_at: string;
  last_open_at: string;
  closed_at: string | null;
  assumed: boolean;
  held: boolean;
  marks: SkudMark[];
  status: 'open' | 'closed';
}

export interface SkudVisit {
  id: number;
  status: 'open' | 'closed';
  started_at: string;
  ended_at: string | null;
  inside: number;
  entries: number;
  exits: number;
  alarm: boolean;
  note: string | null;
  door: string | null;
  openings: SkudOpening[];
  clips: SkudClip[];
}

export interface PcDevice { code: string; host: string; name: string | null; heartbeat_at: string | null }

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
