import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import Icon from '@/components/ui/icon';
import { adminCall } from '@/lib/access';
import { ROLE_LABELS } from '@/lib/navigation';
import type { UserRole } from '@/lib/auth';
import type { AdminData, Position } from './types';

const EMPTY: Omit<Position, 'people'> & { people?: number } = { id: 0, name: '', sections: ['/dashboard'], actions: [] };

export default function PositionsTab({ data, onChanged }: { data: AdminData; onChanged: () => void }) {
  const [edit, setEdit] = useState<typeof EMPTY | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const g: Record<string, AdminData['actions']> = {};
    data.actions.forEach((a) => { (g[a.group] ||= []).push(a); });
    return g;
  }, [data.actions]);

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const save = async () => {
    if (!edit) return;
    setBusy(true); setError(null);
    const r = await adminCall({ action: 'position_save', ...edit, id: edit.id || undefined });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setEdit(null); onChanged();
  };

  const remove = async (p: Position) => {
    if (!confirm(`Удалить должность «${p.name}»? У ${p.people} сотрудников она снимется.`)) return;
    await adminCall({ action: 'position_delete', id: p.id });
    onChanged();
  };

  const assign = async (profileId: string, patch: { position_id?: number | null; role?: string }) => {
    const person = data.people.find((x) => x.id === profileId);
    const r = await adminCall({ action: 'person_save', profile_id: profileId, position_id: patch.position_id !== undefined ? patch.position_id : person?.position_id, role: patch.role || person?.role });
    if (r.error) alert(r.error);
    onChanged();
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Должности</h3>
          <Button size="sm" onClick={() => { setEdit({ ...EMPTY }); setError(null); }}><Icon name="Plus" size={15} />Должность</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Сотрудник с должностью видит только отмеченные разделы и может нажимать только отмеченные кнопки. Без должности действуют стандартные права по роли.
        </p>
        {data.positions.length === 0 && <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">Должностей пока нет</div>}
        {data.positions.map((p) => (
          <div key={p.id} className="rounded-2xl border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">Сотрудников: {p.people} · разделов: {p.sections.length} · кнопок: {p.actions.length}</div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => { setEdit({ ...p }); setError(null); }} className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"><Icon name="Pencil" size={15} /></button>
                <button onClick={() => remove(p)} className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-red-600"><Icon name="Trash2" size={15} /></button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {p.sections.map((s) => <span key={s} className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">{data.sections.find((x) => x.path === s)?.label || s}</span>)}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <h3 className="font-medium">Сотрудники</h3>
        <div className="overflow-auto rounded-2xl border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b"><th className="px-4 py-2.5 font-medium">Сотрудник</th><th className="px-4 py-2.5 font-medium">Роль</th><th className="px-4 py-2.5 font-medium">Должность</th></tr>
            </thead>
            <tbody>
              {data.people.filter((p) => p.active).map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="px-4 py-2">{p.name || 'Без имени'}</td>
                  <td className="px-4 py-2">
                    <select value={p.role} onChange={(e) => assign(p.id, { role: e.target.value })} className="h-8 rounded-md border bg-background px-2 text-sm">
                      {Object.entries(ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    {p.role === 'deputy_director' ? <span className="text-xs text-muted-foreground">полный доступ</span> : (
                      <select value={p.position_id || ''} onChange={(e) => assign(p.id, { position_id: e.target.value ? Number(e.target.value) : null })}
                        className="h-8 w-full rounded-md border bg-background px-2 text-sm">
                        <option value="">— по роли ({ROLE_LABELS[p.role as UserRole] || p.role}) —</option>
                        {data.positions.map((pos) => <option key={pos.id} value={pos.id}>{pos.name}</option>)}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEdit(null)}>
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{edit.id ? 'Должность' : 'Новая должность'}</h3>
              <button onClick={() => setEdit(null)} className="rounded p-1 hover:bg-secondary"><Icon name="X" size={18} /></button>
            </div>
            <Input placeholder="Название, например «Бухгалтер»" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <div className="mt-4 grid gap-5 md:grid-cols-[1fr_1.6fr]">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-medium">Разделы сайта</h4>
                  <button onClick={() => setEdit({ ...edit, sections: edit.sections.length === data.sections.length ? ['/dashboard'] : data.sections.map((s) => s.path) })} className="text-xs text-primary hover:underline">все / ничего</button>
                </div>
                <div className="space-y-1.5">
                  {data.sections.map((s) => (
                    <label key={s.path} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={edit.sections.includes(s.path)} disabled={s.path === '/dashboard'} onCheckedChange={() => setEdit({ ...edit, sections: toggle(edit.sections, s.path) })} />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="mb-2 text-sm font-medium">Кнопки и действия</h4>
                <div className="space-y-3">
                  {Object.entries(groups).map(([g, list]) => (
                    <div key={g}>
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g}</div>
                      <div className="space-y-1.5">
                        {list.map((a) => (
                          <label key={a.key} className="flex items-center gap-2 text-sm">
                            <Checkbox checked={edit.actions.includes(a.key)} onCheckedChange={() => setEdit({ ...edit, actions: toggle(edit.actions, a.key) })} />
                            {a.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <Button className="mt-4 w-full" onClick={save} disabled={busy}>{busy ? 'Сохраняю…' : 'Сохранить'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
