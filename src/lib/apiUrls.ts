import func2url from '../../backend/func2url.json';

function apiBase(): string | null {
  const fromEnv = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (typeof window !== 'undefined' && /(^|\.)bizwor\.ru$/.test(window.location.hostname)) return `${window.location.origin}/api`;
  return null;
}

const API_BASE = apiBase();

export function apiUrl(name: string): string {
  if (API_BASE) return `${API_BASE}/${name}`;
  return (func2url as Record<string, string>)[name];
}