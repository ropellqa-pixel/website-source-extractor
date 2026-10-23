import { apiUrl } from '@/lib/apiUrls';

const AUTH_API_URL = apiUrl('auth-api');
const TOKEN_KEY = 'anod_session_token';

export interface LoginCard {
  card_number: string;
  created_at: string;
}

function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(AUTH_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, token: getToken() }),
  });
  let json: Record<string, unknown> = {};
  try { json = await res.json(); } catch { json = {}; }
  if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Ошибка запроса');
  return json as T;
}

const RU_TO_LATIN: Record<string, string> = {
  'б': ',', 'Б': ',', 'ю': ',', 'Ю': ',',
  'ф': 'A', 'Ф': 'A', 'и': 'B', 'И': 'B', 'с': 'C', 'С': 'C',
  'в': 'D', 'В': 'D', 'у': 'E', 'У': 'E', 'а': 'F', 'А': 'F',
};

export function sanitizeCardInput(raw: string): string {
  return Array.from(raw.trim()).map((c) => RU_TO_LATIN[c] ?? c).join('').replace(/\s+/g, '');
}

export const CARD_INPUT_RE = /^[0-9A-Fa-f]{6,12}$|^\d{1,3}[,.]\d{1,5}$/;

export function looksLikeCard(raw: string): boolean {
  return CARD_INPUT_RE.test(raw.trim().replace(/\s+/g, ''));
}

export async function listCards(profileId: string): Promise<LoginCard[]> {
  const json = await call<{ cards?: LoginCard[] }>({ action: 'card_list', profile_id: profileId });
  return json.cards || [];
}

export async function bindCard(profileId: string, cardNumber: string, force = false): Promise<string> {
  const json = await call<{ card_number: string }>({ action: 'card_bind', profile_id: profileId, card_number: sanitizeCardInput(cardNumber), force });
  return json.card_number;
}

export async function unbindCard(cardNumber: string): Promise<void> {
  await call({ action: 'card_unbind', card_number: sanitizeCardInput(cardNumber) });
}
