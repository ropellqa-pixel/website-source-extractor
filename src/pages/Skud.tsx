import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import EventsTable from '@/components/skud/EventsTable';
import CardsPanel from '@/components/skud/CardsPanel';
import ControllerPanel from '@/components/skud/ControllerPanel';
import { fmtDate, fmtTime, mskDay, skudCall, type Employee, type SkudCard, type SkudController, type SkudEvent } from '@/lib/skudApi';

type Kind = 'all' | 'pass' | 'alarm';

function exportCsv(events: SkudEvent[]) {
  const rows = [['Дата', 'Время', 'Сотрудник', 'Отдел', 'Событие', 'Карта', 'Примечание']];
  events.forEach((e) => rows.push([fmtDate(e.time), fmtTime(e.time), e.name || '', e.department || '', e.kind_label, e.card || '', e.note || '']));
  const csv = '\uFEFF' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `СКУД_${mskDay(new Date())}.csv`;
  a.click();
}

export default function Skud() {
  const today = mskDay(new Date());
  const [from, setFrom] = useState(mskDay(new Date(Date.now() - 6 * 864e5)));
  const [to, setTo] = useState(today);
  const [person, setPerson] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [events, setEvents] = useState<SkudEvent[]>([]);
  const [cards, setCards] = useState<SkudCard[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [cameras, setCameras] = useState<{ id: string; name: string }[]>([]);
  const [controllers, setControllers] = useState<SkudController[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [ctrlOpen, setCtrlOpen] = useState(false);
  const [opening, setOpening] = useState(false);

  const ctrl = controllers[0] || null;
  const warehouseCam = ctrl?.camera_id || cameras.find((c) => /склад/i.test(c.name))?.id || null;

  const loadOverview = useCallback(async () => {
    const r = await skudCall<{ controllers: SkudController[]; cards: SkudCard[]; employees: Employee[]; cameras: { id: string; name: string }[] }>({ action: 'overview' });
    if (r.error) { setError(r.error); setLoading(false); return; }
    setControllers(r.controllers); setCards(r.cards); setEmployees(r.employees); setCameras(r.cameras);
  }, []);

  const loadEvents = useCallback(async () => {
    const r = await skudCall<{ events: SkudEvent[] }>({ action: 'events', date_from: from, date_to: to, profile_id: person || undefined, kind });
    if (!r.error) setEvents(r.events);
    setLoading(false);
  }, [from, to, person, kind]);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { loadEvents(); }, [loadEvents]);
  // Новые проходы появляются сами — журнал обновляется каждые 10 секунд.
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) { loadEvents(); loadOverview(); } }, 10000);
    return () => clearInterval(t);
  }, [loadEvents, loadOverview]);

  const stats = useMemo(() => {
    const todayEv = events.filter((e) => mskDay(new Date(e.time)) === today);
    const inside = new Map<string, string>();
    [...todayEv].reverse().forEach((e) => {
      if (!e.profile_id) return;
      if (e.kind === 'entry') inside.set(e.profile_id, e.name || '');
      if (e.kind === 'exit') inside.delete(e.profile_id);
    });
    return {
      passes: todayEv.filter((e) => e.kind === 'entry').length,
      alarms: todayEv.filter((e) => ['denied', 'denied_blocked', 'forced', 'held_open'].includes(e.kind)).length,
      active: cards.filter((c) => c.status === 'active').length,
    };
  }, [events, cards, today]);

  const openDoor = async () => {
    if (!ctrl || !confirm(`Открыть дверь «${ctrl.name}»?`)) return;
    setOpening(true);
    const r = await skudCall({ action: 'open_door', id: ctrl.id });
    setOpening(false);
    if (r.error) alert(r.error); else loadEvents();
  };

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Icon name="ShieldAlert" size={32} className="text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold tracking-tight">СКУД</h1>
          <p className="text-sm text-muted-foreground">Контроль доступа на склад</p>
        </div>
        <button onClick={() => setCtrlOpen(true)}
          className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-secondary">
          <span className={`h-2 w-2 rounded-full ${ctrl?.online ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
          {ctrl ? `${ctrl.name}: ${ctrl.online ? 'на связи' : 'не на связи'}` : 'Добавить контроллер'}
        </button>
        <button onClick={() => setCardsOpen(true)} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-secondary">
          <Icon name="IdCard" fallback="CreditCard" size={16} />Ключ-карты
        </button>
        <button onClick={openDoor} disabled={!ctrl || opening}
          className="flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          <Icon name="DoorOpen" size={16} />{opening ? 'Открываю…' : 'Открыть дверь'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Входов сегодня', value: stats.passes, icon: 'LogIn' },
          { label: 'Тревог сегодня', value: stats.alarms, icon: 'TriangleAlert', warn: stats.alarms > 0 },
          { label: 'Активных карт', value: stats.active, icon: 'IdCard' },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border bg-card p-3.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon name={s.icon} fallback="Circle" size={14} />{s.label}</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${s.warn ? 'text-red-600' : ''}`}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 w-auto" />
        <span className="text-muted-foreground">—</span>
        <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-9 w-auto" />
        <select value={person} onChange={(e) => setPerson(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm">
          <option value="">Все сотрудники</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <div className="flex rounded-lg border p-0.5">
          {([['all', 'Все'], ['pass', 'Проходы'], ['alarm', 'Тревоги']] as [Kind, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setKind(k)}
              className={`rounded-md px-3 py-1 text-sm ${kind === k ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'}`}>{l}</button>
          ))}
        </div>
        <button onClick={() => exportCsv(events)} disabled={!events.length}
          className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-40">
          <Icon name="Download" size={15} />В Excel
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border bg-card">
        {loading ? (
          <div className="flex justify-center py-20"><Icon name="Loader2" size={24} className="animate-spin text-muted-foreground" /></div>
        ) : (
          <EventsTable events={events} warehouseCameraId={warehouseCam} />
        )}
      </div>

      <CardsPanel open={cardsOpen} onOpenChange={setCardsOpen} cards={cards} employees={employees} onChanged={setCards} />
      {ctrlOpen && (
        <ControllerPanel open={ctrlOpen} onOpenChange={setCtrlOpen} controller={ctrl} cameras={cameras} onChanged={setControllers} />
      )}
    </div>
  );
}
