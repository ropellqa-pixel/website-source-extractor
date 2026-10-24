import { DEFAULT_TARIFF, DEFAULT_VENDOR, DOC_CSS, LegalSlug, Tariff, Vendor, legalHtml } from '@/lib/bizLegal';
import { BASE_RENDERERS, BizDocument, BizOrg, DOC_TITLES } from '@/lib/bizDocs';
import { EXTRA_RENDERERS } from '@/lib/bizDocsExtra';
import { CERT_CSS, CERT_TYPES, renderCertificate } from '@/lib/bizCertificates';
import { LETTERHEAD_CSS, letterhead } from '@/lib/bizLetterhead';

export const FULL_DOC_CSS = DOC_CSS + LETTERHEAD_CSS + CERT_CSS;

export function renderGenerated(d: BizDocument, fallbackOrg?: BizOrg): string {
  const v = { ...DEFAULT_VENDOR, ...(d.snapshot?.vendor || {}) };
  const t = { ...DEFAULT_TARIFF, ...(d.snapshot?.tariff || {}) };
  const o = { ...(fallbackOrg || {}), ...(d.snapshot?.org || {}) };
  const dd = { ...d, amount: Number(d.amount || 0), months: Number(d.months || 0) };
  if (CERT_TYPES.includes(d.doc_type)) return renderCertificate(dd, v, t, o);
  const r = BASE_RENDERERS[d.doc_type] || EXTRA_RENDERERS[d.doc_type];
  if (!r) return '<p>Неизвестный тип документа</p>';
  return letterhead(v) + r(dd, v, t, o);
}

export function renderBizDocument(d: BizDocument, fallbackOrg?: BizOrg): string {
  if (d.custom_html && d.custom_html.trim()) return d.custom_html;
  return renderGenerated(d, fallbackOrg);
}

export function docTitle(d: BizDocument): string {
  return `${d.title || DOC_TITLES[d.doc_type] || 'Документ'} № ${d.number}`;
}

export function docFileName(d: BizDocument): string {
  return `${docTitle(d)} от ${d.doc_date}`.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
}

export function standaloneHtml(title: string, inner: string, autoPrint = false): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title>
<style>${FULL_DOC_CSS}
body{margin:0;background:#e5e7eb}
.sheet{width:21cm;min-height:29.7cm;margin:12px auto;background:#fff;padding:1.5cm 1.5cm 2cm 1.5cm;box-sizing:border-box;box-shadow:0 2px 12px rgba(0,0,0,.15)}
@media print{body{background:#fff}.sheet{margin:0;box-shadow:none;padding:0;width:auto;min-height:0}}
</style></head><body><div class="sheet"><div class="bizdoc">${inner}</div></div>${autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>' : ''}</body></html>`;
}

export function printDoc(title: string, inner: string): void {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(standaloneHtml(title, inner, true));
  w.document.close();
}

function save(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function wordBlob(title: string, inner: string): Blob {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${title}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>@page WordSection1{size:21cm 29.7cm;margin:1.5cm 1.5cm 2cm 1.5cm}div.WordSection1{page:WordSection1}${FULL_DOC_CSS}</style></head>
<body><div class="WordSection1"><div class="bizdoc">${inner}</div></div></body></html>`;
  return new Blob(['\ufeff', html], { type: 'application/msword' });
}

export function downloadLegalWord(slug: LegalSlug, title: string, v: Vendor, t: Tariff): void {
  save(wordBlob(title, letterhead({ ...DEFAULT_VENDOR, ...v }) + legalHtml(slug, v, t)), `${title.replace(/[\\/:*?"<>|]+/g, '_')}.doc`);
}

export function downloadWord(d: BizDocument, org?: BizOrg): void {
  save(wordBlob(docTitle(d), renderBizDocument(d, org)), `${docFileName(d)}.doc`);
}

export function downloadHtml(d: BizDocument, org?: BizOrg): void {
  save(new Blob([standaloneHtml(docTitle(d), renderBizDocument(d, org))], { type: 'text/html;charset=utf-8' }), `${docFileName(d)}.html`);
}

export async function downloadZip(docs: BizDocument[], name: string, org?: BizOrg): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();
  for (const d of docs) {
    let fn = docFileName(d);
    while (used.has(fn)) fn += '_';
    used.add(fn);
    zip.file(`${fn}.html`, standaloneHtml(docTitle(d), renderBizDocument(d, org)));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  save(blob, `${name.replace(/[\\/:*?"<>|]+/g, '_')}.zip`);
}
