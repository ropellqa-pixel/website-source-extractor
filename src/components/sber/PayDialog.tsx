import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { rub } from '@/lib/accountingApi';
import { sberCall, VAT_LABELS, type SberConnection, type SberRequest } from '@/lib/sberApi';

export default function PayDialog({ items, connections, onClose, onDone }: { items: SberRequest[]; connections: SberConnection[]; onClose: () => void; onDone: () => void }) {
  const live = connections.filter((c) => c.active && c.account);
  const [connId, setConnId] = useState<number | null>((live.find((c) => c.is_default) || live[0])?.id ?? null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ id: number; ok: boolean; error?: string; sign_url?: string }[] | null>(null);
  const total = items.reduce((s, r) => s + r.amount, 0);

  const pay = async () => {
    setBusy(true); setError(null);
    const r = await sberCall<{ results: { id: number; ok: boolean; error?: string; sign_url?: string }[] }>({ action: 'pay', ids: items.map((x) => x.id), password, connection_id: connId, origin: window.location.origin });
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
                  <div className="flex-1"><b>{r?.counterparty}</b> — {rub(r?.amount || 0)}<div className="text-muted-foreground">{x.ok ? 'Платёжка создана, осталось подписать кодом из СМС' : x.error}</div></div>
                  {x.ok && x.sign_url && (
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { window.location.href = x.sign_url!; }}>
                      <Icon name="MessageSquareCode" fallback="Smartphone" size={15} />Подписать по СМС
                    </Button>
                  )}
                </div>
              );
            })}
            <div className="rounded-xl bg-secondary p-3 text-sm">
              Нажмите «Подписать по СМС» — откроется страница Сбера, войдите и введите код из СМС. После подписи вы автоматически вернётесь сюда, статус обновится сам.
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
            {live.length > 1 && (
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">Списать со счёта</span>
                <select value={connId ?? ''} onChange={(e) => setConnId(Number(e.target.value))} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
                  {live.map((c) => <option key={c.id} value={c.id}>{c.title} · •••• {c.account?.slice(-4)}</option>)}
                </select>
              </label>
            )}
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">Подтвердите паролем от вашей учётной записи</span>
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && password && pay()} autoFocus />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={pay} disabled={busy || !password}>
              <Icon name="ShieldCheck" size={16} />{busy ? 'Отправляю в банк…' : `Оплатить ${rub(total)}`}
            </Button>
            <p className="text-center text-xs text-muted-foreground">Следующий шаг — подтверждение кодом из СМС от Сбера</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
