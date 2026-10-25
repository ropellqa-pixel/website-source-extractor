import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { InvItem, invCall } from '@/lib/inventoryApi';

export default function ItemForm({ item, categories, onClose, onDone }: {
  item: Partial<InvItem> | null; categories: Record<string, string>; onClose: () => void; onDone: (msg: string) => void;
}) {
  const isNew = !item?.id;
  const [f, setF] = useState({
    name: item?.name || '', category: item?.category || 'dishes', unit: item?.unit || 'шт', price: String(item?.price ?? ''),
    location: item?.location || '', note: item?.note || '', qty: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(x => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    setError(''); setBusy(true);
    const r = await invCall<{ code: string; doc?: { number: string } }>({ action: 'item_save', id: item?.id, ...f });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    onDone(isNew ? `Предмет поставлен на учёт под номером ${r.code}${r.doc ? `, приход ${r.doc.number}` : ''}` : 'Карточка сохранена');
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{isNew ? 'Новый предмет' : `Карточка ${item?.code}`}</DialogTitle></DialogHeader>
        {isNew && <p className="-mt-2 text-xs text-muted-foreground">Инвентарный номер (2 буквы и 4 цифры) присвоится автоматически.</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground sm:col-span-2">Название
            <Input value={f.name} onChange={set('name')} placeholder="Тарелка глубокая 23 см, кофемашина…" className="h-9" autoFocus />
          </label>
          <label className="text-xs text-muted-foreground">Группа
            <select value={f.category} onChange={set('category')} className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground">
              {Object.entries(categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">Ед. измерения
            <Input value={f.unit} onChange={set('unit')} className="h-9" />
          </label>
          <label className="text-xs text-muted-foreground">Цена за единицу, ₽
            <Input value={f.price} onChange={set('price')} inputMode="decimal" className="h-9" />
          </label>
          {isNew && (
            <label className="text-xs text-muted-foreground">Количество на учёт
              <Input value={f.qty} onChange={set('qty')} inputMode="decimal" placeholder="0" className="h-9" />
            </label>
          )}
          <label className="text-xs text-muted-foreground sm:col-span-2">Место хранения
            <Input value={f.location} onChange={set('location')} placeholder="Кухня, бар, склад №1…" className="h-9" />
          </label>
          <label className="text-xs text-muted-foreground sm:col-span-2">Заметка
            <Input value={f.note} onChange={set('note')} placeholder="Серийный номер, поставщик…" className="h-9" />
          </label>
        </div>
        {!isNew && <p className="text-xs text-muted-foreground">Количество меняется только документами: приход, списание, пересчёт.</p>}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button onClick={save} disabled={busy}>
          {busy ? <Icon name="Loader2" size={16} className="animate-spin" /> : <Icon name="Save" size={16} />}
          {isNew ? 'Поставить на учёт' : 'Сохранить'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
