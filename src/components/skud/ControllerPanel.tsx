import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { skudCall, type PcDevice, type SkudController } from '@/lib/skudApi';
import GateCheck from './GateCheck';
import TimingPanel from './TimingPanel';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  controller: SkudController | null;
  cameras: { id: string; name: string }[];
  onChanged: (list: SkudController[]) => void;
}

export default function ControllerPanel({ open, onOpenChange, controller, cameras, onChanged }: Props) {
  const warehouse = cameras.find((c) => /склад/i.test(c.name));
  const [name, setName] = useState(controller?.name || 'Склад');
  const [cameraId, setCameraId] = useState(controller?.camera_id || warehouse?.id || '');
  const [secs, setSecs] = useState(String(controller?.open_seconds || 3));
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const insideDefault = cameras.find((c) => /склад-?\s*вн/i.test(c.name));
  const [insideId, setInsideId] = useState(controller?.inside_camera_id || insideDefault?.id || '');
  const [pre, setPre] = useState(String(controller?.pre_seconds ?? 10));
  const [post, setPost] = useState(String(controller?.post_seconds ?? 10));
  const [pc, setPc] = useState(controller?.recorder_device || '');
  const [quality, setQuality] = useState(controller?.recorder_quality || 'sd');
  const [devices, setDevices] = useState<PcDevice[]>([]);
  const [gateHost, setGateHost] = useState(controller?.gate_host || '');
  const [gatePort, setGatePort] = useState(String(controller?.gate_port || 5000));
  const [gateAddr, setGateAddr] = useState(String(controller?.gate_address || 1));
  const [acting, setActing] = useState<string | null>(null);

  const act = async (action: string, extra: Record<string, unknown> = {}, confirmText?: string) => {
    if (!controller || (confirmText && !confirm(confirmText))) return;
    setActing(action);
    const r = await skudCall<{ controllers: SkudController[] }>({ action, id: controller.id, ...extra });
    setActing(null);
    if (r.error) { alert(r.error); return; }
    onChanged(r.controllers);
  };

  useEffect(() => {
    skudCall<{ devices: PcDevice[] }>({ action: 'devices' }).then((r) => { if (!r.error) setDevices(r.devices); });
  }, []);

  const save = async () => {
    setBusy(true);
    const r = await skudCall<{ controllers: SkudController[] }>({
      action: 'controller_save', id: controller?.id, name, camera_id: cameraId, open_seconds: controller ? Math.max(1, Math.round((controller.timing?.relay_tenths || controller.open_seconds * 10) / 10)) : Number(secs) || 3,
      inside_camera_id: insideId, pre_seconds: Number(pre), post_seconds: Number(post), recorder_device: pc, recorder_quality: quality,
      gate_host: gateHost.trim(), gate_port: Number(gatePort) || 5000, gate_address: Number(gateAddr) || 1,
    });
    setBusy(false);
    if (r.error) { alert(r.error); return; }
    onChanged(r.controllers); onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Контроллер двери</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Название двери</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Камера у двери</label>
            <select value={cameraId} onChange={(e) => setCameraId(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
              <option value="">— без камеры —</option>
              {cameras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Камера внутри склада</label>
            <select value={insideId} onChange={(e) => setInsideId(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
              <option value="">— нет (появится «Склад-ВН» — подключится сама) —</option>
              {cameras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">Пишет всё посещение без перерывов — пока все не выйдут.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {!controller && (
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-medium">Замок открыт, сек</label>
                <Input type="number" min={1} max={25} value={secs} onChange={(e) => setSecs(e.target.value)} />
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-xs font-medium">Видео до открытия, сек</label>
              <Input type="number" min={0} max={120} value={pre} onChange={(e) => setPre(e.target.value)} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium">Видео после закрытия, сек</label>
              <Input type="number" min={0} max={120} value={post} onChange={(e) => setPost(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Компьютер склада (видео и связь с контроллером)</label>
            <select value={pc} onChange={(e) => setPc(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
              <option value="">— не выбран (видео не сохраняется) —</option>
              {devices.map((d) => <option key={d.code} value={d.code}>{d.name || 'Без сотрудника'} · {d.host || d.code}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Программа АБИЗ 3.9+ на этом ПК пишет камеры склада и связывается с контроллером двери по локальной сети. ПК должен быть включён.
            </p>
            {controller?.recorder_device && (
              <p className={`mt-1 text-xs ${controller.recorder_online ? 'text-emerald-600' : 'text-amber-600'}`}>
                {controller.recorder_online ? `На связи: ${controller.recorder_status || 'работает'}` : 'Компьютер сейчас не на связи'}
              </p>
            )}
          </div>
          <div className="space-y-3 rounded-xl border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Связь с контроллером</span>
              {controller && (
                <span className={`flex items-center gap-1.5 text-xs ${controller.gate_online && controller.online ? 'text-emerald-600' : 'text-amber-600'}`}>
                  <span className={`h-2 w-2 rounded-full ${controller.gate_online && controller.online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  {controller.online ? 'на связи' : controller.gate_online ? 'ПК на связи, контроллер нет' : 'нет связи'}
                </span>
              )}
            </div>
            {controller?.gate_status && <p className="break-words text-xs text-muted-foreground">{controller.gate_status}</p>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_90px_90px]">
              <div>
                <label className="mb-1 block text-xs font-medium">IP-адрес контроллера</label>
                <Input placeholder="найдётся сам" value={gateHost} onChange={(e) => setGateHost(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Порт</label>
                <Input inputMode="numeric" value={gatePort} onChange={(e) => setGatePort(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Номер</label>
                <Input inputMode="numeric" value={gateAddr} onChange={(e) => setGateAddr(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Если IP не указан, программа сама найдёт контроллер в сети склада. Номер контроллера с завода — 1.</p>
            {/^192\.168\.\d+\.1$/.test(gateHost.trim()) && (
              <p className="text-xs text-amber-600">Похоже, это адрес роутера, а не контроллера. Проверьте IP или оставьте поле пустым.</p>
            )}
            {controller && <GateCheck controller={controller} />}
            {controller && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={!!acting} onClick={() => act('sync_clock')}>
                  <Icon name="Clock" size={14} />{acting === 'sync_clock' ? 'Отправляю…' : 'Сверить часы'}
                </Button>
                <Button size="sm" variant="outline" disabled={!!acting} onClick={() => act('sync_cards')}>
                  <Icon name="RefreshCw" size={14} />Перезаписать карты
                </Button>
                <Button size="sm" variant={controller.emergency_open ? 'default' : 'outline'} disabled={!!acting}
                  className={controller.emergency_open ? 'bg-red-600 hover:bg-red-700' : 'text-red-600'}
                  onClick={() => controller.emergency_open
                    ? act('emergency', { on: false })
                    : act('emergency', { on: true }, 'Аварийное открытие: дверь будет открыта постоянно, пока вы его не выключите. Включить?')}>
                  <Icon name="Siren" fallback="TriangleAlert" size={14} />{controller.emergency_open ? 'Выключить аварийное открытие' : 'Аварийное открытие'}
                </Button>
              </div>
            )}
          </div>
          {controller && <TimingPanel controller={controller} onChanged={onChanged} />}
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">Качество видео</span>
            {(['sd', 'hd'] as const).map((q) => (
              <button key={q} onClick={() => setQuality(q)}
                className={`rounded-md px-3 py-1 ${quality === q ? 'bg-primary text-primary-foreground' : 'border hover:bg-secondary'}`}>
                {q === 'sd' ? 'Обычное' : 'Высокое'}
              </button>
            ))}
          </div>
          {controller && (
            <div className="space-y-1.5 rounded-xl bg-secondary/60 p-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Модель</span><span>{controller.model || 'Gate-4000-Ethernet'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Серийный номер</span><span>{controller.serial || '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Прошивка</span><span>{controller.fw || '—'}</span></div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Ключ подключения</span>
                <button onClick={() => setShowKey(!showKey)} className="font-mono text-xs text-primary">{showKey ? controller.key : 'показать'}</button>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button onClick={save} disabled={busy}><Icon name="Save" size={15} />{busy ? 'Сохраняю…' : 'Сохранить'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
