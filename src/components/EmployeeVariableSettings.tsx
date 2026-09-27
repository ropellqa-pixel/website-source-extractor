interface EmployeeVariableSettingsProps {
  monthYear: string;
  delay: string;
  unavailable: string;
  onChangeDelay: (value: string) => void;
  onChangeUnavailable: (value: string) => void;
}

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

export default function EmployeeVariableSettings({
  monthYear,
  delay,
  unavailable,
  onChangeDelay,
  onChangeUnavailable,
}: EmployeeVariableSettingsProps) {
  const parseDelayDates = (): number[] => parseDateRangeString(delay);
  const parseUnavailDates = (): number[] => parseDateRangeString(unavailable);

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-amber-600 uppercase tracking-wider mb-3 flex items-center gap-2">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Переменные настройки
      </h3>
      <p className="text-xs text-muted-foreground mb-3">Действуют только в текущем месяце ({monthYear})</p>

      <div className="bg-secondary rounded-xl p-4 space-y-4">
        <div className="bg-card rounded-lg p-3">
          <label className="block text-sm font-medium text-foreground mb-2">Отсрочка (на месяц)</label>
          <input type="text" value={delay} onChange={e => onChangeDelay(e.target.value)} placeholder="1-5,7,10-15" className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          <p className="text-xs text-muted-foreground mt-1">Дни, когда сотрудник НЕ ставится в этом месяце</p>
          {delay.trim() && (
            <div className="flex flex-wrap gap-1 mt-2">
              {parseDelayDates().filter(d => d >= 1 && d <= 31).map(d => (
                <span key={d} className="px-1.5 py-0.5 bg-red-500/20 text-red-700 text-xs rounded">{d}</span>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card rounded-lg p-3">
          <label className="block text-sm font-medium text-foreground mb-2">Недоступен (на месяц)</label>
          <input type="text" value={unavailable} onChange={e => onChangeUnavailable(e.target.value)} placeholder="10-15,28-30" className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          <p className="text-xs text-muted-foreground mt-1">Дни, когда сотрудник полностью недоступен в этом месяце</p>
          {unavailable.trim() && (
            <div className="flex flex-wrap gap-1 mt-2">
              {parseUnavailDates().filter(d => d >= 1 && d <= 31).map(d => (
                <span key={d} className="px-1.5 py-0.5 bg-muted text-foreground/80 text-xs rounded">{d}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
