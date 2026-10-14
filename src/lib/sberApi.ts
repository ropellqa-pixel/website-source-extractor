import func2url from '../../backend/func2url.json';

const URL = (func2url as Record<string, string>)['sber-api'];

export interface SberCp {
  id: number; name: string; kind: string; inn: string; kpp: string; account: string; bic: string; bank_name: string; corr_account: string;
  default_purpose: string; vat_rate: string; requisites_updated_at: string | null; requisites_updated_by: string | null;
  archived: boolean; default_category_id: number | null; phone: string; comment: string; ready: boolean;
}

export type ReqStatus = 'draft' | 'sent' | 'rejected' | 'paying' | 'signing' | 'paid' | 'failed' | 'cancelled';

export interface SberRequest {
  id: number; counterparty_id: number; counterparty: string; amount: number; purpose: string; vat_rate: string; week_start: string;
  status: ReqStatus; status_label: string; requisites: { name: string; inn: string; kpp: string; account: string; bic: string; bank_name: string };
  requisites_changed: boolean; created_by: string; created_at: string; sent_at: string | null; decided_by: string | null;
  decided_at: string | null; reject_reason: string | null; bank_status: string | null; bank_comment: string | null;
  created_by_user: string; category_id: number | null;
}

export interface SberBank {
  connected: boolean; ready: boolean; test: boolean;
  configured: Record<string, boolean>;
  org: { name: string; inn: string; kpp: string; accounts: { number: string; currency: string; bic: string }[] } | null;
  account: string | null; last_sync: string | null; last_sync_result: { added: number; skipped: number } | null;
  last_sync_error: string | null; limit_payment: number; limit_day: number; paid_today: number; cron_key: string | null;
}

export interface SberConnection {
  id: number; title: string; org: { name: string; inn: string; kpp: string; accounts: { number: string; currency: string }[] } | null;
  account: string | null; is_default: boolean; active: boolean; last_sync: string | null; last_error: string | null; has_tokens?: boolean;
}

export interface SberOverview {
  connections: SberConnection[];
  notify: { on_send: boolean; on_paid: boolean; on_reject: boolean } | null;
  week: string; requests: SberRequest[]; pending: { week: string; count: number; amount: number }[];
  counterparties: SberCp[]; categories: { id: number; name: string }[]; can: string[]; is_deputy: boolean; bank: SberBank;
}

export async function sberCall<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T & { error?: string }> {
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

export const sberUrl = URL;

export const VAT_LABELS: Record<string, string> = { none: 'Без НДС', '0': 'НДС 0%', '5': 'НДС 5%', '7': 'НДС 7%', '10': 'НДС 10%', '20': 'НДС 20%', '22': 'НДС 22%' };

export function weekLabel(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  const e = new Date(d); e.setDate(d.getDate() + 6);
  const f = (x: Date) => x.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return `${f(d)} — ${f(e)}`;
}

export function shiftWeek(iso: string, n: number) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

export const STATUS_STYLE: Record<ReqStatus, string> = {
  draft: 'bg-secondary text-muted-foreground', sent: 'bg-amber-500/15 text-amber-700', rejected: 'bg-red-500/10 text-red-700',
  paying: 'bg-sky-500/15 text-sky-700', signing: 'bg-sky-500/15 text-sky-700', paid: 'bg-emerald-500/15 text-emerald-700',
  failed: 'bg-red-500/10 text-red-700', cancelled: 'bg-secondary text-muted-foreground line-through',
};
