import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '@/components/ui/icon';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { BizDocument, BizOrg } from '@/lib/bizDocs';
import { bizCall } from '@/lib/bizApi';
import { FULL_DOC_CSS, docTitle, downloadHtml, downloadWord, pagedHtml, printDoc, renderBizDocument, renderGenerated } from '@/lib/bizRender';
import { PAGE_CSS } from '@/lib/bizPaginate';

interface Props {
  doc: BizDocument | null;
  org?: BizOrg;
  onClose: () => void;
  editable?: boolean;
  onSaved?: () => void;
}

const inp = 'h-8 rounded-md border border-input bg-card px-2 text-sm';

const EXEC: [string, string][] = [
  ['bold', 'Bold'], ['italic', 'Italic'], ['underline', 'Underline'],
  ['justifyLeft', 'AlignLeft'], ['justifyCenter', 'AlignCenter'], ['justifyRight', 'AlignRight'], ['justifyFull', 'AlignJustify'],
  ['insertUnorderedList', 'List'], ['insertOrderedList', 'ListOrdered'], ['removeFormat', 'RemoveFormatting'],
];

export default function DocViewer({ doc, org, onClose, editable, onSaved }: Props) {
  const [edit, setEdit] = useState(false);
  const [meta, setMeta] = useState({ number: '', doc_date: '', period_from: '', period_to: '', amount: '', months: '', title: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<BizDocument | null>(doc);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrent(doc);
    setEdit(false);
    setMsg('');
    if (doc) {
      setMeta({
        number: doc.number, doc_date: (doc.doc_date || '').slice(0, 10), period_from: (doc.period_from || '').slice(0, 10),
        period_to: (doc.period_to || '').slice(0, 10), amount: String(doc.amount ?? ''), months: String(doc.months ?? ''), title: doc.title || '',
      });
    }
  }, [doc]);

  const html = current ? renderBizDocument(current, org) : '';
  const title = current ? docTitle(current) : '';
  const paged = useMemo(() => (current && !edit ? pagedHtml(title, html) : ''), [current, edit, html, title]);

  useEffect(() => {
    if (edit && ref.current) ref.current.innerHTML = html;
  }, [edit]); // eslint-disable-line react-hooks/exhaustive-deps

  const withMeta = (d: BizDocument): BizDocument => ({
    ...d, number: meta.number, doc_date: meta.doc_date || d.doc_date, period_from: meta.period_from || null,
    period_to: meta.period_to || null, amount: Number(meta.amount || 0), months: Number(meta.months || 0), title: meta.title,
  });

  const save = async (resetText = false) => {
    if (!current) return;
    setBusy(true); setMsg('');
    const body: Record<string, unknown> = { action: 'admin_doc_save', id: current.id, ...meta };
    let customHtml = current.custom_html || '';
    if (resetText) customHtml = '';
    else if (edit && ref.current) customHtml = ref.current.innerHTML;
    body.custom_html = customHtml;
    const r = await bizCall(body);
    setBusy(false);
    if (r.error) { setMsg(`Ошибка: ${r.error}`); return; }
    setCurrent({ ...withMeta(current), custom_html: customHtml });
    setEdit(false);
    setMsg(resetText ? 'Текст возвращён к шаблону' : 'Сохранено');
    onSaved?.();
  };

  const refresh = async () => {
    if (!current) return;
    setBusy(true);
    const r = await bizCall({ action: 'admin_doc_refresh', id: current.id });
    setBusy(false);
    setMsg(r.error ? `Ошибка: ${r.error}` : 'Реквизиты в документе обновлены. Закройте и откройте документ заново.');
    onSaved?.();
  };

  return (
    <Dialog open={!!doc} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[94vh] max-w-[880px] overflow-hidden p-0">
        <style>{FULL_DOC_CSS + PAGE_CSS}</style>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 pr-12">
          <DialogTitle className="mr-auto truncate text-base">{title}</DialogTitle>
          {current?.custom_html && !edit && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">Изменён вручную</span>}
          {!edit && (
            <>
              <button onClick={() => printDoc(title, html)} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"><Icon name="Printer" size={16} /> Печать / PDF</button>
              <button onClick={() => current && downloadWord(current, org)} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-secondary"><Icon name="FileDown" size={16} /> Word</button>
              <button onClick={() => current && downloadHtml(current, org)} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-secondary"><Icon name="Download" size={16} /> HTML</button>
              {editable && <button onClick={() => setEdit(true)} className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-100"><Icon name="PencilLine" size={16} /> Редактировать</button>}
            </>
          )}
        </div>

        {edit && (
          <div className="space-y-2 border-b border-border bg-secondary/40 px-4 py-3">
            <div className="flex flex-wrap items-end gap-2 text-xs">
              <label>Номер<input value={meta.number} onChange={e => setMeta(m => ({ ...m, number: e.target.value }))} className={`${inp} block w-48 font-mono`} /></label>
              <label>Дата<input type="date" value={meta.doc_date} onChange={e => setMeta(m => ({ ...m, doc_date: e.target.value }))} className={`${inp} block`} /></label>
              <label>Период с<input type="date" value={meta.period_from} onChange={e => setMeta(m => ({ ...m, period_from: e.target.value }))} className={`${inp} block`} /></label>
              <label>по<input type="date" value={meta.period_to} onChange={e => setMeta(m => ({ ...m, period_to: e.target.value }))} className={`${inp} block`} /></label>
              <label>Мес.<input value={meta.months} onChange={e => setMeta(m => ({ ...m, months: e.target.value }))} className={`${inp} block w-14`} /></label>
              <label>Сумма<input value={meta.amount} onChange={e => setMeta(m => ({ ...m, amount: e.target.value }))} className={`${inp} block w-24`} /></label>
              <label className="min-w-[180px] flex-1">Своё название (необязательно)<input value={meta.title} onChange={e => setMeta(m => ({ ...m, title: e.target.value }))} className={`${inp} block w-full`} /></label>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {EXEC.map(([cmd, icon]) => (
                <button key={cmd} onMouseDown={e => { e.preventDefault(); document.execCommand(cmd); }} className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card hover:bg-secondary" title={cmd}>
                  <Icon name={icon} size={15} />
                </button>
              ))}
              <span className="ml-2 text-xs text-muted-foreground">Кликните в текст и правьте как в Word.</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => { if (ref.current && current) ref.current.innerHTML = renderGenerated(withMeta(current), org); }} className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:bg-secondary">Пересобрать из шаблона</button>
              <button disabled={busy} onClick={refresh} className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:bg-secondary">Обновить реквизиты</button>
              <button disabled={busy} onClick={() => save(true)} className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:bg-secondary">Сбросить правки текста</button>
              <div className="ml-auto flex gap-2">
                <button onClick={() => setEdit(false)} className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:bg-secondary">Отмена</button>
                <button disabled={busy} onClick={() => save(false)} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Сохранить</button>
              </div>
            </div>
          </div>
        )}
        {msg && <div className={`px-4 py-2 text-sm ${msg.startsWith('Ошибка') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{msg}</div>}

        <div className={`overflow-auto bg-secondary/50 p-4 ${edit ? 'max-h-[calc(94vh-230px)]' : 'max-h-[calc(94vh-64px)]'}`}>
          {edit ? (
            <div className="mx-auto w-[210mm] max-w-full bg-white px-[15mm] pb-[20mm] pt-[15mm] text-black shadow">
              <div ref={ref} contentEditable suppressContentEditableWarning className="bizdoc outline-none ring-amber-300 focus:ring-2" />
            </div>
          ) : (
            <div className="text-black" dangerouslySetInnerHTML={{ __html: paged }} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
