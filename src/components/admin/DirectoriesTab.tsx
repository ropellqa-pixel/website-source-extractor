import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { adminCall } from '@/lib/access';
import type { AdminData, Category, Counterparty } from './types';

const CP_KINDS: Record<string, string> = { supplier: 'Поставщик', customer: 'Покупатель', landlord: 'Арендодатель', other: 'Прочее' };

export default function DirectoriesTab({ data, onChanged }: { data: AdminData; onChanged: () => void }) {
  const [newCat, setNewCat] = useState<{ kind: 'income' | 'expense'; name: string }>({ kind: 'expense', name: '' });
  const [cp, setCp] = useState<Partial<Counterparty> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveCat = async (c: Partial<Category>) => {
    const r = await adminCall({ action: 'category_save', ...c });
    if (r.error) { setError(r.error); return; }
    setError(null); onChanged();
  };

  const saveCp = async () => {
    if (!cp) return;
    const r = await adminCall({ action: 'counterparty_save', ...cp });
    if (r.error) { setError(r.error); return; }
    setError(null); setCp(null); onChanged();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <h3 className="font-medium">Статьи доходов и расходов</h3>
        <div className="flex gap-2">
          <select value={newCat.kind} onChange={(e) => setNewCat({ ...newCat, kind: e.target.value as 'income' | 'expense' })} className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="expense">Расход</option><option value="income">Доход</option>
          </select>
          <Input value={newCat.name} placeholder="Новая статья" onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} className="h-9" />
          <Button size="sm" disabled={!newCat.name.trim()} onClick={async () => { await saveCat(newCat); setNewCat({ ...newCat, name: '' }); }}>Добавить</Button>
        </div>
        {(['income', 'expense'] as const).map((k) => (
          <div key={k} className="rounded-2xl border bg-card">
            <div className="border-b px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">{k === 'income' ? 'Доходы' : 'Расходы'}</div>
            {data.categories.filter((c) => c.kind === k).map((c) => (
              <div key={c.id} className={`flex items-center gap-2 border-b px-4 py-1.5 last:border-0 ${c.archived ? 'opacity-50' : ''}`}>
                <input defaultValue={c.name} onBlur={(e) => e.target.value.trim() !== c.name && saveCat({ ...c, name: e.target.value })}
                  className="flex-1 bg-transparent py-1 text-sm outline-none focus:underline" />
                <button onClick={() => saveCat({ ...c, archived: !c.archived })} className="text-xs text-muted-foreground hover:text-foreground">
                  {c.archived ? 'вернуть' : 'в архив'}
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Контрагенты</h3>
          <Button size="sm" onClick={() => setCp({ kind: 'supplier', name: '' })}><Icon name="Plus" size={15} />Контрагент</Button>
        </div>
        <div className="rounded-2xl border bg-card">
          {data.counterparties.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Пока нет</p>}
          {data.counterparties.map((c) => (
            <button key={c.id} onClick={() => setCp(c)} className={`flex w-full items-center justify-between border-b px-4 py-2.5 text-left last:border-0 hover:bg-secondary/50 ${c.archived ? 'opacity-50' : ''}`}>
              <div>
                <div className="text-sm font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">{CP_KINDS[c.kind]}{c.inn ? ` · ИНН ${c.inn}` : ''}{c.phone ? ` · ${c.phone}` : ''}</div>
              </div>
              <Icon name="ChevronRight" size={16} className="text-muted-foreground" />
            </button>
          ))}
        </div>
        {cp && (
          <div className="space-y-2 rounded-2xl border bg-card p-4">
            <Input placeholder="Название" value={cp.name || ''} onChange={(e) => setCp({ ...cp, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <select value={cp.kind} onChange={(e) => setCp({ ...cp, kind: e.target.value })} className="h-10 rounded-md border bg-background px-2 text-sm">
                {Object.entries(CP_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <Input placeholder="ИНН" value={cp.inn || ''} onChange={(e) => setCp({ ...cp, inn: e.target.value })} />
            </div>
            <Input placeholder="Телефон" value={cp.phone || ''} onChange={(e) => setCp({ ...cp, phone: e.target.value })} />
            <Input placeholder="Комментарий" value={cp.comment || ''} onChange={(e) => setCp({ ...cp, comment: e.target.value })} />
            {cp.id && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!cp.archived} onChange={(e) => setCp({ ...cp, archived: e.target.checked })} />В архиве</label>
            )}
            <div className="flex gap-2">
              <Button onClick={saveCp}>Сохранить</Button>
              <Button variant="ghost" onClick={() => setCp(null)}>Отмена</Button>
            </div>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
