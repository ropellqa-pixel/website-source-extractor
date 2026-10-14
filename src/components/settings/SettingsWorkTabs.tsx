import { Dispatch, SetStateAction } from 'react';
import { Save, Lock, Unlock, Banknote, Calendar } from 'lucide-react';
import RotationSettings from '../RotationSettings';
import type { Profile } from './types';

interface Props {
  activeTab: string;
  isDeputy: boolean;
  userId: string | undefined;
  profiles: Profile[];
  salLoading: boolean;
  percentValue: number;
  setPercentValue: Dispatch<SetStateAction<number>>;
  percentLocked: boolean;
  handleUnlockPercent: () => void;
  setShowPercentLock: Dispatch<SetStateAction<boolean>>;
  responsibleId: string | null;
  setResponsibleId: Dispatch<SetStateAction<string | null>>;
  managerPercent: number;
  setManagerPercent: Dispatch<SetStateAction<number>>;
  managerResponsibleId: string | null;
  setManagerResponsibleId: Dispatch<SetStateAction<string | null>>;
  handleSaveSalary: () => void;
  salSaving: boolean;
  salSaved: boolean;
  schLoading: boolean;
  scheduleResponsibleId: string | null;
  setScheduleResponsibleId: Dispatch<SetStateAction<string | null>>;
  canEditScheduleSettings: boolean;
  scheduleProfiles: Profile[];
  excludedIds: Set<string>;
  setExcludedIds: Dispatch<SetStateAction<Set<string>>>;
  handleSaveSchedule: () => void;
  schSaving: boolean;
  schSaved: boolean;
}

export default function SettingsWorkTabs({
  activeTab, isDeputy, userId, profiles, salLoading, percentValue, setPercentValue, percentLocked, handleUnlockPercent,
  setShowPercentLock, responsibleId, setResponsibleId, managerPercent, setManagerPercent, managerResponsibleId,
  setManagerResponsibleId, handleSaveSalary, salSaving, salSaved, schLoading, scheduleResponsibleId, setScheduleResponsibleId,
  canEditScheduleSettings, scheduleProfiles, excludedIds, setExcludedIds, handleSaveSchedule, schSaving, schSaved,
}: Props) {
  return (
    <>
      {activeTab === 'salary' && (
        <div className="space-y-6">
          {!isDeputy ? (
            <div className="bg-card rounded-xl border border-border p-6 text-center">
              <Banknote className="w-12 h-12 text-muted-foreground/70 mx-auto mb-3" />
              <h2 className="text-lg font-semibold text-muted-foreground">Доступно заместителю директора</h2>
            </div>
          ) : salLoading ? (
            <div className="bg-card rounded-xl border border-border p-6 text-center">
              <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">Загрузка...</p>
            </div>
          ) : (
            <>
              <div className="bg-card rounded-xl border border-border p-6">
                <h2 className="text-lg font-semibold text-foreground mb-6 flex items-center gap-2">
                  <Banknote className="w-5 h-5 text-emerald-600" />
                  Настройки зарплаты
                </h2>
                <p className="text-sm text-muted-foreground mb-6">Глобальные настройки, действуют для всех периодов</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-secondary rounded-lg p-4 border border-border">
                    <label className="block text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Процент от выручки (%)</label>
                    <div className="flex gap-2">
                      <input type="number" step="0.1" value={percentValue} disabled={percentLocked}
                        onChange={(e) => setPercentValue(Number(e.target.value))}
                        className="flex-1 bg-secondary border border-border rounded-lg px-4 py-3 text-foreground text-lg font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50" />
                      {percentLocked ? (
                        <button onClick={handleUnlockPercent}
                          className="px-4 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-all flex items-center gap-1 text-sm font-medium">
                          <Unlock className="w-4 h-4" /> Разблокировать
                        </button>
                      ) : (
                        <button onClick={() => setShowPercentLock(true)}
                          className="px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-all flex items-center gap-1 text-sm font-medium">
                          <Lock className="w-4 h-4" /> Заблокировать
                        </button>
                      )}
                    </div>
                    {percentLocked && <p className="text-xs text-amber-600 mt-2">🔒 Процент заблокирован кодом.</p>}
                  </div>
                  <div className="bg-secondary rounded-lg p-4 border border-border">
                    <label className="block text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Ответственный за расчёт ЗП</label>
                    <select value={responsibleId || ''} onChange={(e) => setResponsibleId(e.target.value || null)}
                      className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500">
                      <option value="">— Не назначен —</option>
                      {profiles.filter(p => p.role !== 'director').map(p => (
                        <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                      ))}
                    </select>
                  </div>
                  <div className="bg-secondary rounded-lg p-4 border border-indigo-500/30">
                    <label className="block text-xs text-indigo-700 mb-2 font-medium uppercase tracking-wider">Процент заведующего (%)</label>
                    <input type="number" step="0.1" value={managerPercent}
                      onChange={(e) => setManagerPercent(Number(e.target.value))}
                      className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground text-lg font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div className="bg-secondary rounded-lg p-4 border border-indigo-500/30">
                    <label className="block text-xs text-indigo-700 mb-2 font-medium uppercase tracking-wider">Ответственный за заведующих</label>
                    <select value={managerResponsibleId || ''} onChange={(e) => setManagerResponsibleId(e.target.value || null)}
                      className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      <option value="">— Не назначен —</option>
                      {profiles.filter(p => p.role !== 'director').map(p => (
                        <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-6 flex justify-end">
                  <button onClick={handleSaveSalary} disabled={salSaving}
                    className="flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-all disabled:opacity-50">
                    <Save className="w-4 h-4" />
                    {salSaving ? 'Сохранение...' : salSaved ? 'Сохранено!' : 'Сохранить'}
                  </button>
                </div>
              </div>
              <RotationSettings isDeputy={isDeputy} profiles={profiles} responsibleId={responsibleId} userId={userId || '00000000-0000-0000-0000-000000000000'} />
            </>
          )}
        </div>
      )}

      {activeTab === 'schedule' && (
        <div className="space-y-6">
          {schLoading ? (
            <div className="bg-card rounded-xl border border-border p-6 text-center">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">Загрузка...</p>
            </div>
          ) : (
            <>
              <div className="bg-card rounded-xl border border-border p-6">
                <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-blue-600" />
                  Настройки табеля
                </h2>
                <div className="bg-secondary rounded-lg p-4 border border-border mt-4">
                  <label className="block text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Ответственный за табель</label>
                  <select value={scheduleResponsibleId || ''} onChange={(e) => setScheduleResponsibleId(e.target.value || null)}
                    disabled={!canEditScheduleSettings}
                    className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50">
                    <option value="">— Не назначен —</option>
                    {scheduleProfiles.map(p => (
                      <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="bg-card rounded-xl border border-border p-6">
                <h3 className="text-base font-semibold text-foreground mb-4">Удаление сотрудников из табеля</h3>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {scheduleProfiles.map(p => {
                    const isExcluded = excludedIds.has(p.id);
                    return (
                      <div key={p.id} className={`flex items-center justify-between p-3 rounded-lg border transition-all ${isExcluded ? 'bg-red-500/5 border-red-500/20 opacity-60' : 'bg-secondary border-border'}`}>
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${isExcluded ? 'bg-red-500/20 text-red-600' : 'bg-muted text-foreground/80'}`}>
                            {(p.full_name || p.email || '?')[0]}
                          </div>
                          <div>
                            <p className={`text-sm font-medium ${isExcluded ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{p.full_name || 'Без имени'}</p>
                            <p className="text-xs text-muted-foreground">{p.email}</p>
                          </div>
                        </div>
                        {canEditScheduleSettings && (
                          <button onClick={() => setExcludedIds(prev => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next; })}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${isExcluded ? 'bg-emerald-600/20 text-emerald-600 hover:bg-emerald-600/30 border border-emerald-500/30' : 'bg-red-600/20 text-red-600 hover:bg-red-600/30 border border-red-500/30'}`}>
                            {isExcluded ? 'Вернуть' : 'Убрать'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              {canEditScheduleSettings && (
                <div className="flex justify-end">
                  <button onClick={handleSaveSchedule} disabled={schSaving}
                    className="flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-all disabled:opacity-50">
                    <Save className="w-4 h-4" />
                    {schSaving ? 'Сохранение...' : schSaved ? 'Сохранено!' : 'Сохранить'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

    </>
  );
}
