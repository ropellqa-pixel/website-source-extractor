import { Plus, Trash2 } from 'lucide-react';
import type { FieldDef } from '@/lib/access';

export interface GridRow {
  id?: string;
  profile_id: string;
  extra?: Record<string, number | string> | null;
  [k: string]: unknown;
}

export interface Computed { rate: number; total: number; week: number }

interface Props {
  title: React.ReactNode;
  accent: 'emerald' | 'indigo';
  fields: FieldDef[];
  rows: GridRow[];
  computed: Computed[];
  rate: number;
  showAll: boolean;
  shortKeys: string[];
  canEdit: boolean;
  canManageRows: boolean;
  profileName: (id: string) => string;
  onCell: (row: GridRow, field: FieldDef, value: number | string) => void;
  onDelete: (row: GridRow) => void;
  addOptions: { id: string; name: string }[];
  newProfileId: string;
  setNewProfileId: (v: string) => void;
  onAdd: () => void;
  addLabel: string;
  emptyText: string;
}

const fmt = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function cellValue(row: GridRow, f: FieldDef): number | string {
  if (f.builtin) return Number(row[f.key] || 0);
  const v = (row.extra || {})[f.key];
  return f.kind === 'text' ? String(v ?? '') : Number(v || 0);
}

export default function SalaryGrid(p: Props) {
  const cols = p.fields.filter((f) => f.visible && (p.showAll || p.shortKeys.includes(f.key)));
  const ring = p.accent === 'emerald' ? 'focus:ring-emerald-500' : 'focus:ring-indigo-500';
  const sum = (f: FieldDef) => p.rows.reduce((s, r) => s + (f.kind === 'text' ? 0 : Number(cellValue(r, f)) || 0), 0);
  const totals = p.computed.reduce((a, c) => ({ total: a.total + c.total, week: a.week + c.week }), { total: 0, week: 0 });

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden mb-6">
      {p.title}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary">
              <th className="text-center px-4 py-3 text-xs font-semibold text-foreground/80 min-w-[160px]">СОТРУДНИК</th>
              {cols.slice(0, 1).map((f) => <th key={f.key} className="text-center px-3 py-3 text-xs font-semibold text-foreground/80 min-w-[90px]">{f.label}</th>)}
              <th className={`text-center px-3 py-3 text-xs font-semibold min-w-[90px] ${p.accent === 'emerald' ? 'text-emerald-700' : 'text-indigo-700'}`}>₽/ЧАС</th>
              {cols.slice(1).map((f) => (
                <th key={f.key} className={`text-center px-3 py-3 text-xs font-semibold min-w-[90px] ${f.key === 'underpayment' ? 'text-orange-700' : 'text-foreground/80'}`}>{f.label}</th>
              ))}
              <th className="text-center px-4 py-3 text-xs font-semibold text-emerald-800 min-w-[110px]">ИТОГ</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-amber-700 min-w-[90px]">НЕДЕЛЯ</th>
              {p.canManageRows && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {p.rows.map((row, idx) => {
              const c = p.computed[idx] || { rate: 0, total: 0, week: 0 };
              const renderCell = (f: FieldDef) => {
                const v = cellValue(row, f);
                return (
                  <td key={f.key} className="px-3 py-2.5 text-center">
                    {p.canEdit ? (
                      <input type={f.kind === 'text' ? 'text' : 'number'} value={f.kind === 'text' ? String(v) : (Number(v) || '')}
                        onChange={(e) => p.onCell(row, f, f.kind === 'text' ? e.target.value : Number(e.target.value))}
                        className={`${f.kind === 'text' ? 'w-28' : 'w-20'} bg-secondary border ${f.key === 'underpayment' ? 'border-orange-600/50 text-orange-700' : 'border-border text-foreground'} rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 ${ring}`} />
                    ) : (
                      <span className={`text-sm ${f.key === 'underpayment' ? 'text-orange-700' : 'text-foreground'}`}>
                        {f.kind === 'text' ? String(v) : ['hours_worked', 'osn_hours', 'dop_hours'].includes(f.key) ? (Number(v) || 0) : fmt(Number(v) || 0)}
                      </span>
                    )}
                  </td>
                );
              };
              return (
                <tr key={row.id || idx} className="border-t border-border bg-card/60">
                  <td className="px-4 py-2.5 text-center"><span className="text-sm text-foreground font-semibold">{p.profileName(row.profile_id)}</span></td>
                  {cols.slice(0, 1).map(renderCell)}
                  <td className="px-3 py-2.5 text-center"><span className={`text-sm font-bold ${p.accent === 'emerald' ? 'text-emerald-600' : 'text-indigo-600'}`}>{fmt(c.rate)}</span></td>
                  {cols.slice(1).map(renderCell)}
                  <td className="px-4 py-2.5 text-center"><span className={`text-sm font-bold ${c.total >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmt(c.total)}</span></td>
                  <td className="px-4 py-2.5 text-center"><span className="text-sm text-amber-600 font-medium">{fmt(c.week)}</span></td>
                  {p.canManageRows && (
                    <td className="px-2 py-2.5 text-center">
                      <button onClick={() => p.onDelete(row)} className="p-1 text-red-600/60 hover:text-red-600 hover:bg-red-500/10 rounded transition-all" title="Удалить">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {p.canManageRows && (
              <tr className="border-t border-border bg-secondary">
                <td className="px-4 py-2.5">
                  <select value={p.newProfileId} onChange={(e) => p.setNewProfileId(e.target.value)}
                    className={`w-full bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 ${ring}`}>
                    <option value="">— Выберите сотрудника —</option>
                    {p.addOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </td>
                <td colSpan={cols.length + 3} className="px-4 py-2.5">
                  <button onClick={p.onAdd} disabled={!p.newProfileId}
                    className={`w-full ${p.accent === 'emerald' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'} disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded-lg transition-all flex items-center justify-center gap-2`}>
                    <Plus className="w-4 h-4" /> {p.addLabel}
                  </button>
                </td>
                <td />
              </tr>
            )}
            {p.rows.length > 0 && (
              <tr className={`border-t-2 ${p.accent === 'emerald' ? 'border-emerald-500/40' : 'border-indigo-500/40'} bg-secondary font-bold`}>
                <td className="px-4 py-3 text-center text-base text-foreground">ИТОГО</td>
                {cols.slice(0, 1).map((f) => <td key={f.key} className="px-3 py-3 text-center text-base text-foreground">{f.kind === 'text' ? '' : Math.round(sum(f) * 100) / 100}</td>)}
                <td className="px-3 py-3 text-center text-sm">{fmt(p.rate)}</td>
                {cols.slice(1).map((f) => (
                  <td key={f.key} className="px-3 py-3 text-center text-sm text-muted-foreground">
                    {f.kind === 'text' ? '' : ['osn_hours', 'dop_hours', 'hours_worked'].includes(f.key) ? sum(f) : fmt(sum(f))}
                  </td>
                ))}
                <td className="px-4 py-3 text-center text-base text-emerald-700">{fmt(totals.total)}</td>
                <td className="px-4 py-3 text-center text-base text-amber-600">{fmt(totals.week)}</td>
                {p.canManageRows && <td />}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {p.rows.length === 0 && <div className="text-center py-10 text-sm text-muted-foreground">{p.emptyText}</div>}
    </div>
  );
}
