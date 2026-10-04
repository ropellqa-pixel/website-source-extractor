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
  update_status: string | null;
}

export interface DeviceLogEntry {
  kind: string;
  message: string;
  actor_name: string | null;
  created_at: string;
}

export type RemoteCommand = 'lock' | 'unlock' | 'message' | 'screenshot' | 'rudesktop' | 'reload' | 'logout'
  | 'login_user' | 'login_admin' | 'update';

export interface AppRelease {
  id: string;
  edition: 'abiz' | 'admin';
  version: string;
  size: number;
  notes: string;
  is_active: boolean;
  created_at: string;
}

export async function listReleases(): Promise<AppRelease[]> {
  try {
    const json = await callControlApi({ action: 'release_list' });
    return json.releases || [];
  } catch { return []; }
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(s);
}

/** Загрузить ZIP новой версии программы и выпустить его. onProgress — от 0 до 1. */
export async function publishRelease(
  file: File, edition: 'abiz' | 'admin', version: string, notes: string,
  onProgress: (p: number) => void,
): Promise<void> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const CH = 1536 * 1024;
  const total = Math.ceil(bytes.length / CH);
  let folder = '';
  for (let n = 1; n <= total; n++) {
    const chunk = bytes.subarray((n - 1) * CH, n * CH);
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await callControlApi({ action: 'release_upload_part', edition, folder, part: n, data: toBase64(chunk) });
        folder = r.folder;
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        await new Promise(res => setTimeout(res, 1000));
      }
    }
    if (lastErr) throw new Error('Не удалось загрузить часть файла. Проверьте интернет и попробуйте снова.');
    onProgress(n / total);
  }
  await callControlApi({
    action: 'release_publish', edition, version, folder, parts: total,
    sha256: await sha256Hex(buf), size: bytes.length, notes,
  });
}

export async function activateRelease(id: string): Promise<void> {
  await callControlApi({ action: 'release_activate', id });
}

export async function deleteRelease(id: string): Promise<void> {
  await callControlApi({ action: 'release_delete', id });
}

/** Разослать всем ПК команду «обновиться сейчас». Возвращает число ПК. */
export async function updateAllDevices(): Promise<number> {
  const json = await callControlApi({ action: 'update_all' });
  return json.count || 0;
}

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