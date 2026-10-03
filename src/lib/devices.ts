/* eslint-disable @typescript-eslint/no-explicit-any */
import func2url from '../../backend/func2url.json';
import { auth } from '@/lib/sdk';

const AUTH_API_URL = func2url['auth-api'];
const CONTROL_API_URL = (func2url as Record<string, string>)['device-control'];
const TOKEN_KEY = 'anod_session_token';

function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export interface Device {
  id: string;
  device_code: string;
  hostname: string;
  status: 'pending' | 'linked' | 'revoked';
  created_at: string;
  linked_at: string | null;
  last_seen_at: string | null;
  profile_id: string | null;
  profile_name: string | null;
}

async function callAuthApi(body: Record<string, unknown>): Promise<any> {
  const token = getToken();
  const res = await fetch(AUTH_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, token }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Ошибка запроса');
  return json;
}

/** Список всех устройств (ПК) компании — привязанные и ожидающие привязки. */
export async function listDevices(): Promise<Device[]> {
  try {
    const json = await callAuthApi({ action: 'list_devices' });
    return json.devices || [];
  } catch (e) {
    console.error('[Devices] list error:', e);
    return [];
  }
}

/** Привязывает код устройства к сотруднику. Если у сотрудника ещё нет учётной записи —
 * password обязателен (не менее 6 символов) и создаст её. Возвращает токен устройства. */
export async function linkDevice(deviceCode: string, profileId: string, password?: string): Promise<{ apiToken: string; profileName: string }> {
  const json = await callAuthApi({ action: 'link_device', device_code: deviceCode, profile_id: profileId, password: password || '' });
  return { apiToken: json.api_token, profileName: json.profile_name };
}

/** Отзывает доступ конкретному устройству, не трогая остальные. */
export async function revokeDevice(deviceCode: string): Promise<void> {
  await callAuthApi({ action: 'revoke_device', device_code: deviceCode });
}

/** Директор меняет пароль сотрудника, привязанного к устройству (или любого сотрудника). */
export async function setEmployeePassword(profileId: string, password: string): Promise<void> {
  await auth.setEmployeePassword(profileId, password);
}

// ===== Удалённое управление ПК (только заместитель директора) =====

export type DevicePresence = 'offline' | 'login' | 'working';

export interface DeviceStatus extends Device {
  presence: DevicePresence;
  heartbeat_at: string | null;
  current_user_name: string | null;
  app_version: string | null;
  remote_lock: boolean;
  screenshot_url: string | null;
  screenshot_at: string | null;
}

export interface DeviceLogEntry {
  kind: string;
  message: string;
  actor_name: string | null;
  created_at: string;
}

export type RemoteCommand = 'lock' | 'unlock' | 'message' | 'screenshot' | 'rudesktop' | 'reload' | 'logout';

async function callControlApi(body: Record<string, unknown>): Promise<any> {
  const token = getToken();
  const res = await fetch(CONTROL_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Authorization': token } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Ошибка запроса');
  return json;
}

/** Статусы всех ПК компании: в сети / на экране входа / не в сети. */
export async function getDevicesStatus(): Promise<{ devices: DeviceStatus[]; canControl: boolean }> {
  try {
    const json = await callControlApi({ action: 'devices_status' });
    return { devices: json.devices || [], canControl: !!json.can_control };
  } catch (e) {
    console.error('[Devices] status error:', e);
    return { devices: [], canControl: false };
  }
}

/** Отправить команду на ПК (блокировка/разблокировка/сообщение/скриншот/RuDesktop/обновить). */
export async function sendDeviceCommand(deviceCode: string, command: RemoteCommand, payload?: Record<string, unknown>): Promise<void> {
  await callControlApi({ action: 'send_command', device_code: deviceCode, command, payload: payload || {} });
}

/** Журнал активности конкретного ПК. */
export async function getDeviceLogs(deviceCode: string, limit = 100): Promise<DeviceLogEntry[]> {
  try {
    const json = await callControlApi({ action: 'device_logs', device_code: deviceCode, limit });
    return json.logs || [];
  } catch (e) {
    console.error('[Devices] logs error:', e);
    return [];
  }
}