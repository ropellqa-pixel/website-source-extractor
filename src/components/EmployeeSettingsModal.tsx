import { useState, useEffect } from 'react';
import { db } from '@/lib/sdk';

const SHIFT_OPTIONS = ['Д', 'Н', 'Дп', 'Нп'] as const;

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

  const preferenceIds = config.preferences ? config.preferences.split(',').filter(Boolean) : [];
  const otherEmployees = allEmployees.filter(e => e.id !== employee.id);

  const parseDelayDates = (): number[] => {
    if (!config.delay || !config.delay.trim()) return [];
    const result: number[] = [];
    const parts = config.delay.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
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
  };

  const parseUnavailDates = (): number[] => {
    if (!config.unavailable || !config.unavailable.trim()) return [];
    const result: number[] = [];
    const parts = config.unavailable.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
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
  };

  const parsePermDelayDates = (): number[] => {
    if (!config.perm_delays || !config.perm_delays.trim()) return [];
    const result: number[] = [];
    const parts = config.perm_delays.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
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
  };

  const parsePermUnavailDates = (): number[] => {
    if (!config.perm_unavailable || !config.perm_unavailable.trim()) return [];
    const result: number[] = [];
    const parts = config.perm_unavailable.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
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
          {/* === ПЕРЕМЕННЫЕ НАСТРОЙКИ === */}
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
                <input type="text" value={config.delay} onChange={e => setConfig({...config, delay: e.target.value})} placeholder="1-5,7,10-15" className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                <p className="text-xs text-muted-foreground mt-1">Дни, когда сотрудник НЕ ставится в этом месяце</p>
                {config.delay.trim() && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {parseDelayDates().filter(d => d >= 1 && d <= 31).map(d => (
                      <span key={d} className="px-1.5 py-0.5 bg-red-500/20 text-red-700 text-xs rounded">{d}</span>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-card rounded-lg p-3">
                <label className="block text-sm font-medium text-foreground mb-2">Недоступен (на месяц)</label>
                <input type="text" value={config.unavailable} onChange={e => setConfig({...config, unavailable: e.target.value})} placeholder="10-15,28-30" className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                <p className="text-xs text-muted-foreground mt-1">Дни, когда сотрудник полностью недоступен в этом месяце</p>
                {config.unavailable.trim() && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {parseUnavailDates().filter(d => d >= 1 && d <= 31).map(d => (
                      <span key={d} className="px-1.5 py-0.5 bg-muted text-foreground/80 text-xs rounded">{d}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* === ПОСТОЯННЫЕ НАСТРОЙКИ === */}
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
                  <input type="checkbox" checked={config.no_day} onChange={e => setConfig({...config, no_day: e.target.checked})} className="w-5 h-5 rounded border-border text-blue-500 focus:ring-ring bg-secondary" />
                  <div>
                    <span className="text-sm font-medium text-foreground">Запрет дня</span>
                    <p className="text-xs text-muted-foreground">Не ставить на дневные смены</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={config.no_night} onChange={e => setConfig({...config, no_night: e.target.checked})} className="w-5 h-5 rounded border-border text-blue-500 focus:ring-ring bg-secondary" />
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
                  <input type="number" min={0} max={7} value={config.break_days} onChange={e => setConfig({...config, break_days: Number(e.target.value)})} className="w-20 bg-secondary border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                  <p className="text-xs text-muted-foreground">Минимальный перерыв между сменами (дни отдыха)</p>
                </div>
                <p className="text-xs text-muted-foreground mt-2">0 = каждый день; 1 = через день; 2 = 2 дня отдыха</p>
              </div>

              {/* Приоритет */}
              <div className="bg-card rounded-lg p-3">
                <label className="block text-sm font-medium text-foreground mb-2">Приоритет</label>
                <select value={config.priority} onChange={e => setConfig({...config, priority: Number(e.target.value)})} className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                  {PRIORITY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Назначение */}
              <div className="bg-card rounded-lg p-3">
                <label className="block text-sm font-medium text-foreground mb-2">Назначение</label>
                <select value={config.assignment} onChange={e => setConfig({...config, assignment: e.target.value})} className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring mb-3">
                  {ASSIGNMENT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>

                {config.assignment === 'ЛБ' && (
                  <div className="bg-background rounded-lg p-3 space-y-3">
                    <p className="text-xs text-muted-foreground mb-2">Настройки для конкретных типов смен:</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-card rounded-lg p-2">
                        <p className="text-xs font-medium text-foreground mb-2">СТ (Старший)</p>
                        <label className="flex items-center gap-2 text-xs text-foreground/80 mb-1">
                          <input type="checkbox" checked={config.st_no_day} onChange={e => setConfig({...config, st_no_day: e.target.checked})} className="rounded" />
                          Запрет дня
                        </label>
                        <label className="flex items-center gap-2 text-xs text-foreground/80">
                          <input type="checkbox" checked={config.st_no_night} onChange={e => setConfig({...config, st_no_night: e.target.checked})} className="rounded" />
                          Запрет ночи
                        </label>
                      </div>
                      <div className="bg-card rounded-lg p-2">
                        <p className="text-xs font-medium text-foreground mb-2">МЛ (Младший)</p>
                        <label className="flex items-center gap-2 text-xs text-foreground/80 mb-1">
                          <input type="checkbox" checked={config.ml_no_day} onChange={e => setConfig({...config, ml_no_day: e.target.checked})} className="rounded" />
                          Запрет дня
                        </label>
                        <label className="flex items-center gap-2 text-xs text-foreground/80">
                          <input type="checkbox" checked={config.ml_no_night} onChange={e => setConfig({...config, ml_no_night: e.target.checked})} className="rounded" />
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
                <input type="text" value={config.perm_delays} onChange={e => setConfig({...config, perm_delays: e.target.value})} placeholder="1-5,7,10-15" className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                <p className="text-xs text-muted-foreground mt-1">Дни, когда сотрудник НЕ ставится — каждый месяц</p>
                {config.perm_delays.trim() && (
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
                <input type="text" value={config.perm_unavailable} onChange={e => setConfig({...config, perm_unavailable: e.target.value})} placeholder="10-15,28-30" className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                <p className="text-xs text-muted-foreground mt-1">Дни, когда сотрудник полностью недоступен — каждый месяц</p>
                {config.perm_unavailable.trim() && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {parsePermUnavailDates().filter(d => d >= 1 && d <= 31).map(d => (
                      <span key={d} className="px-1.5 py-0.5 bg-muted text-foreground/80 text-xs rounded">{d}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Предпочтение */}
              <div className="bg-card rounded-lg p-3">
                <label className="block text-sm font-medium text-foreground mb-2">Предпочтение (с кем ставить в смену)</label>
                <p className="text-xs text-muted-foreground mb-2">Выберите сотрудников, с которыми этот человек работает в паре (Д+Дп или Н+Нп — одна смена)</p>
                <button
                  type="button"
                  onClick={() => setShowPrefList(!showPrefList)}
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
                          <button type="button" onClick={() => togglePreference(pid)} className="hover:text-foreground">
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
                          onClick={() => togglePreference(emp.id)}
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
                  Правило: Д + Дп = одна смена, Н + Нп = одна смена. Если А preferring Б — алгоритм ставит их в один день.
                </p>
              </div>

              {/* Удаление / Восстановление */}
              <div className={`rounded-lg p-3 border ${config.excluded ? 'bg-red-500/10 border-red-500/30' : 'bg-card border-border'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {config.excluded ? 'Сотрудник исключён из табеля' : 'Удаление из табеля'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {config.excluded
                        ? 'Не участвует в генерации расписания. Можно вернуть.'
                        : 'Сотрудник не будет участвовать в расписании'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => config.excluded ? handleToggleExcluded() : setShowExcludeConfirm(true)}
                    disabled={saving}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                      config.excluded
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                        : 'bg-red-600 text-white hover:bg-red-700'
                    } disabled:opacity-50`}
                  >
                    {config.excluded ? 'Вернуть в табель' : 'Удалить'}
                  </button>
                </div>

                {showExcludeConfirm && (
                  <div className="mt-3 p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                    <p className="text-sm text-red-700 mb-3">Вы уверены? Сотрудник исключён не будет из таблицы настроек, но исчезнет из расписания.</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleToggleExcluded}
                        disabled={saving}
                        className="px-4 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                      >
                        Да, исключить
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowExcludeConfirm(false)}
                        className="px-4 py-1.5 bg-muted text-foreground rounded-lg text-sm font-medium hover:bg-border"
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
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