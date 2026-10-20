import func2url from '../../backend/func2url.json';

export const NEW_HOST = 'bizwor.ru';
export const NEW_API = 'https://api.bizwor.ru';
export const NEW_VERSION = '36.20';

export function isNewHosting(): boolean {
  if (import.meta.env.VITE_API_BASE) return true;
  return typeof window !== 'undefined' && /(^|\.)bizwor\.ru$/.test(window.location.hostname);
}

function apiBase(): string | null {
  const fromEnv = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  return isNewHosting() ? NEW_API : null;
}

const API_BASE = apiBase();

export const SITE_VERSION = isNewHosting() ? NEW_VERSION : '';

export function apiUrl(name: string): string {
  if (API_BASE) return `${API_BASE}/${name}`;
  return (func2url as Record<string, string>)[name];
}
