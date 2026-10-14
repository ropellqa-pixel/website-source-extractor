import { useCallback, useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import Icon from '@/components/ui/icon';
import { ROLE_LABELS } from '@/lib/navigation';
import type { UserRole } from '@/lib/auth';
import { accCall, type Section } from '@/lib/accountingApi';

interface Person { id: string; name: string; role: UserRole; department: string; entries: boolean; profit: boolean; salary: boolean }
interface LogRow { user: string; action: string; details: string; time: string }

const COLS: [Section, string][] = [['entries', 'Доходы и расходы'], ['profit', 'Прибыль'], ['salary', 'Зарплата']];

export default function AccessTab() {
  const [people, setPeople] = useState<Person[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await accCall<{ people: Person[]; log: LogRow[] }>({ action: 'access_list' });
    if (r.error) setError(r.error); else { setPeople(r.people); setLog(r.log); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (p: Person, s: Section, v: boolean) => {
    const next = { ...p, [s]: v };
    setPeople((list) => list.map((x) => (x.id === p.id ? next : x)));
    const r = await accCall({ action: 'access_save', profile_id: p.id, entries: next.entries, profit: next.profit, salary: next.salary });
    if (r.error) { setError(r.error); load(); } else { setError(null); load(); }
  };

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto">
      <div className="flex gap-3 rounded-2xl border bg-card p-4 text-sm">
        <Icon name="ShieldCheck" size={20} className="shrink-0 text-primary" />
        <div className="space-y-1">
          <p><b>Заместитель директора</b> — видит и изменяет всё, раздаёт доступ.</p>
          <p><b>Директор</b> — видит всё, но ничего не изменяет.</p>
          <p><b>Остальные</b> — только просмотр тех частей, которые вы включите ниже. По умолчанию раздел им не виден.</p>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-auto rounded-2xl border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-4 py-2.5 font-medium">Сотрудник</th>
              {COLS.map(([, l]) => <th key={l} className="px-4 py-2.5 text-center font-medium">{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const fixed = p.role === 'director' || p.role === 'deputy_director';
              return (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{p.name || 'Без имени'}</div>
                    <div className="text-xs text-muted-foreground">{ROLE_LABELS[p.role] || p.role}{p.department ? ` · ${p.department}` : ''}</div>
                  </td>
                  {COLS.map(([s]) => (
                    <td key={s} className="px-4 py-2.5 text-center">
                      {fixed ? (
                        <span className="text-xs text-muted-foreground">{p.role === 'deputy_director' ? 'изменяет' : 'просмотр'}</span>
                      ) : (
                        <Switch checked={p[s]} onCheckedChange={(v) => toggle(p, s, v)} />
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border bg-card p-4">
        <h3 className="mb-2 font-medium">Журнал изменений</h3>
        {log.length === 0 ? <p className="text-sm text-muted-foreground">Пока пусто</p> : (
          <div className="space-y-1.5 text-sm">
            {log.map((l, i) => (
              <div key={i} className="flex gap-3">
                <span className="w-32 shrink-0 tabular-nums text-muted-foreground">{new Date(l.time).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                <span className="w-40 shrink-0 truncate">{l.user}</span>
                <span><b className="font-medium">{l.action}</b> — {l.details}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
