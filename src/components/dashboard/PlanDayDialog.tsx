import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PRESETS, SWATCHES, PlanEvent, formatDayLong, textColorFor } from './planApi';

const CUSTOM = '__custom__';

interface Props {
  date: string | null;
  plans: PlanEvent[];
  onClose: () => void;
  onCreate: (data: { status: string; color: string; note: string }) => Promise<void>;
  onUpdate: (id: string, data: { status: string; color: string; note: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export default function PlanDayDialog({ date, plans, onClose, onCreate, onUpdate, onDelete }: Props) {
  const [preset, setPreset] = useState<string>(PRESETS[0].status);
  const [customStatus, setCustomStatus] = useState('');
  const [customColor, setCustomColor] = useState(SWATCHES[4]);
  const [note, setNote] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const reset = () => {
    setPreset(PRESETS[0].status);
    setCustomStatus('');
    setCustomColor(SWATCHES[4]);
    setNote('');
    setEditingId(null);
    setError('');
  };

  useEffect(() => {
    reset();
  }, [date]);

  const isCustom = preset === CUSTOM;
  const presetObj = PRESETS.find(p => p.status === preset);
  const status = isCustom ? customStatus.trim() : presetObj?.status || '';
  const color = isCustom ? customColor : presetObj?.color || SWATCHES[0];
  const canSave = !!note.trim() && !!status && !saving;

  const startEdit = (p: PlanEvent) => {
    setEditingId(p.id);
    setNote(p.note || '');
    const match = PRESETS.find(x => x.status === p.status && x.color.toLowerCase() === (p.color || '').toLowerCase());
    if (match) {
      setPreset(match.status);
    } else {
      setPreset(CUSTOM);
      setCustomStatus(p.status || '');
      setCustomColor(p.color || SWATCHES[4]);
    }
    setError('');
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const payload = { status, color, note: note.trim() };
      if (editingId) await onUpdate(editingId, payload);
      else await onCreate(payload);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    setError('');
    try {
      await onDelete(id);
      if (editingId === id) reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Dialog open={!!date} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{date ? formatDayLong(date) : ''}</DialogTitle>
          <DialogDescription>Планы компании на этот день</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {plans.length === 0 && <p className="text-sm text-muted-foreground">Планов пока нет</p>}
          {plans.map(p => (
            <div
              key={p.id}
              className={`flex items-start gap-3 rounded-xl border p-3 ${editingId === p.id ? 'border-primary' : 'border-border'}`}
            >
              <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: p.color }} />
              <div className="min-w-0 flex-1">
                <span
                  className="inline-block rounded-md px-2 py-0.5 text-xs font-medium"
                  style={{ background: p.color, color: textColorFor(p.color) }}
                >
                  {p.status}
                </span>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{p.note}</p>
                {p.created_by_name && <p className="mt-1 text-xs text-muted-foreground">{p.created_by_name}</p>}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(p)} title="Редактировать">
                  <Icon name="Pencil" size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => remove(p.id)}
                  disabled={deletingId === p.id}
                  title="Удалить"
                >
                  <Icon name={deletingId === p.id ? 'Loader2' : 'Trash2'} size={15} className={deletingId === p.id ? 'animate-spin' : ''} />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-2 space-y-3 border-t border-border pt-4">
          <p className="text-sm font-medium">{editingId ? 'Редактирование плана' : 'Новый план'}</p>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Статус</label>
            <Select value={preset} onValueChange={setPreset}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map(p => (
                  <SelectItem key={p.status} value={p.status}>
                    <span className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ background: p.color }} />
                      {p.status}
                    </span>
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM}>
                  <span className="flex items-center gap-2">
                    <Icon name="Palette" size={13} />
                    Свой статус
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isCustom && (
            <div className="space-y-2">
              <Input value={customStatus} onChange={e => setCustomStatus(e.target.value)} placeholder="Название статуса" maxLength={60} />
              <div className="flex flex-wrap items-center gap-2">
                {SWATCHES.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCustomColor(c)}
                    className={`h-7 w-7 rounded-full border transition-transform hover:scale-110 ${customColor.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background' : 'border-border'}`}
                    style={{ background: c }}
                    aria-label={c}
                  />
                ))}
                <input
                  type="color"
                  value={customColor}
                  onChange={e => setCustomColor(e.target.value)}
                  className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent p-0"
                  title="Свой цвет"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">
              Пояснение <span className="text-destructive">*</span>
            </label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Что запланировано" rows={3} />
          </div>

          {status && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              Предпросмотр:
              <span className="rounded-md px-2 py-0.5 font-medium" style={{ background: color, color: textColorFor(color) }}>
                {status}
              </span>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            {editingId && (
              <Button variant="outline" onClick={reset}>
                Отмена
              </Button>
            )}
            <Button onClick={save} disabled={!canSave}>
              {saving && <Icon name="Loader2" size={15} className="mr-2 animate-spin" />}
              {editingId ? 'Сохранить' : 'Добавить'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
