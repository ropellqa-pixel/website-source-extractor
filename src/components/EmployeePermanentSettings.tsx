import EmployeeConfiguratorPicker from './schedule/EmployeeConfiguratorPicker';
import type { ConfiguratorRecord } from './schedule/configuratorCatalog';

const ASSIGNMENT_OPTIONS = [
  { value: 'СТ', label: 'СТ (Старший)' },
  { value: 'МЛ', label: 'МЛ (Младший)' },
  { value: 'ЛБ', label: 'ЛБ (Любой)' },
] as const;

const PRIORITY_OPTIONS = [
  { value: 1, label: '1 — Срочно' },
  { value: 2, label: '2 — Необходимо' },
  { value: 3, label: '3 — Размерено' },
  { value: 4, label: '4 — Меньше' },
  { value: 5, label: '5 — Редко' },
] as const;

function parseDateRangeString(value: string): number[] {
  if (!value || !value.trim()) return [];
  const result: number[] = [];
  const parts = value.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      if (!isNaN(a) && !isNaN(b)) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) result.push(i);
      }
    } else {
      const n = parseInt(part);
      if (!isNaN(n)) result.push(n);
    }
  }
  return result;
}

interface EmployeePermanentSettingsProps {
  noDay: boolean;
  noNight: boolean;
  breakDays: number;
  priority: number;
  assignment: string;
  stNoDay?: boolean;
  stNoNight?: boolean;
  mlNoDay?: boolean;
  mlNoNight?: boolean;
  permDelays: string;
  permUnavailable: string;
  onChangeNoDay: (value: boolean) => void;
  onChangeNoNight: (value: boolean) => void;
  onChangeBreakDays: (value: number) => void;
  onChangePriority: (value: number) => void;
  onChangeAssignment: (value: string) => void;
  onChangeStNoDay: (value: boolean) => void;
  onChangeStNoNight: (value: boolean) => void;
  onChangeMlNoDay: (value: boolean) => void;
  onChangeMlNoNight: (value: boolean) => void;
  onChangePermDelays: (value: string) => void;
  onChangePermUnavailable: (value: string) => void;
  configurators?: ConfiguratorRecord[];
  configuratorIds?: string[];
  onChangeConfiguratorIds?: (ids: string[]) => void;
  configuratorNames?: (id: string) => string;
  children?: React.ReactNode;
}

export default function EmployeePermanentSettings({
  noDay,
  noNight,
  breakDays,
  priority,
  assignment,
  stNoDay,
  stNoNight,
  mlNoDay,
  mlNoNight,
  permDelays,
  permUnavailable,
  onChangeNoDay,
  onChangeNoNight,
  onChangeBreakDays,
  onChangePriority,
  onChangeAssignment,
  onChangeStNoDay,
  onChangeStNoNight,
  onChangeMlNoDay,
  onChangeMlNoNight,
  onChangePermDelays,
  onChangePermUnavailable,
  configurators,
  configuratorIds,
  onChangeConfiguratorIds,
  configuratorNames,
  children,
}: EmployeePermanentSettingsProps) {
  const parsePermDelayDates = (): number[] => parseDateRangeString(permDelays);
  const parsePermUnavailDates = (): number[] => parseDateRangeString(permUnavailable);

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-emerald-600 uppercase tracking-wider mb-3 flex items-center gap-2">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Постоянные настройки
      </h3>
      <p className="text-xs text-muted-foreground mb-3">Действуют всегда и сохраняются на все месяцы</p>

      <div className="bg-secondary rounded-xl p-4 space-y-4">
        {/* Запреты */}
        <div className="grid grid-cols-2 gap-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={noDay} onChange={e => onChangeNoDay(e.target.checked)} className="w-5 h-5 rounded border-border text-blue-500 focus:ring-ring bg-secondary" />
            <div>
              <span className="text-sm font-medium text-foreground">Запрет дня</span>
              <p className="text-xs text-muted-foreground">Не ставить на дневные смены</p>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={noNight} onChange={e => onChangeNoNight(e.target.checked)} className="w-5 h-5 rounded border-border text-blue-500 focus:ring-ring bg-secondary" />
            <div>
              <span className="text-sm font-medium text-foreground">Запрет ночи</span>
              <p className="text-xs text-muted-foreground">Не ставить на ночные смены</p>
            </div>
          </label>
        </div>

        {/* Перерыв */}
        <div className="bg-card rounded-lg p-3">
          <label className="block text-sm font-medium text-foreground mb-2">Перерыв (дней)</label>
          <div className="flex items-center gap-3">
            <input type="number" min={0} max={7} value={breakDays} onChange={e => onChangeBreakDays(Number(e.target.value))} className="w-20 bg-secondary border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            <p className="text-xs text-muted-foreground">Минимальный перерыв между сменами (дни отдыха)</p>
          </div>
          <p className="text-xs text-muted-foreground mt-2">0 = каждый день; 1 = через день; 2 = 2 дня отдыха</p>
        </div>

        {/* Приоритет */}
        <div className="bg-card rounded-lg p-3">
          <label className="block text-sm font-medium text-foreground mb-2">Приоритет</label>
          <select value={priority} onChange={e => onChangePriority(Number(e.target.value))} className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
            {PRIORITY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Назначение */}
        <div className="bg-card rounded-lg p-3">
          <label className="block text-sm font-medium text-foreground mb-2">Назначение</label>
          <select value={assignment} onChange={e => onChangeAssignment(e.target.value)} className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring mb-3">
            {ASSIGNMENT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {assignment === 'ЛБ' && (
            <div className="bg-background rounded-lg p-3 space-y-3">
              <p className="text-xs text-muted-foreground mb-2">Настройки для конкретных типов смен:</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-card rounded-lg p-2">
                  <p className="text-xs font-medium text-foreground mb-2">СТ (Старший)</p>
                  <label className="flex items-center gap-2 text-xs text-foreground/80 mb-1">
                    <input type="checkbox" checked={stNoDay} onChange={e => onChangeStNoDay(e.target.checked)} className="rounded" />
                    Запрет дня
                  </label>
                  <label className="flex items-center gap-2 text-xs text-foreground/80">
                    <input type="checkbox" checked={stNoNight} onChange={e => onChangeStNoNight(e.target.checked)} className="rounded" />
                    Запрет ночи
                  </label>
                </div>
                <div className="bg-card rounded-lg p-2">
                  <p className="text-xs font-medium text-foreground mb-2">МЛ (Младший)</p>
                  <label className="flex items-center gap-2 text-xs text-foreground/80 mb-1">
                    <input type="checkbox" checked={mlNoDay} onChange={e => onChangeMlNoDay(e.target.checked)} className="rounded" />
                    Запрет дня
                  </label>
                  <label className="flex items-center gap-2 text-xs text-foreground/80">
                    <input type="checkbox" checked={mlNoNight} onChange={e => onChangeMlNoNight(e.target.checked)} className="rounded" />
                    Запрет ночи
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Постоянные дни задержки */}
        <div className="bg-card rounded-lg p-3">
          <label className="block text-sm font-medium text-foreground mb-2">Задержка (постоянная)</label>
          <input type="text" value={permDelays} onChange={e => onChangePermDelays(e.target.value)} placeholder="1-5,7,10-15" className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          <p className="text-xs text-muted-foreground mt-1">Дни, когда сотрудник НЕ ставится — каждый месяц</p>
          {permDelays.trim() && (
            <div className="flex flex-wrap gap-1 mt-2">
              {parsePermDelayDates().filter(d => d >= 1 && d <= 31).map(d => (
                <span key={d} className="px-1.5 py-0.5 bg-red-500/20 text-red-700 text-xs rounded">{d}</span>
              ))}
            </div>
          )}
        </div>

        {/* Постоянные недоступные дни */}
        <div className="bg-card rounded-lg p-3">
          <label className="block text-sm font-medium text-foreground mb-2">Недоступен (постоянно)</label>
          <input type="text" value={permUnavailable} onChange={e => onChangePermUnavailable(e.target.value)} placeholder="10-15,28-30" className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          <p className="text-xs text-muted-foreground mt-1">Дни, когда сотрудник полностью недоступен — каждый месяц</p>
          {permUnavailable.trim() && (
            <div className="flex flex-wrap gap-1 mt-2">
              {parsePermUnavailDates().filter(d => d >= 1 && d <= 31).map(d => (
                <span key={d} className="px-1.5 py-0.5 bg-muted text-foreground/80 text-xs rounded">{d}</span>
              ))}
            </div>
          )}
        </div>

        {onChangeConfiguratorIds && (
          <EmployeeConfiguratorPicker
            configurators={configurators || []}
            selectedIds={configuratorIds || []}
            onChange={onChangeConfiguratorIds}
            employeeName={configuratorNames}
          />
        )}

        {children}
      </div>
    </div>
  );
}