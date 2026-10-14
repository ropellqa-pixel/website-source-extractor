import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import func2url from '../../backend/func2url.json';
import { useAuth } from './auth';

const URL = (func2url as Record<string, string>)['admin-api'];

export interface FieldDef {
  key: string;
  var: string;
  label: string;
  visible: boolean;
  builtin: boolean;
  kind: 'accrual' | 'deduction' | 'number' | 'text';
}

export interface AccessInfo {
  role: string;
  position: string | null;
  sections: string[];
  actions: string[];
  is_deputy: boolean;
  formulas: Record<string, string>;
  fields: Record<'salary' | 'manager' | 'collection', FieldDef[]>;
  general?: { start_period: string; shift_hours: Record<string, number> };
}

interface Ctx {
  access: AccessInfo | null;
  can: (action: string) => boolean;
  canSee: (path: string) => boolean;
  reload: () => Promise<void>;
}

const AccessContext = createContext<Ctx>({ access: null, can: () => false, canSee: () => true, reload: async () => {} });

export async function adminCall<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T & { error?: string }> {
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

export function AccessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [access, setAccess] = useState<AccessInfo | null>(null);

  const reload = useCallback(async () => {
    if (!user) { setAccess(null); return; }
    const r = await adminCall<AccessInfo>({ action: 'my_access' });
    if (!r.error) setAccess(r);
  }, [user]);

  useEffect(() => { reload(); }, [reload]);

  const can = useCallback((a: string) => !!access && (access.is_deputy || access.actions.includes(a)), [access]);
  const canSee = useCallback((p: string) => !access || access.is_deputy || access.sections.includes(p), [access]);

  return <AccessContext.Provider value={{ access, can, canSee, reload }}>{children}</AccessContext.Provider>;
}

export function useAccess() {
  return useContext(AccessContext);
}

const FUNCS: Record<string, (...a: number[]) => number> = {
  round: (x, n = 0) => Math.round(x * 10 ** n) / 10 ** n, min: Math.min, max: Math.max, abs: Math.abs, floor: Math.floor, ceil: Math.ceil,
};

export function evalFormula(expr: string, env: Record<string, number>): number {
  const src = (expr || '0').replace(/,/g, '.').replace(/;/g, ',');
  let i = 0;
  const peek = () => { while (src[i] === ' ') i++; return src[i]; };
  const num = (): number => {
    const c = peek();
    if (c === '(') { i++; const v = add(); if (peek() === ')') i++; return v; }
    if (c === '-') { i++; return -num(); }
    if (c === '+') { i++; return num(); }
    const m = /^(\d+(\.\d+)?|[a-z_][a-z0-9_]*)/i.exec(src.slice(i));
    if (!m) throw new Error('bad');
    i += m[0].length;
    if (/^\d/.test(m[0])) return parseFloat(m[0]);
    if (peek() === '(' && FUNCS[m[0]]) {
      i++;
      const args: number[] = [];
      while (peek() !== ')' && i < src.length) { args.push(add()); if (peek() === ',') i++; }
      i++;
      return FUNCS[m[0]](...args);
    }
    return Number(env[m[0]] || 0);
  };
  const mul = (): number => {
    let v = num();
    for (;;) {
      const c = peek();
      if (c === '*') { i++; v *= num(); } else if (c === '/') { i++; const d = num(); v = d ? v / d : 0; } else return v;
    }
  };
  const add = (): number => {
    let v = mul();
    for (;;) {
      const c = peek();
      if (c === '+') { i++; v += mul(); } else if (c === '-') { i++; v -= mul(); } else return v;
    }
  };
  try { const v = add(); return Number.isFinite(v) ? v : 0; } catch { return 0; }
}
