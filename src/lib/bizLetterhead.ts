import { esc } from '@/lib/bizText';
import { Vendor } from '@/lib/bizLegal';

export const LOGO_URL = '/biz/nemzor-logo.png';
export const MARK_URL = '/biz/nemzor-mark.png';

export function absUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  return new URL(path, window.location.origin).href;
}

function upperName(v: Vendor): string[] {
  const full = (v.full_name || '').toUpperCase();
  const m = full.match(/^(ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ|АКЦИОНЕРНОЕ ОБЩЕСТВО)\s*(.*)$/);
  if (m) return [m[1], m[2].replace(/"/g, '"')];
  return [full || esc(v.short_name || '')];
}

export function letterhead(v: Vendor): string {
  const [l1, l2] = upperName(v);
  return `<div class="lh">
    <img class="lh-logo" src="${absUrl(LOGO_URL)}" alt="" />
    <div class="lh-text">
      <div class="lh-name">${esc(l1)}</div>
      ${l2 ? `<div class="lh-name">${esc(l2)}</div>` : ''}
      <div class="lh-req">ИНН: ${esc(v.inn)} / КПП: ${esc(v.kpp)} / ОГРН: ${esc(v.ogrn)}</div>
      <div class="lh-contacts"><b>Эл. почта:</b> ${esc(v.email || 'do@bizwor.ru')}${v.phone ? ` · <b>Тел.:</b> ${esc(v.phone)}` : ''}${v.legal_address ? `<br/>${esc(v.legal_address)}` : ''}</div>
    </div>
  </div>`;
}

export const LETTERHEAD_CSS = `
  .bizdoc .lh { display: flex; align-items: center; gap: 14pt; border-bottom: 2px solid #000; padding-bottom: 6pt; margin-bottom: 14pt; }
  .bizdoc .lh-logo { width: 66pt; height: 66pt; object-fit: contain; flex-shrink: 0; background: transparent; }
  .bizdoc .lh-text { flex: 1; text-align: center; }
  .bizdoc .lh-name { font-weight: bold; font-size: 12pt; letter-spacing: .3pt; line-height: 1.25; }
  .bizdoc .lh-req { font-weight: bold; font-size: 11pt; border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; margin-top: 3pt; padding: 1pt 0; }
  .bizdoc .lh-contacts { font-size: 10pt; margin-top: 2pt; }
`;
