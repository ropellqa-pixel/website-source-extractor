import { useState, useEffect } from 'react';
import { db } from '@/lib/sdk';
import EmployeeVariableSettings from './EmployeeVariableSettings';
import EmployeePermanentSettings from './EmployeePermanentSettings';
import EmployeePreferencesAndExclude from './EmployeePreferencesAndExclude';

interface EmployeeConfig {
  id: string;
  profile_id: string;
  month_year: string;
  no_day: boolean;
  no_night: boolean;
  break_days: number;
  priority: number;
  assignment: string;
  delay: string;
  unavailable: string;
  preferences: string;
  excluded: boolean;
  st_no_day?: boolean;
  st_no_night?: boolean;
  ml_no_day?: boolean;
  ml_no_night?: boolean;
  perm_delays: string;
  perm_unavailable: string;
}

interface EmployeeProfile {
  id: string;
  full_name: string;
  email: string;
  role: string;
  status: string;
}

interface AllEmployee {
  id: string;
  full_name: string;
}

interface EmployeeSettingsModalProps {
  employee: EmployeeProfile;
  monthYear: string;
  allEmployees: AllEmployee[];
  onClose: () => void;
  onSave: () => void;
  onNext: () => void;
  nextEmployee?: EmployeeProfile | null;
  isExcluded?: boolean;
}

export default function EmployeeSettingsModal({
  employee,
  monthYear,
  allEmployees,
  onClose,
  onSave,
  onNext,
  nextEmployee,
  isExcluded: initialExcluded,
}: EmployeeSettingsModalProps) {
  const [config, setConfig] = useState<EmployeeConfig>({
    id: '',
    profile_id: employee.id,
    month_year: monthYear,
    no_day: false,
    no_night: false,
    break_days: 0,
    priority: 3,
    assignment: 'ЛБ',
    delay: '',
    unavailable: '',
    preferences: '',
    excluded: initialExcluded || false,
    st_no_day: false,
    st_no_night: false,
    ml_no_day: false,
    ml_no_night: false,
    perm_delays: '',
    perm_unavailable: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [showPrefList, setShowPrefList] = useState(false);
  const [showExcludeConfirm, setShowExcludeConfirm] = useState(false);

  useEffect(() => {
    loadConfig();
  }, [employee.id, monthYear]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const { data: permanent } = await db.from('schedule_config')
        .select('*')
        .eq('profile_id', employee.id)
        .limit(1);

      const { data: variable } = await db.from('employee_schedule_settings')
        .select('*')
        .eq('profile_id', employee.id)
        .eq('month_year', monthYear)
        .limit(1);

      const p = permanent && permanent.length > 0 ? permanent[0] : null;
      const v = variable && variable.length > 0 ? variable[0] : null;

      setConfig(prev => ({
        ...prev,
        id: p?.id || '',
        no_day: p?.no_day || false,
        no_night: p?.no_night || false,
        break_days: p?.break_days ?? 0,
        priority: p?.priority ?? 3,
        assignment: p?.status || 'ЛБ',
        delay: (v?.delay as string) || '',
        unavailable: (v?.unavailable as string) || '',
        preferences: (p?.preferences as string) || '',
        excluded: (p?.excluded as boolean) || false,
        st_no_day: p?.st_no_day || false,
        st_no_night: p?.st_no_night || false,
        ml_no_day: p?.ml_no_day || false,
        ml_no_night: p?.ml_no_night || false,
        perm_delays: (p?.delays as string) || '',
        perm_unavailable: (p?.unavailable as string) || '',
      }));
    } catch (err) {
      console.error('Load config error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const permanentPayload = {
        profile_id: employee.id,
        no_day: config.no_day,
        no_night: config.no_night,
        break_days: config.break_days,
        priority: config.priority,
        status: config.assignment,
        preferences: config.preferences,
        excluded: config.excluded,
        st_no_day: config.st_no_day,
        st_no_night: config.st_no_night,
        ml_no_day: config.ml_no_day,
        ml_no_night: config.ml_no_night,
        delays: config.perm_delays,
        unavailable: config.perm_unavailable,
      };

      const { data: existing } = await db.from('schedule_config')
        .select('id')
        .eq('profile_id', employee.id)
        .limit(1);

      if (existing && existing.length > 0) {
        await db.from('schedule_config')
          .update(permanentPayload)
          .eq('id', existing[0].id);
      } else {
        await db.from('schedule_config')
          .insert(permanentPayload);
      }

      const variablePayload = {
        profile_id: employee.id,
        month_year: monthYear,
        delay: config.delay,
        unavailable: config.unavailable,
      };

      const { data: existingVar } = await db.from('employee_schedule_settings')
        .select('id')
        .eq('profile_id', employee.id)
        .eq('month_year', monthYear)
        .limit(1);

      if (existingVar && existingVar.length > 0) {
        await db.from('employee_schedule_settings')
          .update(variablePayload)
          .eq('id', existingVar[0].id);
      } else {
        await db.from('employee_schedule_settings')
          .insert(variablePayload);
      }

      setShowSaveSuccess(true);
      setTimeout(() => setShowSaveSuccess(false), 2000);
      onSave();
    } catch (err) {
      console.error('Save config error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleExcluded = async () => {
    setSaving(true);
    try {
      const newExcluded = !config.excluded;
      const { data: existing } = await db.from('schedule_config')
        .select('id')
        .eq('profile_id', employee.id)
        .limit(1);

      if (existing && existing.length > 0) {
        await db.from('schedule_config')
          .update({ excluded: newExcluded })
          .eq('id', existing[0].id);
      } else {
        await db.from('schedule_config')
          .insert({ profile_id: employee.id, excluded: newExcluded });
      }

      setConfig(prev => ({ ...prev, excluded: newExcluded }));
      setShowExcludeConfirm(false);
      setShowSaveSuccess(true);
      setTimeout(() => setShowSaveSuccess(false), 2000);
      onSave();
    } catch (err) {
      console.error('Toggle excluded error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleNext = async () => {
    await handleSave();
    onNext();
  };

  const togglePreference = (profileId: string) => {
    const current = config.preferences ? config.preferences.split(',').filter(Boolean) : [];
    const idx = current.indexOf(profileId);
    let updated: string[];
    if (idx >= 0) {
      updated = current.filter(id => id !== profileId);
    } else {
      updated = [...current, profileId];
    }
    setConfig({ ...config, preferences: updated.join(',') });
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-[200]">
        <div className="bg-card rounded-2xl p-8 w-full max-w-md border border-border text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground text-sm">Загрузка настроек...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-[200] p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-2xl border border-border max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-xl font-bold text-foreground">Настройки сотрудника</h2>
            <p className="text-sm text-muted-foreground mt-1">ФИО: <span className="font-medium text-foreground">{employee.full_name}</span></p>
            {config.excluded && (
              <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-red-500/20 text-red-600 text-xs rounded-full">
                Исключён из табеля
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-2 rounded-lg hover:bg-secondary">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4">
          <EmployeeVariableSettings
            monthYear={monthYear}
            delay={config.delay}
            unavailable={config.unavailable}
            onChangeDelay={value => setConfig({ ...config, delay: value })}
            onChangeUnavailable={value => setConfig({ ...config, unavailable: value })}
          />

          <EmployeePermanentSettings
            noDay={config.no_day}
            noNight={config.no_night}
            breakDays={config.break_days}
            priority={config.priority}
            assignment={config.assignment}
            stNoDay={config.st_no_day}
            stNoNight={config.st_no_night}
            mlNoDay={config.ml_no_day}
            mlNoNight={config.ml_no_night}
            permDelays={config.perm_delays}
            permUnavailable={config.perm_unavailable}
            onChangeNoDay={value => setConfig({ ...config, no_day: value })}
            onChangeNoNight={value => setConfig({ ...config, no_night: value })}
            onChangeBreakDays={value => setConfig({ ...config, break_days: value })}
            onChangePriority={value => setConfig({ ...config, priority: value })}
            onChangeAssignment={value => setConfig({ ...config, assignment: value })}
            onChangeStNoDay={value => setConfig({ ...config, st_no_day: value })}
            onChangeStNoNight={value => setConfig({ ...config, st_no_night: value })}
            onChangeMlNoDay={value => setConfig({ ...config, ml_no_day: value })}
            onChangeMlNoNight={value => setConfig({ ...config, ml_no_night: value })}
            onChangePermDelays={value => setConfig({ ...config, perm_delays: value })}
            onChangePermUnavailable={value => setConfig({ ...config, perm_unavailable: value })}
          >
            <EmployeePreferencesAndExclude
              employeeId={employee.id}
              preferences={config.preferences}
              allEmployees={allEmployees}
              showPrefList={showPrefList}
              onToggleShowPrefList={() => setShowPrefList(!showPrefList)}
              onTogglePreference={togglePreference}
              excluded={config.excluded}
              showExcludeConfirm={showExcludeConfirm}
              saving={saving}
              onShowExcludeConfirm={() => setShowExcludeConfirm(true)}
              onCancelExcludeConfirm={() => setShowExcludeConfirm(false)}
              onToggleExcluded={handleToggleExcluded}
            />
          </EmployeePermanentSettings>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center gap-2">
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Сохранение...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Сохранить
                </>
              )}
            </button>
            {showSaveSuccess && (
              <span className="text-emerald-600 text-sm font-medium">✓ Сохранено</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {nextEmployee && (
              <button onClick={handleNext} disabled={saving} className="px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-all flex items-center gap-2">
                Далее
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
            <button onClick={onClose} className="px-4 py-2.5 bg-secondary text-foreground rounded-lg font-medium hover:bg-border transition-all">
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}