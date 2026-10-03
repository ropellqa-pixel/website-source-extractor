import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { camerasCall, type Camera } from '@/lib/camerasApi';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cameras: Camera[];
  onChanged: (list: Camera[]) => void;
}

const EMPTY = { id: '', name: '', serial: '', username: 'admin', password: '' };

export default function CameraManager({ open, onOpenChange, cameras, onChanged }: Props) {
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setForm(EMPTY); setEditing(false); setError(null); };

  const save = async () => {
    setBusy(true); setError(null);
    const r = await camerasCall<{ cameras?: Camera[] }>({ action: editing ? 'update' : 'add', ...form });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    if (r.cameras) onChanged(r.cameras);
    reset();
  };

  const run = async (body: Record<string, unknown>) => {
    const r = await camerasCall<{ cameras?: Camera[] }>(body);
    if (r.error) { setError(r.error); return; }
    if (r.cameras) onChanged(r.cameras);
  };

  const move = (idx: number, dir: -1 | 1) => {
    const ids = cameras.map((c) => c.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    onChanged(ids.map((id) => cameras.find((c) => c.id === id)!));
    run({ action: 'reorder', ids });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>Настройка камер</DialogTitle></DialogHeader>

        <div className="space-y-2">
          {cameras.length === 0 && <p className="text-sm text-muted-foreground">Камер пока нет — добавьте первую ниже.</p>}
          {cameras.map((c, i) => (
            <div key={c.id} className="flex items-center gap-2 rounded-xl border border-border p-2.5">
              <div className="flex flex-col">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-0.5 hover:bg-secondary disabled:opacity-30" aria-label="Выше">
                  <Icon name="ChevronUp" size={16} />
                </button>
                <button onClick={() => move(i, 1)} disabled={i === cameras.length - 1} className="rounded p-0.5 hover:bg-secondary disabled:opacity-30" aria-label="Ниже">
                  <Icon name="ChevronDown" size={16} />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  <span className="truncate">{c.name}</span>
                  {c.is_default && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">по умолчанию</span>}
                </div>
                <div className="truncate text-xs text-muted-foreground">{c.serial} · {c.username} · {c.network_mode}</div>
              </div>
              {!c.is_default && (
                <button onClick={() => run({ action: 'set_default', id: c.id })} title="Сделать камерой по умолчанию" className="rounded-lg p-2 hover:bg-secondary">
                  <Icon name="Star" size={16} />
                </button>
              )}
              <button
                onClick={() => { setForm({ id: c.id, name: c.name, serial: c.serial || '', username: c.username || '', password: '' }); setEditing(true); setError(null); }}
                title="Изменить" className="rounded-lg p-2 hover:bg-secondary"
              >
                <Icon name="Pencil" size={16} />
              </button>
              <button
                onClick={() => { if (confirm(`Удалить камеру «${c.name}»?`)) run({ action: 'delete', id: c.id }); }}
                title="Удалить" className="rounded-lg p-2 text-destructive hover:bg-destructive/10"
              >
                <Icon name="Trash2" size={16} />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-2 space-y-3 rounded-xl bg-secondary/50 p-4">
          <div className="font-medium">{editing ? 'Изменить камеру' : 'Добавить камеру'}</div>
          <Input placeholder="Название, например «Кухня»" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="Серийный номер" value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value.trim() })} />
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="Имя для входа" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <Input type="password" placeholder={editing ? 'Пароль (не менять)' : 'Пароль устройства'} value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Icon name="Cloud" size={14} /> Режим сети: RPS (через облако по серийному номеру)
          </div>
          {error && <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy || !form.name || !form.serial}>
              {busy ? <><Icon name="Loader2" size={16} className="mr-2 animate-spin" />Проверяю камеру...</> : editing ? 'Сохранить' : 'Добавить'}
            </Button>
            {editing && <Button variant="ghost" onClick={reset}>Отмена</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
