/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Собственный слой данных проекта АнодБИЗ.
 * Повторяет интерфейс прежнего SDK (db / auth / storage), чтобы страницы работали без изменений.
 * Сейчас данные хранятся локально в браузере; для перехода на серверную базу
 * достаточно заменить реализацию `execute` на вызов облачной функции.
 */
import { seedIfEmpty } from './seed';

type Row = Record<string, any>;
type Filter = (row: Row) => boolean;
// Данные — массив строк; в режиме single/maybeSingle — одна запись
type Data = any;
type Result<T = Data> = { data: T; error: { message: string; code?: string } | null };

const PREFIX = 'anod_db_';

function readTable(name: string): Row[] {
  seedIfEmpty();
  try {
    const raw = localStorage.getItem(PREFIX + name);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeTable(name: string, rows: Row[]) {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(rows));
  } catch (e) {
    console.error('[db] storage write error', e);
    throw new Error('Недостаточно места для сохранения данных');
  }
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const isNil = (v: unknown) => v === null || v === undefined;
const same = (a: unknown, b: unknown) => {
  if (isNil(a) && isNil(b)) return true;
  if (isNil(a) || isNil(b)) return false;
  return String(a) === String(b);
};

type Op = 'select' | 'insert' | 'update' | 'delete' | 'upsert';

class QueryBuilder implements PromiseLike<Result> {
  private op: Op = 'select';
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private limitN: number | null = null;
  private singleMode: 'single' | 'maybe' | null = null;
  private payload: Row | Row[] | null = null;
  private returning = false;

  constructor(private table: string) {}

  select(_cols?: string) {
    if (this.op !== 'select') this.returning = true;
    return this;
  }
  insert(values: Row | Row[]) { this.op = 'insert'; this.payload = values; return this; }
  upsert(values: Row | Row[]) { this.op = 'upsert'; this.payload = values; return this; }
  update(values: Row) { this.op = 'update'; this.payload = values; return this; }
  delete() { this.op = 'delete'; return this; }

  eq(col: string, val: unknown) { this.filters.push(r => same(r[col], val)); return this; }
  neq(col: string, val: unknown) { this.filters.push(r => !same(r[col], val)); return this; }
  in(col: string, vals: unknown[]) { this.filters.push(r => vals.some(v => same(r[col], v))); return this; }
  is(col: string, val: unknown) {
    this.filters.push(r => (val === null ? isNil(r[col]) : r[col] === val));
    return this;
  }
  not(col: string, op: string, val: unknown) {
    const f = this.makeOp(col, op, val);
    this.filters.push(r => !f(r));
    return this;
  }
  gt(col: string, v: any) { this.filters.push(r => r[col] > v); return this; }
  gte(col: string, v: any) { this.filters.push(r => r[col] >= v); return this; }
  lt(col: string, v: any) { this.filters.push(r => r[col] < v); return this; }
  lte(col: string, v: any) { this.filters.push(r => r[col] <= v); return this; }
  ilike(col: string, pattern: string) {
    const re = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i');
    this.filters.push(r => re.test(String(r[col] ?? '')));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  single() { this.singleMode = 'single'; return this; }
  maybeSingle() { this.singleMode = 'maybe'; return this; }

  private makeOp(col: string, op: string, val: unknown): Filter {
    switch (op) {
      case 'is': return r => (val === null ? isNil(r[col]) : r[col] === val);
      case 'eq': return r => same(r[col], val);
      case 'neq': return r => !same(r[col], val);
      default: return () => false;
    }
  }

  private match(row: Row) {
    return this.filters.every(f => f(row));
  }

  private execute(): Result {
    const now = new Date().toISOString();
    let rows = readTable(this.table);
    let out: Row[] = [];

    if (this.op === 'insert' || this.op === 'upsert') {
      const items = Array.isArray(this.payload) ? this.payload : [this.payload || {}];
      const created = items.map(it => ({ id: uuid(), created_at: now, ...it }));
      if (this.op === 'upsert') {
        created.forEach(c => {
          const idx = rows.findIndex(r => r.id === c.id);
          if (idx >= 0) rows[idx] = { ...rows[idx], ...c };
          else rows.push(c);
        });
      } else {
        rows = rows.concat(created);
      }
      writeTable(this.table, rows);
      out = created;
      if (!this.returning && !this.singleMode) return { data: null, error: null };
    } else if (this.op === 'update') {
      rows = rows.map(r => {
        if (!this.match(r)) return r;
        const u = { ...r, ...(this.payload as Row), updated_at: now };
        out.push(u);
        return u;
      });
      writeTable(this.table, rows);
      if (!this.returning && !this.singleMode) return { data: null, error: null };
    } else if (this.op === 'delete') {
      out = rows.filter(r => this.match(r));
      writeTable(this.table, rows.filter(r => !this.match(r)));
      if (!this.returning) return { data: null, error: null };
    } else {
      out = rows.filter(r => this.match(r));
      for (const o of [...this.orders].reverse()) {
        out.sort((a, b) => {
          const x = a[o.col], y = b[o.col];
          if (x === y) return 0;
          if (isNil(x)) return 1;
          if (isNil(y)) return -1;
          const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ru');
          return o.asc ? cmp : -cmp;
        });
      }
      if (this.limitN !== null) out = out.slice(0, this.limitN);
    }

    const copy = JSON.parse(JSON.stringify(out));
    if (this.singleMode) {
      if (copy.length === 0) {
        return this.singleMode === 'maybe'
          ? { data: null, error: null }
          : { data: null, error: { message: 'Запись не найдена', code: 'PGRST116' } };
      }
      return { data: copy[0], error: null };
    }
    return { data: copy, error: null };
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    let res: Result;
    try {
      res = this.execute();
    } catch (e: any) {
      res = { data: null, error: { message: e?.message || 'Ошибка базы данных' } };
    }
    return Promise.resolve(res).then(onfulfilled, onrejected);
  }
}

export const db = {
  from(table: string) {
    return new QueryBuilder(table);
  },
};

/* ---------------- auth ---------------- */

interface AuthUser { id: string; email: string; password: string; roles: string[]; created_at: string }
const USERS_KEY = 'anod_auth_users';
const SESSION_KEY = 'anod_auth_session';

function readUsers(): AuthUser[] {
  seedIfEmpty();
  try { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); } catch { return []; }
}
function writeUsers(u: AuthUser[]) { localStorage.setItem(USERS_KEY, JSON.stringify(u)); }
function currentSession(): { user: { id: string; email: string } } | null {
  seedIfEmpty();
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export const auth = {
  async getSession() {
    return currentSession();
  },
  async getRoles(): Promise<string[]> {
    const s = currentSession();
    if (!s) return [];
    return readUsers().find(u => u.id === s.user.id)?.roles || [];
  },
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const u = readUsers().find(x => x.email.toLowerCase() === email.trim().toLowerCase());
    if (!u || u.password !== password) throw new Error('Неверный email или пароль');
    const session = { user: { id: u.id, email: u.email } };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return { user: session.user, session };
  },
  async signUpWithPassword({ email, password }: { email: string; password: string }) {
    const users = readUsers();
    const normalized = email.trim().toLowerCase();
    if (users.some(u => u.email.toLowerCase() === normalized)) {
      throw new Error('Пользователь с таким email уже существует');
    }
    if (!password || password.length < 6) throw new Error('Пароль должен содержать не менее 6 символов');
    const user: AuthUser = {
      id: uuid(), email: email.trim(), password,
      roles: users.length === 0 ? ['admin'] : [],
      created_at: new Date().toISOString(),
    };
    writeUsers([...users, user]);
    const publicUser = { id: user.id, email: user.email };
    if (!currentSession()) localStorage.setItem(SESSION_KEY, JSON.stringify({ user: publicUser }));
    return { user: publicUser, needs_email_confirmation: false };
  },
  async signOut() {
    localStorage.removeItem(SESSION_KEY);
  },
};

/* ---------------- storage ---------------- */

export const storage = {
  async upload(_bucket: string, file: File | Blob): Promise<{ url: string }> {
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
      reader.readAsDataURL(file);
    });
    return { url };
  },
};
