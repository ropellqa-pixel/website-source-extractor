interface AllEmployee {
  id: string;
  full_name: string;
}

interface EmployeePreferencesAndExcludeProps {
  employeeId: string;
  preferences: string;
  allEmployees: AllEmployee[];
  showPrefList: boolean;
  onToggleShowPrefList: () => void;
  onTogglePreference: (profileId: string) => void;
  excluded: boolean;
  showExcludeConfirm: boolean;
  saving: boolean;
  onShowExcludeConfirm: () => void;
  onCancelExcludeConfirm: () => void;
  onToggleExcluded: () => void;
}

export default function EmployeePreferencesAndExclude({
  employeeId,
  preferences,
  allEmployees,
  showPrefList,
  onToggleShowPrefList,
  onTogglePreference,
  excluded,
  showExcludeConfirm,
  saving,
  onShowExcludeConfirm,
  onCancelExcludeConfirm,
  onToggleExcluded,
}: EmployeePreferencesAndExcludeProps) {
  const preferenceIds = preferences ? preferences.split(',').filter(Boolean) : [];
  const otherEmployees = allEmployees.filter(e => e.id !== employeeId);

  return (
    <>
      {/* Предпочтение */}
      <div className="bg-card rounded-lg p-3">
        <label className="block text-sm font-medium text-foreground mb-2">Ограничение по напарнику (строго только с этими людьми)</label>
        <p className="text-xs text-muted-foreground mb-2">Это не предпочтение, а жёсткое условие: в смену этот сотрудник ставится ТОЛЬКО вместе с одним из выбранных (Д+Дп или Н+Нп — одна смена). Если ни один из них не работает в этот день — сотрудник не ставится вовсе.</p>
        <button
          type="button"
          onClick={onToggleShowPrefList}
          className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground text-left flex items-center justify-between hover:bg-secondary transition-all"
        >
          <span>
            {preferenceIds.length === 0
              ? 'Выбрать сотрудников...'
              : `${preferenceIds.length} выбр.`
            }
          </span>
          <svg className={`w-4 h-4 text-muted-foreground transition-transform ${showPrefList ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {preferenceIds.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {preferenceIds.map(pid => {
              const emp = allEmployees.find(e => e.id === pid);
              return emp ? (
                <span key={pid} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/20 text-blue-700 text-xs rounded-full">
                  {emp.full_name}
                  <button type="button" onClick={() => onTogglePreference(pid)} className="hover:text-foreground">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ) : null;
            })}
          </div>
        )}

        {showPrefList && (
          <div className="mt-2 bg-background border border-border rounded-lg max-h-48 overflow-y-auto">
            {otherEmployees.map(emp => {
              const isSelected = preferenceIds.includes(emp.id);
              return (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => onTogglePreference(emp.id)}
                  className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-secondary transition-all ${isSelected ? 'text-blue-700 bg-blue-500/10' : 'text-foreground/80'}`}
                >
                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-blue-500 border-blue-500' : 'border-border'}`}>
                    {isSelected && (
                      <svg className="w-3 h-3 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  {emp.full_name}
                </button>
              );
            })}
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-2">
          Правило: Д + Дп = одна смена, Н + Нп = одна смена. Если у А указан Б — они либо работают в один день вместе, либо не работают вовсе.
        </p>
      </div>

      {/* Удаление / Восстановление */}
      <div className={`rounded-lg p-3 border ${excluded ? 'bg-red-500/10 border-red-500/30' : 'bg-card border-border'}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">
              {excluded ? 'Сотрудник исключён из табеля' : 'Удаление из табеля'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {excluded
                ? 'Не участвует в генерации расписания. Можно вернуть.'
                : 'Сотрудник не будет участвовать в расписании'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => excluded ? onToggleExcluded() : onShowExcludeConfirm()}
            disabled={saving}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
              excluded
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-red-600 text-white hover:bg-red-700'
            } disabled:opacity-50`}
          >
            {excluded ? 'Вернуть в табель' : 'Удалить'}
          </button>
        </div>

        {showExcludeConfirm && (
          <div className="mt-3 p-3 bg-red-500/10 rounded-lg border border-red-500/20">
            <p className="text-sm text-red-700 mb-3">Вы уверены? Сотрудник исключён не будет из таблицы настроек, но исчезнет из расписания.</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onToggleExcluded}
                disabled={saving}
                className="px-4 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                Да, исключить
              </button>
              <button
                type="button"
                onClick={onCancelExcludeConfirm}
                className="px-4 py-1.5 bg-muted text-foreground rounded-lg text-sm font-medium hover:bg-border"
              >
                Отмена
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
