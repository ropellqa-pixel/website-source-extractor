import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { camerasCall, fmtSec, secOfDay, toDayStr, type RecordRange } from '@/lib/camerasApi';

interface Props {
  cameraId: string;
  playingFrom: number | null;
  position: number | null;
  onSeek: (day: string, sec: number) => void;
  onLive: () => void;
  initialDay?: string;
}

const CHUNKS: [number, number][] = [[0, 5], [6, 11], [12, 17], [18, 23]];

export default function ArchiveBar({ cameraId, playingFrom, position, onSeek, onLive, initialDay }: Props) {
  const [day, setDay] = useState(initialDay || toDayStr(new Date()));
  const [records, setRecords] = useState<RecordRange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState('');
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setRecords([]); setError(null); setLoading(true);
    let done = 0;
    CHUNKS.forEach(([from, to]) => {
      camerasCall<{ records?: RecordRange[] }>({ action: 'records', id: cameraId, day, from_hour: from, to_hour: to }).then((r) => {
        if (!alive) return;
        if (r.error) setError(r.error);
        if (r.records) setRecords((prev) => [...prev, ...r.records!].sort((a, b) => a.start.localeCompare(b.start)));
        if (++done === CHUNKS.length) setLoading(false);
      });
    });
    return () => { alive = false; };
  }, [cameraId, day]);

  const now = new Date();
  const nowSec = day === toDayStr(now) ? now.getHours() * 3600 + now.getMinutes() * 60 : 86400;

  const seekByX = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sec = Math.round(((e.clientX - rect.left) / rect.width) * 86400);
    onSeek(day, Math.min(sec, nowSec - 30));
  };

  const go = () => {
    const [h, m] = time.split(':').map(Number);
    if (Number.isNaN(h)) return;
    onSeek(day, h * 3600 + (m || 0) * 60);
  };

  const shiftDay = (delta: number) => {
    const d = new Date(day + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    if (d > new Date()) return;
    setDay(toDayStr(d));
  };

  const pos = position ?? playingFrom;

  return (
    <div className="space-y-2 rounded-2xl bg-black/70 p-3 text-white backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => shiftDay(-1)} className="rounded-lg p-1.5 hover:bg-white/10" aria-label="Предыдущий день">
          <Icon name="ChevronLeft" size={18} />
        </button>
        <input
          type="date"
          value={day}
          max={toDayStr(new Date())}
          onChange={(e) => e.target.value && setDay(e.target.value)}
          className="rounded-lg bg-white/10 px-2 py-1 text-sm text-white [color-scheme:dark]"
        />
        <button onClick={() => shiftDay(1)} className="rounded-lg p-1.5 hover:bg-white/10" aria-label="Следующий день">
          <Icon name="ChevronRight" size={18} />
        </button>
        <div className="ml-2 flex items-center gap-1">
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && go()}
            className="rounded-lg bg-white/10 px-2 py-1 text-sm text-white [color-scheme:dark]"
          />
          <button onClick={go} className="rounded-lg bg-white/15 px-3 py-1 text-sm hover:bg-white/25">Перейти</button>
        </div>
        {pos !== null && (
          <span className="ml-auto font-mono text-sm text-white/80">{fmtSec(pos)}</span>
        )}
        <button onClick={onLive} className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1 text-sm font-medium hover:bg-red-500">
          <span className="h-2 w-2 rounded-full bg-white" /> В эфир
        </button>
      </div>

      <div
        className="relative h-9 cursor-pointer select-none overflow-hidden rounded-lg bg-white/10"
        onClick={seekByX}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.round(((e.clientX - r.left) / r.width) * 86400));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {records.map((r, i) => {
          const s = secOfDay(r.start); const en = secOfDay(r.end);
          return (
            <div key={i} className="absolute inset-y-0 bg-emerald-500/70"
              style={{ left: `${(s / 86400) * 100}%`, width: `${Math.max(((en - s) / 86400) * 100, 0.15)}%` }} />
          );
        })}
        {Array.from({ length: 25 }).map((_, h) => (
          <div key={h} className="pointer-events-none absolute bottom-0 h-2 w-px bg-white/30" style={{ left: `${(h / 24) * 100}%` }} />
        ))}
        {pos !== null && (
          <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-red-500" style={{ left: `${(pos / 86400) * 100}%` }} />
        )}
        {hover !== null && (
          <div className="pointer-events-none absolute top-0.5 -translate-x-1/2 rounded bg-black/80 px-1.5 text-[11px]" style={{ left: `${(hover / 86400) * 100}%` }}>
            {fmtSec(hover).slice(0, 5)}
          </div>
        )}
        {loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-white/70">
            <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" /> Загружаю записи с карты памяти...
          </div>
        )}
        {!loading && records.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-white/60">
            {error || 'За этот день записей нет'}
          </div>
        )}
      </div>
      <div className="flex justify-between px-0.5 text-[10px] text-white/50">
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => <span key={h}>{String(h).padStart(2, '0')}:00</span>)}
      </div>
    </div>
  );
}