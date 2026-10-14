import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import Icon from '@/components/ui/icon';
import { adminCall, type FieldDef } from '@/lib/access';
import type { AdminData } from './types';

const FORMS: [string, string][] = [['salary', 'Зарплата — сотрудники'], ['manager', 'Зарплата — руководители'], ['collection', 'Инкассация']];
const KINDS: [FieldDef['kind'], string][] = [['accrual', 'Начисление (+)'], ['deduction', 'Удержание (−)'], ['number', 'Число'], ['text', 'Текст']];

export default function FieldsTab({ data, onChanged }: { data: AdminData; onChanged: () => void }) {
  const [form, setForm] = useState('salary');
  const [fields, setFields] = useState<FieldDef[]>(data.fields.salary);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setFields(data.fields[form] || []); setMsg(null); }, [form, data.fields]);

  const patch = (i: number, p: Partial<FieldDef>) => setFields(fields.map((f, j) => (j === i ? { ...f, ...p } : f)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= fields.length) return;
    const n = [...fields];
    [n[i], n[j]] = [n[j], n[i]];
    setFields(n);
  };

  const save = async () => {
    setBusy(true); setMsg(null);
    const r = await adminCall({ action: 'fields_save', form, fields });
    setBusy(false);
    if (r.error) { setMsg({ ok: false, text: r.error }); return; }
    setMsg({ ok: true, text: 'Сохранено' });
    onChanged();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 rounded-lg bg-secondary p-0.5 w-fit">
        {FORMS.map(([k, l]) => (
          <button key={k} onClick={() => setForm(k)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${form === k ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>{l}</button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Переименовывайте и скрывайте колонки, меняйте порядок, добавляйте свои. «Имя для формулы» используется во вкладке «Формулы».
        Скрытая колонка не показывается в таблице, но её значение остаётся в формулах.
      </p>
      <div className="overflow-auto rounded-2xl border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="w-16 px-3 py-2.5" />
              <th className="px-3 py-2.5 font-medium">Название колонки</th>
              <th className="px-3 py-2.5 font-medium">Имя для формулы</th>
              <th className="px-3 py-2.5 font-medium">Тип (для расчётного листка)</th>
              <th className="px-3 py-2.5 text-center font-medium">Показывать</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={f.key + i} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <div className="flex">
                    <button onClick={() => move(i, -1)} className="rounded p-1 text-muted-foreground hover:bg-secondary"><Icon name="ChevronUp" size={14} /></button>
                    <button onClick={() => move(i, 1)} className="rounded p-1 text-muted-foreground hover:bg-secondary"><Icon name="ChevronDown" size={14} /></button>
                  </div>
                </td>
                <td className="px-3 py-2"><Input value={f.label} onChange={(e) => patch(i, { label: e.target.value })} className="h-8" /></td>
                <td className="px-3 py-2">
                  {f.builtin ? <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">{f.var}</code> : (
                    <Input value={f.var} placeholder="bonus" onChange={(e) => patch(i, { var: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} className="h-8 font-mono" />
                  )}
                </td>
                <td className="px-3 py-2">
                  <select value={f.kind} onChange={(e) => patch(i, { kind: e.target.value as FieldDef['kind'] })} className="h-8 rounded-md border bg-background px-2 text-sm">
                    {KINDS.filter(([k]) => !f.builtin || k !== 'text').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-center"><Switch checked={f.visible} onCheckedChange={(v) => patch(i, { visible: v })} /></td>
                <td className="px-2 py-2">
                  {!f.builtin && <button onClick={() => setFields(fields.filter((_, j) => j !== i))} className="rounded p-1.5 text-muted-foreground hover:text-red-600"><Icon name="Trash2" size={14} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setFields([...fields, { key: '', var: '', label: '', visible: true, builtin: false, kind: form === 'collection' ? 'number' : 'accrual' }])}>
          <Icon name="Plus" size={15} />Своя колонка
        </Button>
        <Button onClick={save} disabled={busy}>{busy ? 'Сохраняю…' : 'Сохранить'}</Button>
        <Button variant="ghost" onClick={() => setFields(data.default_fields[form])}>Стандартные колонки</Button>
      </div>
    </div>
  );
}
