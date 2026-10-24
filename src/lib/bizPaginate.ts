const MM = 96 / 25.4;
export const PAGE_W = 210 * MM;
export const PAGE_H = 297 * MM;
export const PAD_TOP = 15 * MM;
export const PAD_SIDE = 15 * MM;
export const PAD_BOTTOM = 20 * MM;
const FOOTER_H = 8 * MM;
const CONTENT_H = PAGE_H - PAD_TOP - PAD_BOTTOM - FOOTER_H;
const CONTENT_W = PAGE_W - PAD_SIDE * 2;

function isCert(html: string): boolean {
  return /class="cert2/.test(html);
}

function blocksOf(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  root.childNodes.forEach(n => {
    if (n.nodeType === 1) out.push(n as HTMLElement);
    else if (n.nodeType === 3 && (n.textContent || '').trim()) {
      const p = document.createElement('p');
      p.textContent = n.textContent;
      out.push(p);
    }
  });
  return out;
}

function splitTable(t: HTMLTableElement, room: number, measure: (el: HTMLElement) => number): [HTMLElement, HTMLElement] | null {
  const rows = Array.from(t.rows);
  if (rows.length < 3) return null;
  const head = rows[0].querySelector('th') ? rows[0] : null;
  const a = t.cloneNode(false) as HTMLTableElement;
  const b = t.cloneNode(false) as HTMLTableElement;
  const tbA = document.createElement('tbody');
  const tbB = document.createElement('tbody');
  a.appendChild(tbA);
  b.appendChild(tbB);
  if (head) tbB.appendChild(head.cloneNode(true));
  let used = 0;
  let i = 0;
  for (; i < rows.length; i++) {
    const h = measure(rows[i]);
    if (used + h > room && i > (head ? 1 : 0)) break;
    used += h;
    tbA.appendChild(rows[i].cloneNode(true));
  }
  if (i >= rows.length || i === 0) return null;
  for (; i < rows.length; i++) tbB.appendChild(rows[i].cloneNode(true));
  return [a, b];
}

function splitList(l: HTMLElement, room: number, measure: (el: HTMLElement) => number): [HTMLElement, HTMLElement] | null {
  const items = Array.from(l.children) as HTMLElement[];
  if (items.length < 2) return null;
  const a = l.cloneNode(false) as HTMLElement;
  const b = l.cloneNode(false) as HTMLElement;
  let used = 0;
  let i = 0;
  for (; i < items.length; i++) {
    const h = measure(items[i]);
    if (used + h > room && i > 0) break;
    used += h;
    a.appendChild(items[i].cloneNode(true));
  }
  if (i >= items.length) return null;
  for (; i < items.length; i++) b.appendChild(items[i].cloneNode(true));
  if (l.tagName === 'OL') b.setAttribute('start', String(i + Number(l.getAttribute('start') || 1)));
  return [a, b];
}

function splitParagraph(p: HTMLElement, room: number, host: HTMLElement): [HTMLElement, HTMLElement] | null {
  if (p.tagName !== 'P' || p.querySelector('table,img')) return null;
  const html = p.innerHTML;
  const words = html.split(/(\s+)/);
  if (words.length < 12) return null;
  const probe = p.cloneNode(false) as HTMLElement;
  host.appendChild(probe);
  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    probe.innerHTML = words.slice(0, mid).join('');
    if (probe.getBoundingClientRect().height <= room) lo = mid;
    else hi = mid - 1;
  }
  host.removeChild(probe);
  if (lo < 6 || lo >= words.length - 4) return null;
  const a = p.cloneNode(false) as HTMLElement;
  const b = p.cloneNode(false) as HTMLElement;
  a.innerHTML = words.slice(0, lo).join('');
  a.style.textAlignLast = 'justify';
  b.innerHTML = words.slice(lo).join('');
  b.style.textIndent = '0';
  return [a, b];
}

/** Делит HTML документа на страницы A4 (210×297 мм, поля 15/15/20 мм).
 *  Заголовки не остаются внизу страницы без текста, таблицы и списки
 *  делятся по строкам (шапка таблицы повторяется), длинные абзацы — по словам. */
export function paginate(html: string, css: string): string[] {
  if (typeof document === 'undefined') return [html];
  if (isCert(html)) return [html];
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${CONTENT_W}px;visibility:hidden;`;
  host.innerHTML = `<style>${css}</style><div class="bizdoc"></div>`;
  document.body.appendChild(host);
  const work = host.querySelector('.bizdoc') as HTMLElement;
  const src = document.createElement('div');
  src.innerHTML = html;

  const measureIn = (el: HTMLElement) => {
    const wrap = document.createElement('div');
    wrap.style.display = 'flow-root';
    if (el.tagName === 'TR' || el.tagName === 'LI') {
      const parent = document.createElement(el.tagName === 'TR' ? 'table' : 'ul');
      if (el.tagName === 'TR') {
        const tb = document.createElement('tbody');
        tb.appendChild(el.cloneNode(true));
        parent.appendChild(tb);
      } else parent.appendChild(el.cloneNode(true));
      wrap.appendChild(parent);
    } else wrap.appendChild(el.cloneNode(true));
    work.appendChild(wrap);
    const h = wrap.getBoundingClientRect().height;
    work.removeChild(wrap);
    return h;
  };

  const pages: string[] = [];
  let cur: HTMLElement[] = [];
  let used = 0;
  const queue = blocksOf(src);

  const flush = () => {
    if (!cur.length || cur.every(e => !(e.textContent || '').trim() && !e.querySelector('img,table'))) { cur = []; used = 0; return; }
    pages.push(cur.map(e => e.outerHTML).join(''));
    cur = [];
    used = 0;
  };

  while (queue.length) {
    const el = queue.shift() as HTMLElement;
    if (el.classList.contains('page-break')) { flush(); continue; }
    const h = measureIn(el);
    const isHeading = /^H[1-3]$/.test(el.tagName);
    const next = queue[0];
    const nextH = isHeading && next ? Math.min(measureIn(next), 60) : 0;
    if (used + h + nextH <= CONTENT_H) {
      cur.push(el);
      used += h;
      continue;
    }
    const room = CONTENT_H - used;
    let parts: [HTMLElement, HTMLElement] | null = null;
    if (!isHeading && room > 50) {
      if (el.tagName === 'TABLE') parts = splitTable(el as HTMLTableElement, room - 6, measureIn);
      else if (el.tagName === 'UL' || el.tagName === 'OL') parts = splitList(el, room - 6, measureIn);
      else if (el.tagName === 'P') parts = splitParagraph(el, room - 4, work);
    }
    if (parts) {
      cur.push(parts[0]);
      flush();
      queue.unshift(parts[1]);
      continue;
    }
    if (!cur.length) { cur.push(el); flush(); continue; }
    flush();
    queue.unshift(el);
  }
  flush();
  document.body.removeChild(host);
  return pages.length ? pages : [html];
}

export function pagesHtml(pages: string[], footer: string, cert = false): string {
  const total = pages.length;
  return pages.map((p, i) => `<section class="a4${cert ? ' a4-cert' : ''}"><div class="bizdoc a4-body">${p}</div>${cert ? '' : `<div class="a4-foot"><span>${footer}</span><span>Страница ${i + 1} из ${total}</span></div>`}</section>`).join('');
}

export const PAGE_CSS = `
  .a4 { width: 210mm; height: 297mm; padding: 15mm 15mm 20mm 15mm; box-sizing: border-box; background: #fff; position: relative; overflow: hidden; margin: 0 auto 12px; box-shadow: 0 2px 12px rgba(0,0,0,.15); page-break-after: always; break-after: page; }
  .a4:last-child { page-break-after: auto; break-after: auto; }
  .a4-body { height: calc(297mm - 35mm - 8mm); overflow: hidden; }
  .a4-foot { position: absolute; left: 15mm; right: 15mm; bottom: 10mm; display: flex; justify-content: space-between; gap: 12px; border-top: 0.5pt solid #999; padding-top: 3pt; font: 9pt 'Times New Roman', serif; color: #444; }
  .a4-cert { padding: 8mm; }
  .a4-cert .a4-body { height: 100%; }
  @media print { .a4 { margin: 0; box-shadow: none; } }
`;
