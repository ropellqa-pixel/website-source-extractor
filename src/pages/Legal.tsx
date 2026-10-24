import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import AnodBizLogo from '@/components/AnodBizLogo';
import { bizCall } from '@/lib/bizApi';
import { DEFAULT_TARIFF, DEFAULT_VENDOR, LEGAL_DOCS, LegalSlug, Tariff, Vendor, legalHtml } from '@/lib/bizLegal';
import { letterhead } from '@/lib/bizLetterhead';
import { FULL_DOC_CSS, downloadLegalWord, pagedHtml, printDoc } from '@/lib/bizRender';
import { PAGE_CSS } from '@/lib/bizPaginate';

export function useBizPublic() {
  const [vendor, setVendor] = useState<Vendor>(DEFAULT_VENDOR);
  const [tariff, setTariff] = useState<Tariff>(DEFAULT_TARIFF);
  useEffect(() => {
    bizCall<{ vendor?: Vendor; tariff?: Tariff }>({ action: 'public_info' }).then(r => {
      if (r.vendor) setVendor({ ...DEFAULT_VENDOR, ...r.vendor });
      if (r.tariff) setTariff({ ...DEFAULT_TARIFF, ...r.tariff });
    });
  }, []);
  return { vendor, tariff };
}

export default function Legal() {
  const { slug = 'license' } = useParams();
  const { vendor, tariff } = useBizPublic();
  const doc = LEGAL_DOCS.find(d => d.slug === slug) || LEGAL_DOCS[0];
  const html = letterhead(vendor) + legalHtml(doc.slug as LegalSlug, vendor, tariff);
  const paged = useMemo(() => pagedHtml(doc.title, html), [doc.title, html]);

  return (
    <div className="min-h-[100dvh] bg-secondary/40">
      <style>{FULL_DOC_CSS + PAGE_CSS}</style>
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to="/login" className="flex items-center gap-2">
            <AnodBizLogo size="sm" />
            <span className="font-semibold">БИЗ · Документы</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => printDoc(doc.title, html)} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:bg-secondary">
              <Icon name="Printer" size={16} /> Печать / PDF
            </button>
            <button onClick={() => downloadLegalWord(doc.slug as LegalSlug, doc.title, vendor, tariff)} className="hidden items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:bg-secondary sm:flex">
              <Icon name="FileDown" size={16} /> Word
            </button>
            <Link to="/login" className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90">Вход</Link>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-6 lg:grid-cols-[240px_auto]">
        <nav className="flex flex-col gap-1 self-start rounded-2xl border border-border bg-card p-2 lg:sticky lg:top-20">
          {LEGAL_DOCS.map(d => (
            <Link key={d.slug} to={`/legal/${d.slug}`}
              className={`rounded-xl px-3 py-2 text-sm ${d.slug === doc.slug ? 'bg-secondary font-semibold text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'}`}>
              {d.short}
            </Link>
          ))}
          <div className="mt-2 border-t border-border px-3 pt-3 text-xs text-muted-foreground">
            Правообладатель и издатель: {vendor.short_name}, ИНН {vendor.inn}. Вопросы: <a className="underline" href={`mailto:${vendor.email}`}>{vendor.email}</a>
          </div>
        </nav>
        <article className="overflow-x-auto text-black">
          <div dangerouslySetInnerHTML={{ __html: paged }} />
        </article>
      </div>
    </div>
  );
}
