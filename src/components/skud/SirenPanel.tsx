import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { SIREN_KINDS, skudCall, type SkudController, type SkudSiren } from '@/lib/skudApi';

interface Props {
  controller: SkudController;
  onChanged: (list: SkudController[]) => void;
}

export default function SirenPanel({ controller, onChanged }: Props) {
  const [v, setV] = useState<SkudSiren>(controller.siren || { addr: 0, seconds: 30, kinds: ['forced', 'held_open'] });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (controller.siren) setV(controller.siren); }, [controller.siren]);

  const call = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action); setMsg(null);
    const r = await skudCall<{ controllers: SkudController[] }>({ action, id: controller.id, ...extra });
    setBusy(null);
    if (r.error) { setMsg(r.error); return false; }
    onChanged(r.controllers);
    return true;
  };

  const save = async (next: SkudSiren) => {
    setV(next);
    if (await call('siren_save', { siren: next })) setMsg('Сохранено');
  };

  const toggle = (k: string) => save({ ...v, kinds: v.kinds.includes(k) ? v.kinds.filter((x) => x !== k) : [...v.kinds, k] });

  return (
    <section className="space-y-3 rounded-xl border p-3">
      <div className="flex items-center gap-2">
        <Icon name="Siren" fallback="BellRing" size={16} className="text-red-600" />
        <h3 className="text-sm font-semibold">Сирена / звук на двери</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Сирена или зуммер подключается электриком к дополнительному выходу контроллера. Программа на ПК склада включает её сразу при тревоге — даже без интернета.
        Считыватель у двери пищит сам при «дверь не закрыта», это делает контроллер.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Выход, куда подключена сирена</label>
          <select value={v.addr} disabled={!!busy} onChange={(e) => save({ ...v, addr: Number(e.target.value) })}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm">
            <option value={0}>— сирены нет —</option>
            {controller.outputs.map((o) => <option key={o.addr} value={o.addr}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Сколько звучит, сек</label>
          <Input type="number" min={1} max={255} value={v.seconds}
            onChange={(e) => setV({ ...v, seconds: Number(e.target.value) || 1 })}
            onBlur={() => save({ ...v, seconds: Math.max(1, Math.min(v.seconds, 255)) })} />
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium">Когда включать</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {Object.entries(SIREN_KINDS).map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={v.kinds.includes(k)} disabled={!!busy || !v.addr} onChange={() => toggle(k)} />{l}
            </label>
          ))}
        </div>
      </div>
      {v.addr > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => call('siren_test').then((ok) => ok && setMsg('Сирена включится на 3 секунды'))}>
            <Icon name="Volume2" size={14} />Проверить (3 сек)
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => call('siren_stop').then((ok) => ok && setMsg('Команда «выключить» отправлена'))}>
            <Icon name="VolumeX" size={14} />Выключить сирену
          </Button>
        </div>
      )}
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </section>
  );
}
