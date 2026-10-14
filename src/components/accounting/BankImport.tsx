import { useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { accCall, fmtDay, rub, type Category } from '@/lib/accountingApi';

interface Row {
  idx: number; date: string; kind: 'income' | 'expense'; amount: number; number: string; name: string; inn: string; purpose: string;
  duplicate: boolean; closed: boolean; counterparty_id: number | null; counterparty_new: boolean; category_id: number | null;
}
interface Preview { account: string; date_from: string | null; date_to: string | null; rows: Row[]; income: number; expense: number }

export default function BankImport({ categories, onDone }: { categories: Category[]; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [cats, setCats] = useState<Record<number, string>>({});
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const pick = (f: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const data = String(reader.result);
      setFile({ name: f.name, data }); setBusy(true); setError(null); setDone(null);
      const r = await accCall<Preview>({ action: 'bank_preview', file_name: f.name, file: data });
      setBusy(false);
      if (r.error) { setError(r.error); return; }
      setPreview(r); setCats({}); setSkip(new Set());
    };
    reader.readAsDataURL(f);
  };

  const commit = async () => {
    if (!file || !preview) return;
    setBusy(true);
    const r = await accCall<{ added: number; skipped: number }>({
      action: 'bank_import', file_name: file.name, file: file.data,
      categories: Object.fromEntries(Object.entries(cats).filter(([, v]) => v)), skip: [...skip].map(String),
    });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setPreview(null);
    setDone(`Загружено операций: ${r.added}. Пропущено (уже были или месяц закрыт): ${r.skipped}.`);
    onDone();
  };

  const fresh = preview?.rows.filter((r) => !r.duplicate && !r.closed) || [];

  return (
    <>
      <input ref={fileRef} type="file" accept=".txt,.xlsx,.xls" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }} />
      <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
        <Icon name={busy && !preview ? 'Loader2' : 'Landmark'} size={15} className={busy && !preview ? 'animate-spin' : ''} />Выписка СберБизнес
      </Button>
      {(error || done) && !preview && (
        <span className={`text-xs ${error ? 'text-red-600' : 'text-emerald-600'}`}>{error || done}</span>
      )}

      <Dialog open={!!preview} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader><DialogTitle>Выписка банка</DialogTitle></DialogHeader>
          {preview && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-4 text-sm">
                {preview.account && <span className="text-muted-foreground">Счёт {preview.account}</span>}
                {preview.date_from && <span className="text-muted-foreground">{fmtDay(preview.date_from)} — {fmtDay(preview.date_to || '')}</span>}
                <span>Новых: <b>{fresh.length}</b> из {preview.rows.length}</span>
                <span className="text-emerald-700">Поступления {rub(preview.income)}</span>
                <span className="text-red-700">Списания {rub(preview.expense)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Контрагенты подбираются по ИНН (новые создадутся сами), статья — по прошлым платежам этому контрагенту или по назначению платежа.
                Выбранная статья запомнится за контрагентом. Строки, которые уже загружались, пропускаются.
              </p>
              <div className="max-h-[55vh] overflow-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                    <tr className="border-b"><th className="w-8" /><th className="px-3 py-2 font-medium">Дата</th><th className="px-3 py-2 font-medium">Контрагент и назначение</th><th className="px-3 py-2 text-right font-medium">Сумма</th><th className="px-3 py-2 font-medium">Статья</th></tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => {
                      const off = r.duplicate || r.closed || skip.has(r.idx);
                      return (
                        <tr key={r.idx} className={`border-b last:border-0 ${off ? 'opacity-45' : ''}`}>
                          <td className="px-2 text-center">
                            {!r.duplicate && !r.closed && (
                              <input type="checkbox" checked={!skip.has(r.idx)} onChange={(e) => {
                                const n = new Set(skip); if (e.target.checked) n.delete(r.idx); else n.add(r.idx); setSkip(n);
                              }} />
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDay(r.date)}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium">
                              {r.name || '—'}
                              {r.counterparty_new && !off && <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">новый</span>}
                              {r.duplicate && <span className="ml-2 text-[11px] text-muted-foreground">уже загружено</span>}
                              {r.closed && <span className="ml-2 text-[11px] text-muted-foreground">месяц закрыт</span>}
                            </div>
                            <div className="line-clamp-2 text-xs text-muted-foreground">{r.purpose}</div>
                          </td>
                          <td className={`whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums ${r.kind === 'income' ? 'text-emerald-700' : 'text-red-700'}`}>
                            {r.kind === 'income' ? '+' : '−'}{rub(r.amount)}
                          </td>
                          <td className="px-3 py-2">
                            {!off && (
                              <select value={cats[r.idx] ?? (r.category_id ? String(r.category_id) : '')} onChange={(e) => setCats({ ...cats, [r.idx]: e.target.value })}
                                className={`h-8 w-48 rounded-md border bg-background px-2 text-sm ${!(cats[r.idx] ?? r.category_id) ? 'border-amber-500/60' : ''}`}>
                                <option value="">— без статьи —</option>
                                {categories.filter((c) => c.kind === r.kind && !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </select>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setPreview(null)}>Отмена</Button>
                <Button onClick={commit} disabled={busy || fresh.length - skip.size <= 0}>
                  {busy ? 'Загружаю…' : `Загрузить ${Math.max(0, fresh.filter((r) => !skip.has(r.idx)).length)} операций`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
