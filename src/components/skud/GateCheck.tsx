import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { skudCall, type SkudController } from '@/lib/skudApi';

type StepState = 'wait' | 'run' | 'ok' | 'fail';
interface Step { title: string; state: StepState; note?: string }
interface CheckResp { command: { id: number; sent: boolean; done: boolean; result: string | null }; controller: SkudController | null }

const TIMEOUT = 60;

function steps(c: SkudController | null, cmd: CheckResp['command'] | null, elapsed: number, finished: boolean): Step[] {
  const pcOk = !!c?.recorder_online;
  const bridgeOk = !!c?.gate_online;
  const ctrlOk = !!cmd?.done && !!cmd.result?.startsWith('ok');
  const ctrlFail = !!cmd?.done && !ctrlOk;
  const timeUp = elapsed >= TIMEOUT || finished;
  const pc: Step = !c?.recorder_device
    ? { title: 'ПК склада на связи', state: 'fail', note: 'В поле «Компьютер склада» не выбран ПК — выберите и сохраните' }
    : pcOk || bridgeOk
      ? { title: 'ПК склада на связи', state: 'ok', note: c.recorder_host || c.recorder_device }
      : { title: 'ПК склада на связи', state: timeUp ? 'fail' : 'run', note: timeUp ? 'ПК выключен или программа АБИЗ на нём не запущена' : 'жду ответа от ПК…' };
  const bridge: Step = bridgeOk
    ? { title: 'Программа АБИЗ связывается с контроллером', state: 'ok', note: c?.gate_status || undefined }
    : { title: 'Программа АБИЗ связывается с контроллером', state: pc.state === 'fail' ? 'wait' : timeUp ? 'fail' : 'run',
      note: pc.state === 'ok' && timeUp ? 'На ПК старая версия АБИЗ без связи с контроллером — установите 4.1 или новее' : undefined };
  const found: Step = ctrlOk || (c?.online && !cmd?.done)
    ? { title: 'Контроллер найден', state: 'ok', note: c?.gate_host ? `${c.gate_host}:${c.gate_port}` : undefined }
    : ctrlFail
      ? { title: 'Контроллер найден', state: 'fail', note: cmd?.result || undefined }
      : { title: 'Контроллер найден', state: bridge.state !== 'ok' ? 'wait' : timeUp ? 'fail' : 'run',
        note: bridge.state === 'ok' ? (timeUp ? (c?.gate_status || 'Контроллер не отвечает — проверьте IP, кабель и питание') : `ищу ${c?.gate_host || 'в сети склада'}…`) : undefined };
  const info: Step = ctrlOk
    ? { title: 'Модель и прошивка', state: 'ok', note: cmd?.result?.replace(/^ok:\s*/, '') || `${c?.model || ''} ${c?.fw || ''}` }
    : { title: 'Модель и прошивка', state: found.state === 'ok' ? (timeUp ? 'fail' : 'run') : 'wait',
      note: found.state === 'ok' && timeUp ? 'Контроллер не ответил на запрос версии' : undefined };
  return [pc, bridge, found, info];
}

const ICONS: Record<StepState, { name: string; cls: string }> = {
  ok: { name: 'CircleCheck', cls: 'text-emerald-600' },
  fail: { name: 'CircleX', cls: 'text-red-600' },
  run: { name: 'Loader2', cls: 'animate-spin text-primary' },
  wait: { name: 'Circle', cls: 'text-muted-foreground/50' },
};

export default function GateCheck({ controller, onChanged }: { controller: SkudController; onChanged?: (c: SkudController) => void }) {
  const [data, setData] = useState<CheckResp | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<number | null>(null);

  const stop = () => { if (timer.current) window.clearInterval(timer.current); timer.current = null; setRunning(false); };
  useEffect(() => stop, []);

  const start = async () => {
    stop(); setError(''); setElapsed(0); setData(null); setRunning(true);
    const r = await skudCall<CheckResp>({ action: 'gate_check', id: controller.id });
    if (r.error) { setError(r.error); setRunning(false); return; }
    setData(r);
    const began = Date.now();
    timer.current = window.setInterval(async () => {
      const sec = Math.round((Date.now() - began) / 1000);
      setElapsed(sec);
      const p = await skudCall<CheckResp>({ action: 'gate_check_poll', id: controller.id, command_id: r.command.id });
      if (p.error) return;
      setData(p);
      if (p.controller) onChanged?.(p.controller);
      if (p.command.done || sec >= TIMEOUT) stop();
    }, 3000);
  };

  const list = data ? steps(data.controller, data.command, elapsed, !running && !!data) : [];

  return (
    <div className="space-y-2">
      <Button size="sm" variant="outline" onClick={start} disabled={running}>
        <Icon name="Activity" size={14} />{running ? `Проверяю… ${elapsed} с` : 'Проверить связь'}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {data && (
        <ol className="space-y-1.5 rounded-lg border bg-background p-3">
          {list.map((s, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <Icon name={ICONS[s.state].name} size={16} className={`mt-0.5 shrink-0 ${ICONS[s.state].cls}`} />
              <div className="min-w-0">
                <div className={s.state === 'wait' ? 'text-muted-foreground' : ''}>{i + 1}. {s.title}</div>
                {s.note && <div className="break-words text-xs text-muted-foreground">{s.note}</div>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
