import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { fmtDate, skudCall } from '@/lib/skudApi';

interface Master { id: string; card: string; written_at: string }

export default function MasterCardBlock() {
  const [master, setMaster] = useState<Master | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [card, setCard] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    skudCall<{ master: Master | null }>({ action: 'master_get' }).then((r) => {
      if (!r.error) setMaster(r.master);
      setLoaded(true);
    });
  }, []);

  const submit = async (action: 'master_save' | 'master_delete') => {
    if (action === 'master_delete' && !confirm('Удалить мастер-карту из СКУД?')) return;
    setBusy(true); setError(null); setOk(null);
    const r = await skudCall<{ master: Master | null }>({ action, card, pin });
    setBusy(false);
    setPin('');
    if (r.error) { setError(r.error); return; }
    setMaster(r.master);
    setEditing(false); setCard('');
    setOk(action === 'master_save' ? 'Мастер-карта сохранена и отправлена на дверь' : 'Мастер-карта удалена');
  };

  if (!loaded) return null;

  return (
    <div className="mt-6 rounded-xl border border-amber-500/40 bg-card p-5">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600">
          <Icon name="KeyRound" size={20} />
        </div>
        <div>
          <p className="font-semibold text-foreground">Мастер-карта СКУД</p>
          <p className="text-xs text-muted-foreground">Подтверждает запись любых карт и открывает дверь. Продлевать не нужно.</p>
        </div>
      </div>

      {master && !editing && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-foreground">{master.card.replace(/\d(?=\d{2})/g, '•')}</span>
          <span className="text-xs text-muted-foreground">добавлена {fmtDate(master.written_at)}</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setEditing(true); setOk(null); }}>Заменить</Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setEditing(true)}>Удалить</Button>
          </div>
        </div>
      )}

      {(!master || editing) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Карта</label>
            <Input data-abiz-card="1" type="password" autoComplete="off" value={card} onChange={(e) => setCard(e.target.value)}
              placeholder="Поднесите карту к USB-считывателю" className="font-mono" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Ваш ПИН-код</label>
            <Input type="password" inputMode="numeric" maxLength={4} autoComplete="off" value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="4 цифры"
              onKeyDown={(e) => { if (e.key === 'Enter' && card && pin.length === 4) submit('master_save'); }} />
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button onClick={() => submit('master_save')} disabled={busy || !card || pin.length !== 4}>
              {busy ? 'Сохраняю…' : master ? 'Заменить мастер-карту' : 'Добавить мастер-карту'}
            </Button>
            {master && (
              <>
                <Button variant="ghost" className="text-destructive" onClick={() => submit('master_delete')} disabled={busy || pin.length !== 4}>Удалить</Button>
                <Button variant="ghost" onClick={() => { setEditing(false); setError(null); setCard(''); setPin(''); }}>Отмена</Button>
              </>
            )}
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      {ok && <p className="mt-2 text-sm text-emerald-600">{ok}</p>}
    </div>
  );
}
