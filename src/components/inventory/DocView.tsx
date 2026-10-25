import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { InvDoc, InvLine, invCall, KIND_STYLE, qtyFmt } from '@/lib/inventoryApi';
import { rub } from '@/lib/accountingApi';

const TITLE: Record<string, string> = { income: 'Акт прихода', writeoff: 'Акт списания', recount: 'Инвентаризационная опись' };
const KIND: Record<string, string> = { income: 'Приход', writeoff: 'Списание', recount: 'Пересчёт' };

function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function printDoc(d: InvDoc, lines: InvLine[]) {
  const date = new Date(d.doc_date).toLocaleDateString('ru-RU');
  const rows = lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.item_code)}</td><td>${esc(l.item_name)}</td><td>${esc(l.unit)}</td>`
    + (d.kind === 'recount' ? `<td>${qtyFmt(l.qty_before)}</td><td>${qtyFmt(l.qty_after)}</td><td>${l.qty > 0 ? '+' : ''}${qtyFmt(l.qty)}</td>` : `<td>${qtyFmt(l.qty)}</td><td>${rub(Number(l.price))}</td><td>${rub(Math.abs(l.qty) * Number(l.price))}</td>`)
    + '</tr>').join('');
  const head = d.kind === 'recount' ? '<th>По учёту</th><th>Факт</th><th>Разница</th>' : '<th>Кол-во</th><th>Цена</th><th>Сумма</th>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${TITLE[d.kind]} № ${esc(d.number)}</title><style>
    body{font-family:'Times New Roman',serif;font-size:12pt;margin:20mm}h1{text-align:center;font-size:16pt;margin:0}
    .n{text-align:center;margin:4pt 0 14pt}table{width:100%;border-collapse:collapse;margin:10pt 0}td,th{border:1px solid #000;padding:3pt 5pt;font-size:11pt}
    th{background:#eee}.s{display:flex;justify-content:space-between;margin-top:30pt}</style></head><body>
    <h1>${TITLE[d.kind].toUpperCase()}</h1><div class="n">№ <b>${esc(d.number)}</b> от ${date}</div>
    ${d.reason ? `<p><b>${d.kind === 'writeoff' ? 'Причина списания' : 'Основание'}:</b> ${esc(d.reason)}</p>` : ''}
    ${d.comment ? `<p><b>Комментарий:</b> ${esc(d.comment)}</p>` : ''}
    <table><tr><th>№</th><th>Инв. номер</th><th>Наименование</th><th>Ед.</th>${head}</tr>${rows}</table>
    ${d.kind !== 'recount' ? `<p style="text-align:right"><b>Итого: ${rub(Number(d.total))}</b></p>` : ''}
    <div class="s"><div>Составил: ____________ / ${esc(d.created_by)}</div><div>Утвердил: ____________ / ____________</div></div>
    <script>window.onload=()=>window.print()</script></body></html>`;
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

export default function DocView({ id, onClose }: { id: number; onClose: () => void }) {
  const [d, setD] = useState<(InvDoc & { lines: InvLine[] }) | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    invCall<{ doc: InvDoc & { lines: InvLine[] } }>({ action: 'doc', id }).then(r => (r.error ? setError(r.error) : setD(r.doc)));
  }, [id]);

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{d ? `${TITLE[d.kind]} № ${d.number}` : 'Документ'}</DialogTitle></DialogHeader>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!d && !error && <Icon name="Loader2" size={20} className="mx-auto animate-spin text-muted-foreground" />}
        {d && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded-full border px-2 py-0.5 text-xs ${KIND_STYLE[d.kind]}`}>{KIND[d.kind]}</span>
              <span>{new Date(d.doc_date).toLocaleDateString('ru-RU')}</span>
              <span className="text-muted-foreground">· {d.created_by}</span>
            </div>
            {d.reason && <p className="text-sm"><b>{d.kind === 'writeoff' ? 'Причина' : 'Основание'}:</b> {d.reason}</p>}
            {d.comment && <p className="text-sm text-muted-foreground">{d.comment}</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1.5">Номер</th><th>Наименование</th><th className="text-right">Было</th><th className="text-right">{d.kind === 'recount' ? 'Разница' : 'Кол-во'}</th><th className="text-right">Стало</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {d.lines.map(l => (
                    <tr key={l.id}>
                      <td className="py-1.5 font-mono text-xs">{l.item_code}</td>
                      <td>{l.item_name}</td>
                      <td className="text-right">{qtyFmt(l.qty_before)}</td>
                      <td className={`text-right font-medium ${d.kind === 'writeoff' || l.qty < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{d.kind === 'writeoff' ? '−' : l.qty > 0 ? '+' : ''}{qtyFmt(l.qty)} {l.unit}</td>
                      <td className="text-right">{qtyFmt(l.qty_after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {d.kind !== 'recount' && <p className="text-right text-sm font-semibold">Сумма: {rub(Number(d.total))}</p>}
            <Button variant="outline" onClick={() => printDoc(d, d.lines)}><Icon name="Printer" size={16} />Печать акта</Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
