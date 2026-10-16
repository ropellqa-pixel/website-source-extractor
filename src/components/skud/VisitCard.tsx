import { useState } from 'react';
import Icon from '@/components/ui/icon';
import { fmtDate, fmtDur, fmtTime, skudCall, type SkudClip, type SkudVisit } from '@/lib/skudApi';

const MARK: Record<string, { label: string; icon: string; cls: string }> = {
  entry: { label: 'ключ', icon: 'KeyRound', cls: 'text-emerald-600' },
  exit: { label: 'ключ на выход', icon: 'KeyRound', cls: 'text-sky-600' },
  exit_button: { label: 'кнопка', icon: 'CircleDot', cls: 'text-sky-600' },
  remote_open: { label: 'с сайта', icon: 'Globe', cls: 'text-violet-600' },
  forced: { label: 'взлом', icon: 'TriangleAlert', cls: 'text-red-600' },
  held_open: { label: 'не закрыта', icon: 'DoorOpen', cls: 'text-amber-600' },
};

function ClipPlayer({ clip }: { clip: SkudClip }) {
  if (clip.status === 'done' && clip.url) {
    return <video src={clip.url} controls preload="metadata" playsInline className="aspect-video w-full rounded-lg bg-black" />;
  }
  const failed = clip.status === 'failed' || clip.status === 'missing' || clip.status === 'deleted';
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg bg-secondary px-4 text-center text-xs text-muted-foreground">
      <Icon name={failed ? 'VideoOff' : 'Loader2'} size={20} className={failed ? '' : 'animate-spin'} />
      {failed ? (clip.error || 'Видео не сохранилось') : 'Видео сохраняется…'}
    </div>
  );
}

const span = (c: SkudClip) => `${fmtTime(c.from)} – ${fmtTime(c.to)}`;

export default function VisitCard({ visit, onRetry }: { visit: SkudVisit; onRetry: () => void }) {
  const [open, setOpen] = useState(false);
  const people = Array.from(new Set(visit.openings.flatMap((o) => o.marks.filter((m) => m.name).map((m) => m.name as string))));
  const doorClips = visit.clips.filter((c) => c.mode === 'door');
  const insideClips = visit.clips.filter((c) => c.mode === 'inside');
  const ready = visit.clips.filter((c) => c.status === 'done').length;
  const failed = visit.clips.some((c) => c.status === 'failed' || c.status === 'missing');
  const dur = visit.ended_at ? fmtDur(new Date(visit.ended_at).getTime() - new Date(visit.started_at).getTime()) : null;
  const buttons = visit.openings.flatMap((o) => o.marks).filter((m) => m.kind === 'exit_button').length;

  const retry = async () => { await skudCall({ action: 'clip_retry', visit_id: visit.id }); onRetry(); };

  return (
    <div className={`rounded-2xl border bg-card ${visit.alarm ? 'border-red-500/40' : ''}`}>
      <button onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 p-4 text-left">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${visit.status === 'open' ? 'bg-emerald-500/10 text-emerald-600' : visit.alarm ? 'bg-red-500/10 text-red-600' : 'bg-secondary text-muted-foreground'}`}>
          <Icon name={visit.status === 'open' ? 'DoorOpen' : visit.alarm ? 'ShieldAlert' : 'DoorClosed'} size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {fmtDate(visit.started_at)}, {fmtTime(visit.started_at).slice(0, 5)}
            {visit.ended_at ? ` – ${fmtTime(visit.ended_at).slice(0, 5)}` : ''}
            {visit.status === 'open' && <span className="ml-2 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-700">сейчас на складе: {visit.inside}</span>}
          </div>
          <div className="truncate text-sm text-muted-foreground">
            {people.length ? people.join(', ') : 'Без карты'}
            {buttons > 0 && ` · выходов кнопкой: ${buttons}`}
            {dur && ` · ${dur}`}
          </div>
          {visit.note && <div className="mt-0.5 text-xs text-amber-700">{visit.note}</div>}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {visit.clips.length > 0 && (
            <span className="flex items-center gap-1"><Icon name="Video" size={14} />{ready}/{visit.clips.length}</span>
          )}
          <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={18} />
        </div>
      </button>

      {open && (
        <div className="space-y-4 border-t p-4">
          <div className="space-y-3">
            {visit.openings.map((o, i) => {
              const clips = doorClips.filter((c) => c.opening_id === o.id);
              return (
                <div key={o.id} className="grid gap-3 md:grid-cols-[220px_1fr]">
                  <div className="text-sm">
                    <div className="font-medium">Открытие {i + 1}</div>
                    <div className="text-muted-foreground">
                      {fmtTime(o.opened_at)}{o.closed_at ? ` – ${fmtTime(o.closed_at)}` : ' – открыта'}
                      {o.assumed && o.closed_at && <span title="Датчика двери нет — время закрытия по таймеру замка"> (по замку)</span>}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {o.marks.map((m, k) => {
                        const st = MARK[m.kind] || { label: m.kind, icon: 'Info', cls: 'text-muted-foreground' };
                        return (
                          <div key={k} className={`text-xs ${st.cls}`}>
                            <div className="flex items-center gap-1.5">
                              <Icon name={st.icon} fallback="Circle" size={12} />
                              {fmtTime(m.t)} · {m.kind === 'exit_button' ? 'выход по кнопке' : st.label}{m.name ? ` · ${m.name}` : ''}
                            </div>
                            {m.kind === 'exit_button' && m.inside && (
                              <div className="ml-[18px] text-muted-foreground">
                                {m.inside.length ? `На складе были: ${m.inside.join(', ')}` : 'По картам на складе никого не было'}
                                {m.count != null && m.count > m.inside.length ? ` (по счёту ${m.count} чел.)` : ''}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {clips.length ? clips.map((c) => (
                      <div key={c.id}>
                        <ClipPlayer clip={c} />
                        <div className="mt-1 text-xs text-muted-foreground">{c.camera} · {span(c)}</div>
                      </div>
                    )) : <p className="text-xs text-muted-foreground">Видео этого открытия — в соседнем отрывке</p>}
                  </div>
                </div>
              );
            })}
          </div>

          {insideClips.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-medium">Внутри склада — всё посещение</div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {insideClips.map((c) => (
                  <div key={c.id}>
                    <ClipPlayer clip={c} />
                    <div className="mt-1 text-xs text-muted-foreground">{c.camera} · {span(c)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {failed && (
            <button onClick={retry} className="flex items-center gap-1.5 text-sm text-primary hover:underline">
              <Icon name="RotateCcw" size={14} />Попробовать сохранить видео ещё раз
            </button>
          )}
        </div>
      )}
    </div>
  );
}
