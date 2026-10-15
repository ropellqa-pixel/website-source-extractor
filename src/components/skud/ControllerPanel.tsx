import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { skudCall, type PcDevice, type SkudController } from '@/lib/skudApi';

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

  useEffect(() => {
    skudCall<{ devices: PcDevice[] }>({ action: 'devices' }).then((r) => { if (!r.error) setDevices(r.devices); });
  }, []);

  const save = async () => {
    setBusy(true);
    const r = await skudCall<{ controllers: SkudController[] }>({
      action: 'controller_save', id: controller?.id, name, camera_id: cameraId, open_seconds: Number(secs) || 3,
      inside_camera_id: insideId, pre_seconds: Number(pre), post_seconds: Number(post), recorder_device: pc, recorder_quality: quality,
    });
    setBusy(false);
    if (r.error) { alert(r.error); return; }
    onChanged(r.controllers); onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium">Замок открыт, сек</label>
              <Input type="number" min={1} max={30} value={secs} onChange={(e) => setSecs(e.target.value)} />
            </div>
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
            <label className="mb-1.5 block text-sm font-medium">Компьютер, который записывает видео</label>
            <select value={pc} onChange={(e) => setPc(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
              <option value="">— не выбран (видео не сохраняется) —</option>
              {devices.map((d) => <option key={d.code} value={d.code}>{d.name || 'Без сотрудника'} · {d.host || d.code}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Программа АБИЗ 3.7+ на этом ПК постоянно пишет камеры склада и хранит 3 часа, а отрывки посещений отправляет сюда. ПК должен быть включён.
            </p>
            {controller?.recorder_device && (
              <p className={`mt-1 text-xs ${controller.recorder_online ? 'text-emerald-600' : 'text-amber-600'}`}>
                {controller.recorder_online ? `На связи: ${controller.recorder_status || 'работает'}` : 'Компьютер сейчас не на связи'}
              </p>
            )}
          </div>
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
