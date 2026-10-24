import { DEFAULT_TARIFF, DEFAULT_VENDOR, DOC_CSS, LegalSlug, Tariff, Vendor, legalHtml } from '@/lib/bizLegal';
import { BASE_RENDERERS, BizDocument, BizOrg, DOC_TITLES } from '@/lib/bizDocs';
import { EXTRA_RENDERERS } from '@/lib/bizDocsExtra';
import { CERT_CSS, CERT_TYPES, renderCertificate } from '@/lib/bizCertificates';
import { LETTERHEAD_CSS, letterhead } from '@/lib/bizLetterhead';
import { PAGE_CSS, pagesHtml, paginate } from '@/lib/bizPaginate';
import { licenseAgreementFull } from '@/lib/bizLicenseFull';
import { ACCESS_CERT_CSS, ACCESS_CERT_TYPES, renderAccessCertificate } from '@/lib/bizAccessCert';

export const FULL_DOC_CSS = DOC_CSS + LETTERHEAD_CSS + CERT_CSS + ACCESS_CERT_CSS;

export function renderGenerated(d: BizDocument, fallbackOrg?: BizOrg): string {
  const v = { ...DEFAULT_VENDOR, ...(d.snapshot?.vendor || {}) };
  const t = { ...DEFAULT_TARIFF, ...(d.snapshot?.tariff || {}) };
  const o = { ...(fallbackOrg || {}), ...(d.snapshot?.org || {}) };
  const dd = { ...d, amount: Number(d.amount || 0), months: Number(d.months || 0) };
  if (CERT_TYPES.includes(d.doc_type)) return renderCertificate(dd, v, t, o);
  if (ACCESS_CERT_TYPES.includes(d.doc_type)) return renderAccessCertificate(dd, v, t, o);
  if (d.doc_type === 'license_agreement') return letterhead(v) + licenseAgreementFull(dd, v, t, o);
  const r = BASE_RENDERERS[d.doc_type] || EXTRA_RENDERERS[d.doc_type];
  if (!r) return '<p>Неизвестный тип документа</p>';
  return letterhead(v) + r(dd, v, t, o);
}

export function renderBizDocument(d: BizDocument, fallbackOrg?: BizOrg): string {
  if (d.custom_html && d.custom_html.trim()) return d.custom_html;
  return renderGenerated(d, fallbackOrg);
}

export function isCertificateHtml(html: string): boolean {
  return /class="cert2/.test(html);
}

export function docTitle(d: BizDocument): string {
  return `${d.title || DOC_TITLES[d.doc_type] || 'Документ'} № ${d.number}`;
}

export function docFileName(d: BizDocument): string {
  return `${docTitle(d)} от ${d.doc_date}`.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
}

/** Документ, разложенный по листам A4 с колонтитулом «Страница N из M». */
export function pagedHtml(title: string, inner: string): string {
  const cert = isCertificateHtml(inner);
  const pages = paginate(inner, FULL_DOC_CSS);
  return pagesHtml(pages, title.replace(/</g, '&lt;'), cert);
}

export function standaloneHtml(title: string, inner: string, autoPrint = false): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title>
<style>${FULL_DOC_CSS}${PAGE_CSS}
@page{size:A4;margin:0}
html,body{margin:0;padding:0}
body{background:#e5e7eb;padding:12px 0}
@media print{body{background:#fff;padding:0}}
</style></head><body>${pagedHtml(title, inner)}${autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print()},400)}</script>' : ''}</body></html>`;
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

const WORD_CSS = `
@page WordSection1{size:21.0cm 29.7cm;margin:1.5cm 1.5cm 2.0cm 1.5cm;mso-header-margin:0.8cm;mso-footer-margin:0.8cm;mso-footer:f1}
@page CertSection{size:21.0cm 29.7cm;margin:0.8cm 0.8cm 0.8cm 0.8cm}
div.WordSection1{page:WordSection1}
div.CertSection{page:CertSection}
p.MsoFooter{margin:0;text-align:right;font-size:9.0pt;font-family:"Times New Roman"}
table{border-collapse:collapse}
`;

function wordBlob(title: string, inner: string): Blob {
  const cert = isCertificateHtml(inner);
  const section = cert ? 'CertSection' : 'WordSection1';
  const footer = cert ? '' : `<div style="mso-element:footer" id="f1"><p class="MsoFooter">${title.replace(/</g, '&lt;')} — страница <span style="mso-field-code:' PAGE '"></span> из <span style="mso-field-code:' NUMPAGES '"></span></p></div>`;
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${title}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>${FULL_DOC_CSS}${WORD_CSS}</style></head>
<body><div class="${section}"><div class="bizdoc">${inner}</div>${footer}</div></body></html>`;
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
    zip.file(`Word/${fn}.doc`, wordBlob(docTitle(d), renderBizDocument(d, org)));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  save(blob, `${name.replace(/[\\/:*?"<>|]+/g, '_')}.zip`);
}
