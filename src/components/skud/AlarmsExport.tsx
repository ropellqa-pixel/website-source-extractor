import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { ALARM_KINDS, fmtDate, fmtTime, skudCall, type SkudEvent } from '@/lib/skudApi';

interface Props { open: boolean; onOpenChange: (v: boolean) => void; from: string; to: string }

function download(events: SkudEvent[], from: string, to: string) {
  const rows = [['Дата', 'Время', 'Тревога', 'Дверь', 'Сотрудник / карта', 'Отдел', 'Номер карты', 'Примечание']];
  events.forEach((e) => rows.push([fmtDate(e.time), fmtTime(e.time), e.kind_label, e.door || '', e.name || 'не записана', e.department || '', e.card || '', e.note || '']));
  const csv = '\uFEFF' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `СКУД_тревоги_${from}_${to}.csv`;
  a.click();
}

export default function AlarmsExport({ open, onOpenChange, from: f0, to: t0 }: Props) {
  const [from, setFrom] = useState(f0);
  const [to, setTo] = useState(t0);
  const [kinds, setKinds] = useState<string[]>(Object.keys(ALARM_KINDS));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setMsg(null);
    const r = await skudCall<{ events: SkudEvent[] }>({ action: 'events', kind: 'alarm', kinds, date_from: from, date_to: to, limit: 3000 });
    setBusy(false);
    if (r.error) { setMsg(r.error); return; }
    if (!r.events.length) { setMsg('За этот период тревог нет'); return; }
    download(r.events, from, to);
    setMsg(`Выгружено тревог: ${r.events.length}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Выгрузка тревог</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-muted-foreground">—</span>
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            {Object.entries(ALARM_KINDS).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={kinds.includes(k)}
                  onChange={(e) => setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k))} />
                {l}
              </label>
            ))}
          </div>
          {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
          <Button className="w-full" onClick={run} disabled={busy || !kinds.length}>
            <Icon name="Download" size={15} />{busy ? 'Собираю…' : 'Скачать для Excel'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
