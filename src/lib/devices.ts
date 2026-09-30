import func2url from '../../backend/func2url.json';

const AUTH_API_URL = func2url['auth-api'];
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
