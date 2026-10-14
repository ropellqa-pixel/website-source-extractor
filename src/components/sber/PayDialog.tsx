import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { rub } from '@/lib/accountingApi';
import { sberCall, VAT_LABELS, type SberRequest } from '@/lib/sberApi';

export default function PayDialog({ items, onClose, onDone }: { items: SberRequest[]; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ id: number; ok: boolean; error?: string }[] | null>(null);
  const total = items.reduce((s, r) => s + r.amount, 0);

  const pay = async () => {
    setBusy(true); setError(null);
    const r = await sberCall<{ results: { id: number; ok: boolean; error?: string }[] }>({ action: 'pay', ids: items.map((x) => x.id), password });
    setBusy(false); setPassword('');
    if (r.error) { setError(r.error); return; }
    setResults(r.results);
    onDone();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Оплата через СберБизнес</DialogTitle></DialogHeader>
        {results ? (
          <div className="space-y-3">
            {results.map((x) => {
              const r = items.find((i) => i.id === x.id);
              return (
                <div key={x.id} className="flex items-start gap-2 text-sm">
                  <Icon name={x.ok ? 'CircleCheck' : 'CircleX'} size={18} className={x.ok ? 'text-emerald-600' : 'text-red-600'} />
                  <div><b>{r?.counterparty}</b> — {rub(r?.amount || 0)}<div className="text-muted-foreground">{x.ok ? 'Платёжка создана в СберБизнес' : x.error}</div></div>
                </div>
              );
            })}
            <div className="rounded-xl bg-secondary p-3 text-sm">
              Платёжки созданы. Подпишите их в СберБизнес (приложение или сайт) — после подписи банк исполнит оплату, а статус здесь обновится сам.
            </div>
            <Button className="w-full" onClick={onClose}>Готово</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="max-h-72 space-y-2 overflow-auto">
              {items.map((r) => (
                <div key={r.id} className="rounded-xl border p-3 text-sm">
                  <div className="flex justify-between gap-2"><b>{r.requisites.name}</b><b className="tabular-nums">{rub(r.amount)}</b></div>
                  <div className="text-xs text-muted-foreground">ИНН {r.requisites.inn || '—'} · р/с {r.requisites.account} · БИК {r.requisites.bic}</div>
                  <div className="mt-1 text-xs">{r.purpose} · {VAT_LABELS[r.vat_rate] || r.vat_rate}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-xl bg-emerald-600/10 px-4 py-3">
              <span className="text-sm">Итого к оплате ({items.length})</span><span className="text-lg font-semibold tabular-nums">{rub(total)}</span>
            </div>
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">Подтвердите паролем от вашей учётной записи</span>
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && password && pay()} autoFocus />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={pay} disabled={busy || !password}>
              <Icon name="ShieldCheck" size={16} />{busy ? 'Отправляю в банк…' : `Оплатить ${rub(total)}`}
            </Button>
            <p className="text-center text-xs text-muted-foreground">Деньги спишутся только после подписи платёжки в СберБизнес</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
