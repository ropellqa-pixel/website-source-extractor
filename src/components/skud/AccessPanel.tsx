import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { daysLabel, skudCall, WEEKDAYS, type SkudCard, type SkudController, type SkudOutput, type SkudSchedule } from '@/lib/skudApi';
import { ALARM_KINDS } from '@/lib/skudApi';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  controller: SkudController | null;
  schedules: SkudSchedule[];
  notify: { alarms_to_employees: boolean; kinds?: string[] };
  onSchedules: (s: SkudSchedule[], cards: SkudCard[]) => void;
  onControllers: (c: SkudController[]) => void;
  onNotify: (n: { alarms_to_employees: boolean; kinds?: string[] }) => void;
}

const EMPTY_S = { id: 0, name: '', days: 31, from: '08:00', to: '20:00' };

export default function AccessPanel({ open, onOpenChange, controller, schedules, notify, onSchedules, onControllers, onNotify }: Props) {
  const [sch, setSch] = useState<typeof EMPTY_S | null>(null);
  const [outs, setOuts] = useState<SkudOutput[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const call = async (action: string, extra: Record<string, unknown>) => {
    setBusy(action);
    const r = await skudCall<{ schedules?: SkudSchedule[]; cards?: SkudCard[]; controllers?: SkudController[]; notify?: { alarms_to_employees: boolean; kinds?: string[] } }>({ action, ...extra });
    setBusy(null);
    if (r.error) { alert(r.error); return null; }
    if (r.schedules && r.cards) onSchedules(r.schedules, r.cards);
    if (r.controllers) onControllers(r.controllers);
    if (r.notify) onNotify(r.notify);
    return r;
  };

  const saveSch = async () => {
    if (!sch) return;
    if (await call('schedule_save', { ...sch, id: sch.id || undefined })) setSch(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>Доступ и тревоги</DialogTitle></DialogHeader>
        <div className="space-y-5">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Расписания доступа <span className="font-normal text-muted-foreground">({schedules.length} из 7)</span></h3>
              {schedules.length < 7 && !sch && <Button size="sm" variant="outline" onClick={() => setSch({ ...EMPTY_S })}><Icon name="Plus" size={14} />Расписание</Button>}
            </div>
            <p className="text-xs text-muted-foreground">Назначьте расписание карте (Ключ-карты → карандаш). В другое время дверь по этой карте не откроется.</p>
            {sch && (
              <div className="space-y-3 rounded-xl border p-3">
                <Input placeholder="Название, например «Дневная смена»" value={sch.name} onChange={(e) => setSch({ ...sch, name: e.target.value })} />
                <div className="flex flex-wrap gap-1">
                  {WEEKDAYS.map((d, i) => (
                    <button key={d} onClick={() => setSch({ ...sch, days: sch.days ^ (1 << i) })}
                      className={`h-9 w-10 rounded-md text-sm ${sch.days & (1 << i) ? 'bg-primary text-primary-foreground' : 'border hover:bg-secondary'}`}>{d}</button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">с</span>
                  <Input type="time" value={sch.from} onChange={(e) => setSch({ ...sch, from: e.target.value })} className="w-32" />
                  <span className="text-sm text-muted-foreground">до</span>
                  <Input type="time" value={sch.to} onChange={(e) => setSch({ ...sch, to: e.target.value })} className="w-32" />
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setSch(null)}>Отмена</Button>
                  <Button size="sm" onClick={saveSch} disabled={!!busy}>Сохранить</Button>
                </div>
              </div>
            )}
            <div className="divide-y rounded-xl border">
              {schedules.length === 0 && <p className="p-3 text-sm text-muted-foreground">Расписаний нет — все карты работают круглосуточно.</p>}
              {schedules.map((s) => (
                <div key={s.id} className="flex items-center gap-2 p-3 text-sm">
                  <Icon name="CalendarClock" size={16} className="text-muted-foreground" />
                  <div className="min-w-0 flex-1"><b>{s.name}</b> · {daysLabel(s.days)} · {s.from}–{s.to}</div>
                  <button onClick={() => setSch({ id: s.id, name: s.name, days: s.days, from: s.from, to: s.to })} className="rounded p-1.5 hover:bg-secondary"><Icon name="Pencil" size={14} /></button>
                  <button onClick={() => confirm(`Удалить расписание «${s.name}»? Карты с ним станут круглосуточными.`) && call('schedule_delete', { id: s.id })}
                    className="rounded p-1.5 text-destructive hover:bg-destructive/10"><Icon name="Trash2" size={14} /></button>
                </div>
              ))}
            </div>
          </section>

          {controller && (
            <section className="flex items-start justify-between gap-3 rounded-xl border p-3">
              <div>
                <h3 className="text-sm font-semibold">Запрет повторного прохода</h3>
                <p className="text-xs text-muted-foreground">По одной карте нельзя войти дважды, не выйдя. Нужен считыватель и на выход.</p>
              </div>
              <button onClick={() => call('antipassback', { id: controller.id, on: !controller.antipassback })} disabled={!!busy}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${controller.antipassback ? 'bg-primary' : 'bg-muted'}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${controller.antipassback ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </section>
          )}

          {controller && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Дополнительные выходы контроллера</h3>
                <Button size="sm" variant="ghost" onClick={() => setOuts(outs ? null : controller.outputs.map((o) => ({ ...o })))}>
                  <Icon name={outs ? 'X' : 'Pencil'} size={14} />{outs ? 'Отмена' : 'Названия'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Сирена, свет и другое, что электрик подключил к выходам контроллера. Реле 1 — замок двери.</p>
              <div className="divide-y rounded-xl border">
                {(outs || controller.outputs).map((o, i) => (
                  <div key={o.addr} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                    {outs ? (
                      <Input value={o.name} onChange={(e) => setOuts(outs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className="h-9 flex-1" />
                    ) : (
                      <span className="min-w-0 flex-1 font-medium">{o.name}</span>
                    )}
                    {!outs && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-8" disabled={!!busy} onClick={() => call('output', { id: controller.id, addr: o.addr, mode: 'pulse', seconds: 10 })}>10 сек</Button>
                        <Button size="sm" variant="outline" className="h-8" disabled={!!busy} onClick={() => call('output', { id: controller.id, addr: o.addr, mode: 'on' })}>Вкл</Button>
                        <Button size="sm" variant="outline" className="h-8" disabled={!!busy} onClick={() => call('output', { id: controller.id, addr: o.addr, mode: 'off' })}>Выкл</Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {outs && <Button size="sm" className="w-full" onClick={async () => { if (await call('outputs_save', { id: controller.id, outputs: outs })) setOuts(null); }}>Сохранить названия</Button>}
            </section>
          )}

          <section className="space-y-2 rounded-xl border p-3">
            <h3 className="text-sm font-semibold">Уведомления в ВК о тревогах</h3>
            <p className="text-xs text-muted-foreground">Сразу всему отделу «Руководство» (а также директору, заместителю и старшим сотрудникам). Отметьте, о чём сообщать:</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {Object.entries(ALARM_KINDS).map(([k, l]) => {
                const on = (notify.kinds || []).includes(k);
                return (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={on} disabled={!!busy}
                      onChange={() => call('notify_save', { kinds: on ? (notify.kinds || []).filter((x) => x !== k) : [...(notify.kinds || []), k] })} />
                    {l}
                  </label>
                );
              })}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={notify.alarms_to_employees} disabled={!!busy}
                onChange={(e) => call('notify_save', { alarms_to_employees: e.target.checked })} />
              Присылать тревоги и простым сотрудникам
            </label>
            <p className="text-xs text-muted-foreground">Сообщения получают те, кто привязал ВК в настройках профиля.</p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
