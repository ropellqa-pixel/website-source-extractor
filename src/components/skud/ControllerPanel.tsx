import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { skudCall, type SkudController } from '@/lib/skudApi';

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

  const save = async () => {
    setBusy(true);
    const r = await skudCall<{ controllers: SkudController[] }>({
      action: 'controller_save', id: controller?.id, name, camera_id: cameraId, open_seconds: Number(secs) || 3,
    });
    setBusy(false);
    if (r.error) { alert(r.error); return; }
    onChanged(r.controllers); onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Контроллер двери</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Название двери</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Камера для видео в журнале</label>
            <select value={cameraId} onChange={(e) => setCameraId(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
              <option value="">— без камеры —</option>
              {cameras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Сколько секунд держать дверь открытой</label>
            <Input type="number" min={1} max={30} value={secs} onChange={(e) => setSecs(e.target.value)} className="w-28" />
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
