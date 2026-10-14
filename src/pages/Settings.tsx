import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { db, auth } from '@/lib/sdk';
import { createVkBindCode, getVkStatus, unbindVk } from '../lib/vkBinding';
import { User, Building2, Bell, Shield, KeyRound, Banknote, Calendar } from 'lucide-react';
import SettingsAccountTabs from '../components/settings/SettingsAccountTabs';
import SettingsWorkTabs from '../components/settings/SettingsWorkTabs';
import SettingsSystemTabs from '../components/settings/SettingsSystemTabs';
import SettingsDialogs from '../components/settings/SettingsDialogs';
import type { PinCode, Profile } from '../components/settings/types';

const SECRET_CODE = '2535';
const DIRECTOR_PIN = '2152';

async function loadGlobalSalarySettings() {
  const { data, error } = await db.from('salary_settings').select('*').is('month_year', null).limit(1);
  if (error) console.error('loadGlobalSalarySettings error:', error);
  if (data && data.length > 0) return data[0];
  return null;
}

async function loadGlobalManagerSettings() {
  const { data, error } = await db.from('manager_settings').select('*').is('month_year', null).limit(1);
  if (error) console.error('loadGlobalManagerSettings error:', error);
  if (data && data.length > 0) return data[0];
  return null;
}

async function saveGlobalSalarySettings(pct: number, locked: boolean, respId: string | null) {
  const existing = await loadGlobalSalarySettings();
  if (existing) {
    const { error } = await db.from('salary_settings').update({
      percent: pct, is_locked: locked, responsible_profile_id: respId || null,
    }).eq('id', existing.id);
    if (error) { console.error('Update salary_settings error:', error); return false; }
    return true;
  } else {
    const { error } = await db.from('salary_settings').insert({
      percent: pct, is_locked: locked, responsible_profile_id: respId || null,
      revenue: 0, days_in_month: 30, month_year: null,
    });
    if (error) { console.error('Insert salary_settings error:', error); return false; }
    return true;
  }
}

async function saveGlobalManagerSettings(mgrPercent: number, mgrRespId: string | null) {
  const existing = await loadGlobalManagerSettings();
  if (existing) {
    const { error } = await db.from('manager_settings').update({
      manager_percent: mgrPercent, responsible_profile_id: mgrRespId || null,
    }).eq('id', existing.id);
    if (error) { console.error('Update manager_settings error:', error); return false; }
    return true;
  } else {
    const { error } = await db.from('manager_settings').insert({
      manager_percent: mgrPercent, responsible_profile_id: mgrRespId || null,
      is_locked: false, month_year: null,
    });
    if (error) { console.error('Insert manager_settings error:', error); return false; }
    return true;
  }
}

async function loadGlobalScheduleSettings() {
  const { data, error } = await db.from('schedule_settings').select('*').is('month_year', null).limit(1);
  if (error) console.error('loadGlobalScheduleSettings error:', error);
  if (data && data.length > 0) return data[0];
  return null;
}

async function saveGlobalScheduleSettings(respId: string | null) {
  const existing = await loadGlobalScheduleSettings();
  if (existing) {
    const { error } = await db.from('schedule_settings').update({
      responsible_profile_id: respId || null,
    }).eq('id', existing.id);
    if (error) { console.error('Update schedule_settings error:', error); return false; }
    return true;
  } else {
    const { error } = await db.from('schedule_settings').insert({
      month_year: null, is_locked: false, responsible_profile_id: respId || null,
    });
    if (error) { console.error('Insert schedule_settings error:', error); return false; }
    return true;
  }
}

export default function Settings() {
  const { user, company, refreshRoles } = useAuth();
  const isDeputy = user?.role === 'deputy_director';
  const isDirector = user?.role === 'director';
  const [activeTab, setActiveTab] = useState('profile');

  const [pins, setPins] = useState<PinCode[]>([]);
  const [showPin, setShowPin] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pinLoading, setPinLoading] = useState(false);

  const [notifications, setNotifications] = useState({ email: true, push: true, chat: true, documents: true });

  const [profileData, setProfileData] = useState({ fullName: user?.fullName || '', email: user?.email || '', phone: '' });
  const [companyData, setCompanyData] = useState({ name: company?.name || '', inn: company?.inn || '', ogrn: company?.ogrn || '', type: company?.type || 'ООО' });
  const [saved, setSaved] = useState(false);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [percentValue, setPercentValue] = useState(2.5);
  const [percentLocked, setPercentLocked] = useState(false);
  const [responsibleId, setResponsibleId] = useState<string | null>(null);
  const [salLoading, setSalLoading] = useState(true);
  const [salSaving, setSalSaving] = useState(false);
  const [salSaved, setSalSaved] = useState(false);

  const [showPercentLock, setShowPercentLock] = useState(false);
  const [percentCode, setPercentCode] = useState('');
  const [percentError, setPercentError] = useState('');

  const [managerPercent, setManagerPercent] = useState(5);
  const [managerResponsibleId, setManagerResponsibleId] = useState<string | null>(null);

  const [scheduleResponsibleId, setScheduleResponsibleId] = useState<string | null>(null);
  const [schLoading, setSchLoading] = useState(true);
  const [schSaving, setSchSaving] = useState(false);
  const [schSaved, setSchSaved] = useState(false);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  const [vkLinked, setVkLinked] = useState(false);
  const [vkLink, setVkLink] = useState('');
  const [vkBindCode, setVkBindCode] = useState<string | null>(null);
  const [vkBindingLoading, setVkBindingLoading] = useState(false);
  const [vkError, setVkError] = useState('');
  const [vkProfileId, setVkProfileId] = useState<string | null>(null);

  const [apiToken, setApiToken] = useState<string | null>(null);
  const [apiTokenVisible, setApiTokenVisible] = useState(false);
  const [apiTokenLoading, setApiTokenLoading] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);

  const tabs = [
    { id: 'profile', label: 'Профиль', icon: User },
    { id: 'company', label: 'Компания', icon: Building2 },
    { id: 'quicklogin', label: 'Быстрый вход', icon: KeyRound },
    { id: 'salary', label: 'Зарплата', icon: Banknote },
    { id: 'schedule', label: 'Табель', icon: Calendar },
    { id: 'notifications', label: 'Уведомления', icon: Bell },
    { id: 'security', label: 'Безопасность', icon: Shield },
  ];

  useEffect(() => {
    if (activeTab === 'quicklogin' && user) loadQuickLoginData();
    if (activeTab === 'salary') loadSalaryGlobal();
    if (activeTab === 'schedule') loadScheduleGlobal();
    if (activeTab === 'profile' && user) loadProfileVk();
    if (activeTab === 'security' && user) loadApiToken();
  }, [activeTab, user]);

  const loadApiToken = async () => {
    setApiTokenLoading(true);
    try {
      const token = await auth.getApiToken();
      setApiToken(token);
    } finally {
      setApiTokenLoading(false);
    }
  };

  const handleRevokeApiToken = async () => {
    setApiTokenLoading(true);
    setShowRevokeConfirm(false);
    try {
      const token = await auth.revokeApiToken();
      setApiToken(token);
      setApiTokenVisible(true);
    } finally {
      setApiTokenLoading(false);
    }
  };

  const loadProfileVk = async () => {
    if (!user) return;
    try {
      const { data } = await db.from('profiles').select('id, vk_link, vk_id').eq('user_id', user.id).limit(1);
      if (data && data.length > 0) {
        setVkProfileId(data[0].id as string);
        setVkLink((data[0].vk_link as string) || '');
        setVkLinked(!!data[0].vk_id);
        const status = await getVkStatus(data[0].id as string);
        setVkBindCode(status?.code || null);
      }
    } catch (e) { console.error('Load VK link error:', e); }
  };

  /** Генерирует 6-значный код для привязки своего аккаунта к боту VK. */
  const handleGenerateVkCode = async () => {
    if (!vkProfileId) { setVkError('Профиль не найден. Сохраните ФИО.'); return; }
    setVkError('');
    setVkBindingLoading(true);
    try {
      const code = await createVkBindCode(vkProfileId);
      if (!code) { setVkError('Не удалось создать код. Попробуйте ещё раз.'); return; }
      setVkBindCode(code);
    } catch (e) { console.error('Generate VK code error:', e); setVkError('Ошибка создания кода'); }
    finally { setVkBindingLoading(false); }
  };

  const handleUnbindOwnVk = async () => {
    if (!vkProfileId) return;
    try {
      await unbindVk(vkProfileId);
      setVkLinked(false);
      setVkLink('');
      setVkBindCode(null);
    } catch (e) { console.error('Unbind VK error:', e); setVkError('Ошибка отвязки'); }
  };

  const loadQuickLoginData = async () => {
    if (!user) return;
    try {
      const { data: pc } = await db.from('pin_codes').select('*').eq('email', user.email);
      if (pc) setPins(pc as PinCode[]);
    } catch (err) { console.error('Load quick login error:', err); }
  };

  const loadSalaryGlobal = async () => {
    setSalLoading(true);
    try {
      const [profilesRes, globalRes, mgrGlobalRes] = await Promise.all([
        db.from('profiles').select('*'),
        loadGlobalSalarySettings(),
        loadGlobalManagerSettings(),
      ]);
      const allProfiles = (profilesRes.data || []) as Profile[];
      setProfiles(allProfiles);
      if (globalRes) {
        setPercentValue(globalRes.percent ?? 2.5);
        setPercentLocked(!!globalRes.is_locked);
        setResponsibleId(globalRes.responsible_profile_id || null);
      }
      if (mgrGlobalRes) {
        setManagerPercent((mgrGlobalRes.manager_percent as number) ?? 5);
        setManagerResponsibleId((mgrGlobalRes.responsible_profile_id as string) || null);
      }
    } catch (e) { console.error('Load salary global error:', e); }
    finally { setSalLoading(false); }
  };

  const loadScheduleGlobal = async () => {
    setSchLoading(true);
    try {
      const [profilesRes, globalRes, configRes] = await Promise.all([
        db.from('profiles').select('*'),
        loadGlobalScheduleSettings(),
        db.from('schedule_config').select('profile_id, excluded'),
      ]);
      const allProfiles = (profilesRes.data || []).filter((p: Record<string, unknown>) => {
        return p.role && p.role !== 'director' && p.role !== '';
      }) as Profile[];
      setProfiles(allProfiles);
      if (globalRes) setScheduleResponsibleId(globalRes.responsible_profile_id || null);
      else setScheduleResponsibleId(null);
      const excl = new Set<string>();
      (configRes.data || []).forEach((c: Record<string, unknown>) => {
        if (c.excluded) excl.add(c.profile_id as string);
      });
      setExcludedIds(excl);
    } catch (e) { console.error('Load schedule global error:', e); }
    finally { setSchLoading(false); }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    try {
      const { error } = await db.from('profiles').update({
        full_name: profileData.fullName,
        email: profileData.email,
      }).eq('user_id', user.id);
      if (error && user.profileId) {
        await db.from('profiles').update({
          full_name: profileData.fullName,
          email: profileData.email,
        }).eq('id', user.profileId);
      }
      await refreshRoles();
    } catch (e) { console.error('Profile save error:', e); }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCreateDirectorPin = async () => {
    if (!user) return;
    setPinLoading(true);
    try {
      await db.from('pin_codes').delete().eq('email', user.email);
      const { error } = await db.from('pin_codes').insert({
        user_id: user.id, pin: DIRECTOR_PIN, email: user.email, shortcut_code: 'default',
      });
      if (error) { alert('Ошибка создания пина: ' + (error.message || 'Неизвестная ошибка')); return; }
      await loadQuickLoginData();
    } catch (err) { console.error('Create director pin error:', err); }
    finally { setPinLoading(false); }
  };

  function handleLockPercent() {
    if (percentCode === SECRET_CODE) {
      setPercentLocked(true);
      setShowPercentLock(false);
      setPercentCode('');
      setPercentError('');
      saveGlobalSalarySettings(percentValue, true, responsibleId);
    } else {
      setPercentError('Неверный код');
      setPercentCode('');
    }
  }

  function handleUnlockPercent() {
    setPercentLocked(false);
    saveGlobalSalarySettings(percentValue, false, responsibleId);
  }

  async function handleSaveSalary() {
    if (!isDeputy) return;
    setSalSaving(true);
    try {
      const okSal = await saveGlobalSalarySettings(percentValue, percentLocked, responsibleId);
      const okMgr = await saveGlobalManagerSettings(managerPercent, managerResponsibleId);
      if (okSal && okMgr) { setSalSaved(true); setTimeout(() => setSalSaved(false), 2000); }
      else alert('Ошибка сохранения настроек зарплаты');
    } finally { setSalSaving(false); }
  }

  async function handleSaveSchedule() {
    if (!isDeputy) return;
    setSchSaving(true);
    try {
      const ok = await saveGlobalScheduleSettings(scheduleResponsibleId);
      for (const p of profiles) {
        const isExcluded = excludedIds.has(p.id);
        const { data: existing } = await db.from('schedule_config').select('id').eq('profile_id', p.id).limit(1);
        if (existing && existing.length > 0) {
          await db.from('schedule_config').update({ excluded: isExcluded }).eq('id', existing[0].id);
        } else {
          await db.from('schedule_config').insert({
            profile_id: p.id, excluded: isExcluded, status: 'ЛБ', no_day: false, no_night: false, break_days: 1, priority: 3,
          });
        }
      }
      if (ok) { setSchSaved(true); setTimeout(() => setSchSaved(false), 2000); }
      else alert('Ошибка сохранения настроек табеля');
    } finally { setSchSaving(false); }
  }

  const canEditScheduleSettings = isDeputy;
  const scheduleProfiles = profiles.filter(p => p.role !== 'director');

  return (
    <div className="min-h-full">
      <header className="bg-card backdrop-blur-sm border-b border-border sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <a href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </a>
              <h1 className="text-xl font-bold text-foreground">Настройки</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-6">
          <div className="w-64 flex-shrink-0">
            <nav className="bg-card rounded-xl border border-border p-2">
              {tabs.map((tab) => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                    activeTab === tab.id ? 'bg-blue-500/10 text-blue-600' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                  }`}>
                  <tab.icon className="w-5 h-5" />
                  <span className="font-medium">{tab.label}</span>
                </button>
              ))}
            </nav>
          </div>

          <div className="flex-1">
            <SettingsAccountTabs
              activeTab={activeTab}
              profileData={profileData}
              setProfileData={setProfileData}
              companyData={companyData}
              setCompanyData={setCompanyData}
              saved={saved}
              handleSaveProfile={handleSaveProfile}
              vkError={vkError}
              vkLinked={vkLinked}
              vkLink={vkLink}
              vkBindCode={vkBindCode}
              vkBindingLoading={vkBindingLoading}
              handleGenerateVkCode={handleGenerateVkCode}
              handleUnbindOwnVk={handleUnbindOwnVk}
              pins={pins}
              isDirector={isDirector}
              pinLoading={pinLoading}
              handleCreateDirectorPin={handleCreateDirectorPin}
              showPin={showPin}
              setShowPin={setShowPin}
              copiedId={copiedId}
              copyToClipboard={copyToClipboard}
              DIRECTOR_PIN={DIRECTOR_PIN}
            />

            <SettingsWorkTabs
              activeTab={activeTab}
              isDeputy={isDeputy}
              userId={user?.id}
              profiles={profiles}
              salLoading={salLoading}
              percentValue={percentValue}
              setPercentValue={setPercentValue}
              percentLocked={percentLocked}
              handleUnlockPercent={handleUnlockPercent}
              setShowPercentLock={setShowPercentLock}
              responsibleId={responsibleId}
              setResponsibleId={setResponsibleId}
              managerPercent={managerPercent}
              setManagerPercent={setManagerPercent}
              managerResponsibleId={managerResponsibleId}
              setManagerResponsibleId={setManagerResponsibleId}
              handleSaveSalary={handleSaveSalary}
              salSaving={salSaving}
              salSaved={salSaved}
              schLoading={schLoading}
              scheduleResponsibleId={scheduleResponsibleId}
              setScheduleResponsibleId={setScheduleResponsibleId}
              canEditScheduleSettings={canEditScheduleSettings}
              scheduleProfiles={scheduleProfiles}
              excludedIds={excludedIds}
              setExcludedIds={setExcludedIds}
              handleSaveSchedule={handleSaveSchedule}
              schSaving={schSaving}
              schSaved={schSaved}
            />

            <SettingsSystemTabs
              activeTab={activeTab}
              notifications={notifications}
              setNotifications={setNotifications}
              apiTokenLoading={apiTokenLoading}
              apiToken={apiToken}
              apiTokenVisible={apiTokenVisible}
              setApiTokenVisible={setApiTokenVisible}
              copiedId={copiedId}
              copyToClipboard={copyToClipboard}
              setShowRevokeConfirm={setShowRevokeConfirm}
            />
          </div>
        </div>
      </main>

      <SettingsDialogs
        showPercentLock={showPercentLock}
        setShowPercentLock={setShowPercentLock}
        percentCode={percentCode}
        setPercentCode={setPercentCode}
        percentError={percentError}
        setPercentError={setPercentError}
        handleLockPercent={handleLockPercent}
        showRevokeConfirm={showRevokeConfirm}
        setShowRevokeConfirm={setShowRevokeConfirm}
        handleRevokeApiToken={handleRevokeApiToken}
      />
    </div>
  );
}