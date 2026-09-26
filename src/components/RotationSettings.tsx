import { useState, useEffect } from 'react';
import { db } from '@/lib/sdk';
import { Save, Plus, Trash2, ArrowUp, ArrowDown, Users, AlertTriangle } from 'lucide-react';

interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: string;
}

interface RotationRow {
  id?: string;
  profile_id: string;
  position: number;
  store_name: string;
  active: boolean;
}

const MONTHS_COUNT = 72;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function getDaysInMonth(m: number, y: number): number {
  if (m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) return 29;
  return DAYS_IN_MONTH[m - 1];
}

interface Props {
  isDeputy: boolean;
  profiles: Profile[];
  responsibleId: string | null;
  userId: string;
}

export default function RotationSettings({ isDeputy, profiles: propProfiles, responsibleId, userId }: Props) {
  const [rows, setRows] = useState<RotationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newProfileId, setNewProfileId] = useState('');
  const [precreatedCount, setPrecreatedCount] = useState(0);
  const [saveError, setSaveError] = useState('');

  // Self-load profiles if parent provides empty array
  const [selfProfiles, setSelfProfiles] = useState<Profile[]>([]);
  const profiles = propProfiles.length > 0 ? propProfiles : selfProfiles;

  useEffect(() => {
    loadRotation();
    if (propProfiles.length === 0) {
      loadProfiles();
    }
  }, []);

  async function loadProfiles() {
    try {
      const { data, error } = await db.from('profiles').select('*');
      if (error) {
        console.error('[RotationSettings] Load profiles error:', error);
        return;
      }
      if (data && data.length > 0) {
        setSelfProfiles(data as Profile[]);
      }
    } catch (e) {
      console.error('[RotationSettings] Load profiles error:', e);
    }
  }

  async function loadRotation() {
    setLoading(true);
    try {
      const { data, error } = await db.from('employee_rotation').select('*').order('position');
      if (error) {
        console.error('[RotationSettings] Load rotation error:', error);
      }
      if (data && data.length > 0) setRows(data as RotationRow[]);
    } catch (e) {
      console.error('[RotationSettings] Load rotation error:', e);
    } finally {
      setLoading(false);
    }
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    setRows(prev => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next.map((r, i) => ({ ...r, position: i + 1 }));
    });
  }

  function moveDown(idx: number) {
    setRows(prev => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next.map((r, i) => ({ ...r, position: i + 1 }));
    });
  }

  function removeRow(idx: number) {
    setRows(prev => prev.filter((_, i) => i !== idx).map((r, i) => ({ ...r, position: i + 1 })));
  }

  function addEmployee() {
    if (!newProfileId) return;
    if (rows.some(r => r.profile_id === newProfileId)) return;
    setRows(prev => [...prev, {
      profile_id: newProfileId,
      position: prev.length + 1,
      store_name: '',
      active: true,
    }]);
    setNewProfileId('');
  }

  function toggleActive(idx: number) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, active: !r.active } : r));
  }

  function updateStore(idx: number, value: string) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, store_name: value } : r));
  }

  async function handleSave() {
    if (!isDeputy) return;
    setSaving(true);
    setPrecreatedCount(0);
    setSaveError('');
    try {
      const { data: existing } = await db.from('employee_rotation').select('id');
      if (existing && existing.length > 0) {
        const ids = existing.map((r: { id: string }) => r.id);
        for (let i = 0; i < ids.length; i += 20) {
          const batch = ids.slice(i, i + 20);
          await db.from('employee_rotation').delete().in('id', batch);
        }
      }

      if (rows.length > 0) {
        const toInsert = rows.map((r, i) => ({
          profile_id: r.profile_id,
          position: i + 1,
          store_name: r.store_name || '',
          active: r.active,
        }));
        const { error: insertErr } = await db.from('employee_rotation').insert(toInsert);
        if (insertErr) {
          console.error('[RotationSettings] Insert rotation error:', insertErr);
          setSaveError('Ошибка записи ротации: ' + (insertErr.message || 'Неизвестная ошибка'));
          setSaving(false);
          return;
        }
      }

      const activeEmployees = rows.filter(r => r.active);
      if (activeEmployees.length === 0) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        return;
      }

      const now = new Date();
      const startMonth = now.getMonth() + 1;
      const startYear = now.getFullYear();

      const profileIds = activeEmployees.map(r => r.profile_id);
      const { data: existingRows } = await db.from('salary_data')
        .select('profile_id, month_year')
        .in('profile_id', profileIds);

      const existingSet = new Set(
        (existingRows || []).map((r: Record<string, unknown>) => `${r.profile_id}:${r.month_year}`)
      );

      const newRows: Record<string, unknown>[] = [];
      for (let m = 0; m < MONTHS_COUNT; m++) {
        const targetMonth = ((startMonth - 1 + m) % 12) + 1;
        const targetYear = startYear + Math.floor((startMonth - 1 + m) / 12);
        const period = `${String(targetMonth).padStart(2, '0')}.${targetYear}`;

        for (const emp of activeEmployees) {
          const key = `${emp.profile_id}:${period}`;
          if (!existingSet.has(key)) {
            newRows.push({
              profile_id: emp.profile_id,
              hours_worked: 0,
              revenue: 0,
              days_in_month: getDaysInMonth(targetMonth, targetYear),
              vacation_pay: 0,
              non_cash: 0,
              overtime: 0,
              tax: 0,
              month_year: period,
              responsible_user_id: responsibleId,
              user_id: userId,
            });
          }
        }
      }

      let inserted = 0;
      for (let i = 0; i < newRows.length; i += 50) {
        const batch = newRows.slice(i, i + 50);
        const { error } = await db.from('salary_data').insert(batch);
        if (error) {
          console.error('[RotationSettings] Batch insert salary_data error:', error);
        } else {
          inserted += batch.length;
        }
      }

      setPrecreatedCount(inserted);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      console.error('[RotationSettings] Save rotation error:', e);
      setSaveError('Ошибка сохранения: ' + (e instanceof Error ? e.message : 'Неизвестная ошибка'));
    } finally {
      setSaving(false);
    }
  }

  const availableProfiles = profiles.filter(p =>
    p.role !== 'director' && !rows.some(r => r.profile_id === p.id)
  );

  if (loading) {
    return (
      <div className="bg-secondary rounded-lg p-4 border border-border mt-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          Загрузка ротации...
        </div>
      </div>
    );
  }

  return (
    <div className="bg-secondary rounded-lg p-4 border border-border mt-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-emerald-600" />
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Ротация сотрудников</h3>
        </div>
        <span className="text-xs text-muted-foreground">Автоматическое заполнение ЗП на 6 лет вперёд</span>
      </div>

      {profiles.length === 0 && (
        <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg mb-4">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-700">
            Профили сотрудников не загружены. Добавьте сотрудников на странице «Сотрудники», затем обновите эту страницу.
          </p>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-muted-foreground text-sm mb-4">Ротация не настроена. Добавьте сотрудников и задайте порядок.</p>
        </div>
      ) : (
        <div className="space-y-2 mb-4">
          {rows.map((row, idx) => {
            const profile = profiles.find(p => p.id === row.profile_id);
            return (
              <div key={row.id || `new-${idx}`}
                className={`flex items-center gap-2 p-2 rounded-lg border transition-all ${
                  row.active
                    ? 'bg-secondary border-border'
                    : 'bg-card/60 border-border opacity-50'
                }`}>
                <span className="w-6 text-center text-xs text-muted-foreground font-bold shrink-0">{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${row.active ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {profile?.full_name || profile?.email || 'Неизвестный (ID: ' + row.profile_id.slice(0, 8) + ')'}
                  </p>
                </div>
                <input type="text" value={row.store_name}
                  onChange={(e) => updateStore(idx, e.target.value)}
                  placeholder="Магазин"
                  className="w-32 bg-secondary border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500 shrink-0"
                  disabled={!isDeputy} />
                <button onClick={() => moveUp(idx)} disabled={idx === 0 || !isDeputy}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-all shrink-0">
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => moveDown(idx)} disabled={idx === rows.length - 1 || !isDeputy}
                  className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-all shrink-0">
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => toggleActive(idx)} disabled={!isDeputy}
                  className={`px-2 py-1 rounded text-xs font-medium transition-all shrink-0 ${
                    row.active
                      ? 'bg-emerald-600/20 text-emerald-600 border border-emerald-500/30'
                      : 'bg-red-600/20 text-red-600 border border-red-500/30'
                  }`}>
                  {row.active ? 'Акт.' : 'Неакт.'}
                </button>
                {isDeputy && (
                  <button onClick={() => removeRow(idx)}
                    className="p-1 text-red-600/60 hover:text-red-600 transition-all shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isDeputy && (
        <div className="flex items-center gap-2 mb-4">
          <select value={newProfileId} onChange={(e) => setNewProfileId(e.target.value)}
            className="flex-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500">
            <option value="">— Добавить сотрудника ({availableProfiles.length}) —</option>
            {availableProfiles.map(p => (
              <option key={p.id} value={p.id}>{p.full_name || p.email} ({p.role || 'без роли'})</option>
            ))}
          </select>
          <button onClick={addEmployee} disabled={!newProfileId}
            className="flex items-center gap-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-all">
            <Plus className="w-4 h-4" /> Добавить
          </button>
        </div>
      )}

      {isDeputy && (
        <div className="flex items-center justify-between">
          <div>
            {saveError && (
              <p className="text-xs text-red-600">{saveError}</p>
            )}
            {saved && (
              <p className="text-xs text-emerald-600">
                ✓ Сохранено{precreatedCount > 0 ? `. Создано ${precreatedCount} строк ЗП на 6 лет` : ''}
              </p>
            )}
          </div>
          <button onClick={handleSave} disabled={saving || rows.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50">
            <Save className="w-4 h-4" />
            {saving ? 'Сохранение и заполнение...' : saved && precreatedCount > 0 ? 'Готово!' : 'Сохранить ротацию'}
          </button>
        </div>
      )}
    </div>
  );
}
