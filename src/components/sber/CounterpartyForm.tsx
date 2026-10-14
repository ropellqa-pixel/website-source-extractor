import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { sberCall, VAT_LABELS, type SberCp } from '@/lib/sberApi';

type Form = Partial<SberCp>;

export default function CounterpartyForm({ value, categories, onClose, onSaved }: {
  value: Form; categories: { id: number; name: string }[]; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState<Form>(value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Form) => setF({ ...f, ...p });

  const save = async () => {
    setBusy(true); setError(null);
    const r = await sberCall({ action: 'counterparty_save', ...f });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    onSaved();
  };

  const field = (label: string, key: keyof SberCp, ph = '', mono = false) => (
    <label className="space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input value={String(f[key] ?? '')} placeholder={ph} onChange={(e) => set({ [key]: e.target.value } as Form)} className={mono ? 'font-mono' : ''} />
    </label>
  );

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{f.id ? 'Реквизиты контрагента' : 'Новый контрагент'}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">{field('Получатель (как в банке)', 'name', 'ООО «Ромашка»')}</div>
          {field('ИНН', 'inn', '10 или 12 цифр', true)}
          {field('КПП', 'kpp', '9 цифр (для ООО)', true)}
          {field('Расчётный счёт', 'account', '20 цифр', true)}
          {field('БИК банка', 'bic', '9 цифр', true)}
          {field('Банк', 'bank_name', 'ПАО Сбербанк')}
          {field('Корр. счёт', 'corr_account', '20 цифр', true)}
          <div className="sm:col-span-2">{field('Назначение платежа по умолчанию', 'default_purpose', 'Оплата по договору № … за товар')}</div>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">НДС</span>
            <select value={f.vat_rate || 'none'} onChange={(e) => set({ vat_rate: e.target.value })} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
              {Object.entries(VAT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Статья расхода</span>
            <select value={f.default_category_id || ''} onChange={(e) => set({ default_category_id: e.target.value ? Number(e.target.value) : null })} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">— не выбрана —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {field('Телефон', 'phone')}
          {field('Комментарий', 'comment')}
          {f.id && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={!!f.archived} onChange={(e) => set({ archived: e.target.checked })} />В архиве (не показывать в заявках)
            </label>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Счёт проверяется по контрольному ключу ЦБ вместе с БИК, ИНН — по контрольной сумме. Каждое изменение реквизитов записывается в журнал, а заявки со старыми реквизитами оплатить нельзя.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Сохраняю…' : 'Сохранить'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
