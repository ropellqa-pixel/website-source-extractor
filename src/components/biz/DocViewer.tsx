import Icon from '@/components/ui/icon';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { DOC_CSS, printHtml } from '@/lib/bizLegal';
import { BizDocument, BizOrg, DOC_TITLES, renderBizDocument } from '@/lib/bizDocs';

export default function DocViewer({ doc, org, onClose }: { doc: BizDocument | null; org?: BizOrg; onClose: () => void }) {
  const html = doc ? renderBizDocument(doc, org) : '';
  const title = doc ? `${DOC_TITLES[doc.doc_type] || 'Документ'} № ${doc.number}` : '';
  return (
    <Dialog open={!!doc} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-[900px] overflow-hidden p-0">
        <style>{DOC_CSS}</style>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <DialogTitle className="truncate text-base">{title}</DialogTitle>
          <button onClick={() => printHtml(title, html)} className="ml-auto mr-8 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90">
            <Icon name="Printer" size={16} /> Печать / PDF
          </button>
        </div>
        <div className="max-h-[calc(92vh-60px)] overflow-auto bg-secondary/50 p-4">
          <div className="mx-auto max-w-[21cm] bg-white px-[1.5cm] pb-[2cm] pt-[1.5cm] text-black shadow">
            <div className="bizdoc" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
