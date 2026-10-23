/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Слой данных проекта АнодБИЗ.
 * Повторяет прежний интерфейс (db / auth / storage), но теперь реально обращается
 * к серверным backend-функциям (data-api / auth-api / file-upload), а данные хранятся
 * в PostgreSQL — не в браузере. Компания видит и хранит все свои данные в реальной БД.
 */
import { apiUrl } from '@/lib/apiUrls';

const DATA_API_URL = apiUrl('data-api');
const AUTH_API_URL = apiUrl('auth-api');
const FILE_UPLOAD_URL = apiUrl('file-upload');

const TOKEN_KEY = 'anod_session_token';

function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

type Row = Record<string, any>;
type Result<T = any> = { data: T; error: { message: string; code?: string } | null };

interface Filter { col: string; op: string; value: unknown }

// data-api и file-upload теперь требуют авторизации на каждый запрос — сессионный
// токен уходит в заголовке X-Authorization (тот же заголовок понимает и постоянный
// API-токен десктоп-приложения).
function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { 'X-Authorization': token } : {};
}

type Pending = { body: Record<string, unknown>; resolve: (r: Result) => void };
let pendingBatch: Pending[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let batchSupported = true;
const BATCH_MAX = 40;

function callDataApi(body: Record<string, unknown>): Promise<Result> {
  if (!batchSupported) return callDataApiSingle(body);
  return new Promise(resolve => {
    pendingBatch.push({ body, resolve });
    if (pendingBatch.length >= BATCH_MAX) flushBatch();
    else if (!batchTimer) batchTimer = setTimeout(flushBatch, 10);
  });
}

async function flushBatch() {
  if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
  const items = pendingBatch;
  pendingBatch = [];
  if (!items.length) return;
  if (items.length === 1) { items[0].resolve(await callDataApiSingle(items[0].body)); return; }
  try {
    const res = await fetch(DATA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ batch: items.map(i => i.body) }),
    });
    const json = await res.json();
    if (Array.isArray(json?.results) && json.results.length === items.length) {
      items.forEach((it, i) => it.resolve(json.results[i] as Result));
      return;
    }
    if (res.status === 401) {
      items.forEach(it => it.resolve(json as Result));
      return;
    }
    batchSupported = false;
  } catch (e: any) {
    const err = { data: null, error: { message: e?.message || 'Сетевая ошибка' } };
    items.forEach(it => it.resolve(err));
    return;
  }
  for (const it of items) it.resolve(await callDataApiSingle(it.body));
}

async function callDataApiSingle(body: Record<string, unknown>): Promise<Result> {
  try {
    const res = await fetch(DATA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return json as Result;
  } catch (e: any) {
    return { data: null, error: { message: e?.message || 'Сетевая ошибка' } };
  }
}

class QueryBuilder implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private filters: Filter[] = [];
  private orderSpec: { col: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private singleMode: 'single' | 'maybe' | null = null;
  private payload: Row | Row[] | null = null;

  constructor(private table: string) {}

  select(_cols?: string) { return this; }
  insert(values: Row | Row[]) { this.op = 'insert'; this.payload = values; return this; }
  upsert(values: Row | Row[]) { this.op = 'insert'; this.payload = values; return this; }
  update(values: Row) { this.op = 'update'; this.payload = values; return this; }
  delete() { this.op = 'delete'; return this; }

  eq(col: string, val: unknown) { this.filters.push({ col, op: 'eq', value: val }); return this; }
  neq(col: string, val: unknown) { this.filters.push({ col, op: 'neq', value: val }); return this; }
  in(col: string, vals: unknown[]) { this.filters.push({ col, op: 'in', value: vals }); return this; }
  is(col: string, val: unknown) { this.filters.push({ col, op: 'is', value: val }); return this; }
  not(col: string, op: string, val: unknown) {
    this.filters.push({ col, op: `not_${op}`, value: val });
    return this;
  }
  gt(col: string, v: any) { this.filters.push({ col, op: 'gt', value: v }); return this; }
  gte(col: string, v: any) { this.filters.push({ col, op: 'gte', value: v }); return this; }
  lt(col: string, v: any) { this.filters.push({ col, op: 'lt', value: v }); return this; }
  lte(col: string, v: any) { this.filters.push({ col, op: 'lte', value: v }); return this; }
  ilike(col: string, pattern: string) { this.filters.push({ col, op: 'ilike', value: pattern }); return this; }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderSpec = { col, ascending: opts?.ascending !== false };
    return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  single() { this.singleMode = 'single'; return this; }
  maybeSingle() { this.singleMode = 'maybe'; return this; }

  private async execute(): Promise<Result> {
    const body: Record<string, unknown> = {
      table: this.table,
      op: this.op,
      filters: this.filters,
    };
    if (this.orderSpec) body.order = this.orderSpec;
    if (this.limitN !== null) body.limit = this.limitN;
    if (this.singleMode) body.single_mode = this.singleMode;
    if (this.payload !== null) body.payload = this.payload;
    return callDataApi(body);
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export const db = {
  from(table: string) {
    return new QueryBuilder(table);
  },
};

/* ---------------- auth ---------------- */

function setToken(token: string) {
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
}
function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

async function callAuthApi(body: Record<string, unknown>): Promise<any> {
  const res = await fetch(AUTH_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || 'Ошибка запроса');
  }
  return json;
}

export const auth = {
  async getSession() {
    const token = getToken();
    if (!token) return null;
    try {
      const json = await callAuthApi({ action: 'session', token });
      if (!json.user) { clearToken(); return null; }
      return { user: { id: json.user.id, email: json.user.email } };
    } catch {
      return null;
    }
  },
  async getRoles(): Promise<string[]> {
    const token = getToken();
    if (!token) return [];
    try {
      const json = await callAuthApi({ action: 'get_roles', token });
      return json.roles || [];
    } catch {
      return [];
    }
  },
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const json = await callAuthApi({ action: 'signin', email, password });
    setToken(json.token);
    return { user: json.user, session: { token: json.token }, apiToken: json.api_token as string | undefined };
  },
  /** Постоянный API-токен для десктоп-приложения (не истекает, в отличие от сессии).
   * Выдаётся один раз на пользователя — повторный вызов вернёт тот же токен. */
  async getApiToken(): Promise<string | null> {
    const token = getToken();
    if (!token) return null;
    try {
      const json = await callAuthApi({ action: 'get_api_token', token });
      return json.api_token || null;
    } catch {
      return null;
    }
  },
  /** Отозвать текущий API-токен (если он скомпрометирован) и получить новый. */
  async revokeApiToken(): Promise<string | null> {
    const token = getToken();
    if (!token) return null;
    try {
      const json = await callAuthApi({ action: 'revoke_api_token', token });
      return json.api_token || null;
    } catch {
      return null;
    }
  },
  async signUpWithPassword({ email, password }: { email: string; password: string }) {
    const current = getToken();
    const res = await fetch(AUTH_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(current ? { 'X-Authorization': current } : {}) },
      body: JSON.stringify({ action: 'signup', email, password }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Ошибка запроса');
    if (json.token) setToken(json.token);
    return { user: json.user, needs_email_confirmation: false };
  },
  async signOut() {
    const token = getToken();
    if (token) {
      try { await callAuthApi({ action: 'signout', token }); } catch { /* ignore */ }
    }
    clearToken();
  },
  /** Поиск профиля по PIN-коду (для быстрого входа). Не бросает исключение — возвращает null при ошибке.
   * adpod_slug — если вход идёт с адресного поддомена, пин-код должен быть привязан именно к нему. */
  async pinLookup(pin: string, adpodSlug?: string): Promise<{ email: string; full_name: string } | null> {
    try {
      return await callAuthApi({ action: 'pin_lookup', pin, adpod_slug: adpodSlug || '' });
    } catch {
      return null;
    }
  },
  /** Прямой вход по пин-коду без пароля — только для адресных поддоменов (АдПод).
   * Пин-код должен быть привязан именно к переданному adpodSlug. */
  async pinSignIn(pin: string, adpodSlug: string) {
    const json = await callAuthApi({ action: 'pin_signin', pin, adpod_slug: adpodSlug });
    setToken(json.token);
    return { user: json.user };
  },
  /** Обменять одноразовый код автовхода (пришедший по ссылке от десктоп-программы)
   * на полноценную сессию — страница /device-login вызывает это при загрузке. */
  async redeemLoginLink(code: string) {
    const json = await callAuthApi({ action: 'redeem_login_link', code });
    setToken(json.token);
    return { user: json.user };
  },
  async cardSignIn(cardNumber: string) {
    const json = await callAuthApi({ action: 'card_signin', card_number: cardNumber });
    setToken(json.token);
    return { user: json.user };
  },
  /** Директор меняет пароль сотрудника (например, из карточки привязанного устройства). */
  async setEmployeePassword(profileId: string, password: string): Promise<void> {
    const token = getToken();
    await callAuthApi({ action: 'set_employee_password', token, profile_id: profileId, password });
  },
};

/* ---------------- storage ---------------- */

export const storage = {
  async upload(bucket: string, file: File | Blob): Promise<{ url: string }> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
      reader.readAsDataURL(file);
    });
    const fileName = file instanceof File ? file.name : 'file';
    const contentType = file.type || 'application/octet-stream';
    const res = await fetch(FILE_UPLOAD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ file_base64: dataUrl, file_name: fileName, content_type: contentType, folder: bucket }),
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || 'Ошибка загрузки файла');
    return { url: json.url };
  },
};