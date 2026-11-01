import { useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { skudCall } from '@/lib/skudApi';

interface Person { name: string; vk: boolean; sent: boolean; error: string | null }

export default function AlarmTest() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ token: boolean; people: Person[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setErr(null);
    const r = await skudCall<{ token: boolean; people: Person[] }>({ action: 'alarm_test' });
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    setRes(r);
  };

  return (
    <div className="space-y-2 border-t pt-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={run}>
        <Icon name="Send" size={14} />{busy ? 'Отправляю…' : 'Проверить: отправить тестовую тревогу'}
      </Button>
      {err && <p className="text-xs text-destructive">{err}</p>}
      {res && (
        <div className="space-y-1 rounded-lg bg-secondary/60 p-2 text-xs">
          {!res.token && <p className="font-medium text-destructive">На сервере не указан ключ сообщества ВК — сообщения не уходят никому.</p>}
          {res.people.map((p) => (
            <div key={p.name} className="flex justify-between gap-2">
              <span>{p.name}</span>
              <span className={p.sent ? 'text-emerald-600' : 'text-amber-600'}>
                {p.sent ? 'доставлено' : !p.vk ? 'ВК не привязан' : p.error || 'не доставлено'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
