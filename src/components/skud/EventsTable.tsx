import { useNavigate } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import { fmtDate, fmtDur, fmtTime, mskDay, mskSec, type SkudEvent } from '@/lib/skudApi';

const STYLE: Record<string, { icon: string; cls: string }> = {
  entry: { icon: 'LogIn', cls: 'text-emerald-600 bg-emerald-500/10' },
  exit: { icon: 'LogOut', cls: 'text-sky-600 bg-sky-500/10' },
  exit_button: { icon: 'LogOut', cls: 'text-sky-600 bg-sky-500/10' },
  remote_open: { icon: 'DoorOpen', cls: 'text-violet-600 bg-violet-500/10' },
  denied: { icon: 'Ban', cls: 'text-amber-600 bg-amber-500/10' },
  denied_blocked: { icon: 'Ban', cls: 'text-red-600 bg-red-500/10' },
  forced: { icon: 'TriangleAlert', cls: 'text-red-600 bg-red-500/10' },
  held_open: { icon: 'DoorOpen', cls: 'text-amber-600 bg-amber-500/10' },
  reader_fault: { icon: 'WifiOff', cls: 'text-red-600 bg-red-500/10' },
  button_stuck: { icon: 'CircleAlert', cls: 'text-amber-600 bg-amber-500/10' },
};

/** Сколько человек пробыл на складе: от входа до ближайшего следующего выхода (в пределах 12 ч). */
function stayFor(events: SkudEvent[], i: number): string | null {
  const e = events[i];
  if (e.kind !== 'entry' || !e.profile_id) return null;
  const t = new Date(e.time).getTime();
  for (let j = i - 1; j >= 0; j--) {
    const x = events[j];
    const tx = new Date(x.time).getTime();
    if (tx - t > 12 * 3600e3) break;
    if (x.kind === 'entry' && x.profile_id === e.profile_id) return null;
    if (x.kind === 'exit' && x.profile_id === e.profile_id) return fmtDur(tx - t);
  }
  return null;
}

export default function EventsTable({ events, warehouseCameraId }: { events: SkudEvent[]; warehouseCameraId: string | null }) {
  const navigate = useNavigate();
  const openVideo = (e: SkudEvent) => {
    const cam = e.camera_id || warehouseCameraId;
    if (!cam) return;
    navigate(`/cameras?cam=${cam}&day=${mskDay(new Date(e.time))}&sec=${Math.max(0, mskSec(e.time) - 10)}`);
  };

  if (!events.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-muted-foreground">
        <Icon name="DoorClosed" size={32} />
        <p className="text-sm">Записей за этот период нет</p>
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10 bg-card text-left text-xs text-muted-foreground">
        <tr className="border-b">
          <th className="px-3 py-2.5 font-medium">Дата</th>
          <th className="px-3 py-2.5 font-medium">Время</th>
          <th className="px-3 py-2.5 font-medium">Сотрудник</th>
          <th className="px-3 py-2.5 font-medium">Событие</th>
          <th className="hidden px-3 py-2.5 font-medium md:table-cell">На складе</th>
          <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Карта</th>
          <th className="px-3 py-2.5 text-right font-medium">Видео</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e, i) => {
          const st = STYLE[e.kind] || { icon: 'Info', cls: 'text-muted-foreground bg-secondary' };
          const stay = stayFor(events, i);
          return (
            <tr key={e.id} className="border-b last:border-0 hover:bg-secondary/40">
              <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground">{fmtDate(e.time)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 font-medium tabular-nums">{fmtTime(e.time)}</td>
              <td className="px-3 py-2.5">
                <div className="font-medium">{e.name || (e.card ? 'Неизвестная карта' : '—')}</div>
                {e.department && <div className="text-xs text-muted-foreground">{e.department}</div>}
              </td>
              <td className="px-3 py-2.5">
                <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${st.cls}`}>
                  <Icon name={st.icon} size={13} />{e.kind_label}
                </span>
                {e.note && <div className="mt-0.5 text-xs text-muted-foreground">{e.note}</div>}
              </td>
              <td className="hidden whitespace-nowrap px-3 py-2.5 text-muted-foreground md:table-cell">{stay || ''}</td>
              <td className="hidden px-3 py-2.5 font-mono text-xs text-muted-foreground lg:table-cell">{e.card || ''}</td>
              <td className="px-3 py-2.5 text-right">
                <button onClick={() => openVideo(e)} disabled={!e.camera_id && !warehouseCameraId}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-40"
                  title="Открыть архив камеры «Склад» на это время">
                  <Icon name="Play" size={13} />Смотреть
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
