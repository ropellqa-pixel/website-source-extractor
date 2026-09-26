import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { db } from '@/lib/sdk';
import { updateVkProfileLink } from '../lib/vkBinding';
import RotationSettings from '../components/RotationSettings';
import {
  Settings as SettingsIcon, User, Building2, Bell, Shield,
  Save, Lock, Mail, Phone, Globe, KeyRound, Eye, EyeOff,
  RefreshCw, Copy, Check, Unlock, Banknote, Calendar,
  Link, ExternalLink
} from 'lucide-react';

interface PinCode {
  id: string;
  user_id: string;
  pin: string;
  email: string;
  shortcut_code: string;
}

interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: string;
  department: string;
  status: string;
  vk_link: string | null;
  vk_id: string | null;
}

const SECRET_CODE = '2535';
const DIRECTOR_PIN = '2152';

function normalizeVkLink(raw: string): string {
  let v = raw.trim()
  // Убираем пробелы
  v = v.replace(/\s+/g, '')
  // Если просто число — это ID
  if (/^\d+$/.test(v)) return 'https://vk.com/id' + v
  // Добавляем https:// если нет протокола
  if (v && !v.startsWith('http')) v = 'https://' + v
  return v
}

function isValidVkLink(raw: string): boolean {
  if (!raw.trim()) return false
  const normalized = normalizeVkLink(raw)
  // vk.com/id12345, vk.com/username, vk.com/id12345?w=...
  return /^https?:\/\/(www\.)?vk\.com\/.+/i.test(normalized)
}

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

  const [vkLink, setVkLink] = useState('');
  const [vkLinked, setVkLinked] = useState(false);
  const [vkLinkSaved, setVkLinkSaved] = useState(false);
  const [vkBindingLoading, setVkBindingLoading] = useState(false);
  const [vkError, setVkError] = useState('');

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
  }, [activeTab, user]);

  const loadProfileVk = async () => {
    if (!user) return;
    try {
      const { data } = await db.from('profiles').select('vk_link, vk_id').eq('user_id', user.id).limit(1);
      if (data && data.length > 0) {
        setVkLink((data[0].vk_link as string) || '');
        setVkLinked(!!data[0].vk_id);
      }
    } catch (e) { console.error('Load VK link error:', e); }
  };

  const handleSaveVkLink = async () => {
    if (!user) return;
    setVkError('');
    setVkLinkSaved(false);
    const normalized = normalizeVkLink(vkLink);
    if (!isValidVkLink(normalized)) {
      setVkError('Введите ссылку VK (например: vk.com/id12345)');
      return;
    }
    try {
      setVkLink(normalized);
      const { data, error: profileReadError } = await db.from('profiles').select('id').eq('user_id', user.id).limit(1);
      if (profileReadError) throw profileReadError;
      if (data && data.length > 0) {
        await updateVkProfileLink(data[0].id, normalized);
      } else {
        const { error: profileWriteError } = await db.from('profiles').insert({ vk_link: normalized, user_id: user.id });
        if (profileWriteError) throw profileWriteError;
      }
      setVkLinkSaved(true);
      setTimeout(() => setVkLinkSaved(false), 2000);
    } catch (e) { console.error('Save VK link error:', e); setVkError('Ошибка сохранения ссылки VK'); }
  };

  const handleBindVk = async () => {
    if (!user || !vkLink.trim()) return;
    setVkError('');
    setVkBindingLoading(true);
    try {
      const normalized = normalizeVkLink(vkLink);
      if (!isValidVkLink(normalized)) {
        setVkError('Введите ссылку VK (например: vk.com/id12345)');
        setVkBindingLoading(false);
        return;
      }

      setVkLink(normalized);

      const { data: profileData } = await db.from('profiles').select('id').eq('user_id', user.id).limit(1);
      if (!profileData || profileData.length === 0) {
        setVkError('Профиль не найден. Сохраните ФИО.');
        setVkBindingLoading(false);
        return;
      }
      await updateVkProfileLink(profileData[0].id, normalized, true);

      setVkLinkSaved(true);
      setTimeout(() => setVkLinkSaved(false), 3000);
    } catch (e) { console.error('Bind VK error:', e); setVkError('Ошибка создания заявки'); }
    finally { setVkBindingLoading(false); }
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
            {activeTab === 'profile' && (
              <div className="space-y-6">
                <div className="bg-card rounded-xl border border-border p-6">
                  <h2 className="text-lg font-semibold text-foreground mb-6">Настройки профиля</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground/80 mb-2">ФИО</label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                        <input type="text" value={profileData.fullName}
                          onChange={(e) => setProfileData({ ...profileData, fullName: e.target.value })}
                          className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground/80 mb-2">Email</label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                        <input type="email" value={profileData.email}
                          onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                          className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground/80 mb-2">Телефон</label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                        <input type="tel" value={profileData.phone}
                          onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
                          className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base"
                          placeholder="+7 (999) 123-45-67" />
                      </div>
                    </div>
                  </div>
                  <button onClick={handleSaveProfile} className="mt-6 bg-blue-500 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-600 transition-all flex items-center gap-2">
                    <Save className="w-5 h-5" />
                    {saved ? 'Сохранено!' : 'Сохранить'}
                  </button>
                </div>

                <div className="bg-card rounded-xl border border-border p-6">
                  <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
                    <Link className="w-5 h-5 text-blue-600" />
                    Привязка VK
                  </h2>
                  <p className="text-sm text-muted-foreground mb-4">
                    Привяжите ваш VK для уведомлений в боте.
                  </p>
                  {vkLinked && (
                    <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                      <p className="text-sm text-emerald-600 font-medium">✅ VK уже привязан</p>
                    </div>
                  )}
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1 font-medium">Ваш VK ID или ссылка</label>
                      <div className="relative">
                        <ExternalLink className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input type="text" value={vkLink}
                          onChange={(e) => { setVkLink(e.target.value); setVkError(''); }}
                          className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base"
                          placeholder="12345 или vk.com/id12345" />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Можно ввести чистый ID (напр. 12345), ссылку (vk.com/id12345) или полную ссылку (https://vk.com/id12345)</p>
                    </div>
                    {vkError && (
                      <div className="p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
                        <p className="text-xs text-red-600">{vkError}</p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button onClick={handleSaveVkLink}
                        className="px-4 py-2 bg-secondary hover:bg-border text-foreground text-sm rounded-lg transition-all flex items-center gap-1">
                        <Save className="w-3 h-3" />
                        {vkLinkSaved ? 'Сохранено!' : 'Сохранить ссылку'}
                      </button>
                      <button onClick={handleBindVk} disabled={!vkLink.trim() || vkBindingLoading}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-all flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">
                        <Link className="w-3 h-3" />
                        {vkBindingLoading ? 'Отправка...' : 'Привязать VK'}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      После привязки отправьте боту /начало
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'company' && (
              <div className="bg-card rounded-xl border border-border p-6">
                <h2 className="text-lg font-semibold text-foreground mb-6">Данные компании</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Название организации</label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                      <input type="text" value={companyData.name}
                        onChange={(e) => setCompanyData({ ...companyData, name: e.target.value })}
                        className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground/80 mb-2">ИНН</label>
                      <input type="text" value={companyData.inn}
                        onChange={(e) => setCompanyData({ ...companyData, inn: e.target.value })}
                        className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground/80 mb-2">ОГРН</label>
                      <input type="text" value={companyData.ogrn}
                        onChange={(e) => setCompanyData({ ...companyData, ogrn: e.target.value })}
                        className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" />
                    </div>
                  </div>
                </div>
                <button onClick={handleSaveProfile} className="mt-6 bg-blue-500 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-600 transition-all flex items-center gap-2">
                  <Save className="w-5 h-5" />
                  {saved ? 'Сохранено!' : 'Сохранить'}
                </button>
              </div>
            )}

            {activeTab === 'quicklogin' && (
              <div className="bg-card rounded-xl border border-border p-6">
                <h2 className="text-lg font-semibold text-foreground mb-2">Быстрый вход по пин-коду</h2>
                <p className="text-sm text-muted-foreground mb-6">Ваш пин-код для быстрого входа.</p>
                {pins.length === 0 ? (
                  <div className="text-center py-8">
                    <KeyRound className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground mb-4">Пин-код не назначен</p>
                    {isDirector ? (
                      <button onClick={handleCreateDirectorPin} disabled={pinLoading}
                        className="bg-gradient-to-r from-amber-500 to-orange-600 text-white px-6 py-3 rounded-lg font-medium hover:from-amber-600 hover:to-orange-700 transition-all flex items-center gap-2 mx-auto disabled:opacity-50">
                        <KeyRound className="w-5 h-5" />
                        {pinLoading ? 'Создание...' : `Создать мой пин (${DIRECTOR_PIN})`}
                      </button>
                    ) : (
                      <p className="text-sm text-muted-foreground">Обратитесь к руководителю для назначения пин-кода</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {pins.map(pinEntry => (
                      <div key={pinEntry.id} className="bg-secondary rounded-lg p-4 border border-border">
                        <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                          <div className="flex items-center gap-3">
                            <KeyRound className="w-4 h-4 text-amber-600" />
                            <span className="font-mono text-xl text-foreground tracking-widest">
                              {showPin === pinEntry.id ? pinEntry.pin : '••••'}
                            </span>
                            <button onClick={() => setShowPin(showPin === pinEntry.id ? null : pinEntry.id)}
                              className="text-muted-foreground hover:text-foreground transition-colors">
                              {showPin === pinEntry.id ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                            <button onClick={() => copyToClipboard(pinEntry.pin, `setting-pin-${pinEntry.id}`)}
                              className="text-muted-foreground hover:text-foreground transition-colors" title="Копировать">
                              {copiedId === `setting-pin-${pinEntry.id}` ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                    {isDirector && (
                      <button onClick={handleCreateDirectorPin} disabled={pinLoading}
                        className="w-full py-2 border border-dashed border-border rounded-lg text-sm text-muted-foreground hover:text-amber-600 hover:border-amber-500 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                        <RefreshCw className="w-4 h-4" />
                        {pinLoading ? 'Обновление...' : `Обновить пин на ${DIRECTOR_PIN}`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

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
                    <RotationSettings isDeputy={isDeputy} profiles={profiles} responsibleId={responsibleId} userId={user?.id || '00000000-0000-0000-0000-000000000000'} />
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

            {activeTab === 'notifications' && (
              <div className="bg-card rounded-xl border border-border p-6">
                <h2 className="text-lg font-semibold text-foreground mb-6">Настройки уведомлений</h2>
                <div className="space-y-4">
                  {Object.entries(notifications).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between p-4 bg-secondary rounded-lg">
                      <div>
                        <p className="font-medium text-foreground">{key === 'email' ? 'Email' : key === 'push' ? 'Push' : key === 'chat' ? 'Чат' : 'Документы'}</p>
                      </div>
                      <button onClick={() => setNotifications({ ...notifications, [key]: !value })}
                        className={`w-12 h-6 rounded-full transition-all ${value ? 'bg-blue-500' : 'bg-muted'}`}>
                        <div className={`w-5 h-5 bg-white rounded-full transition-all ${value ? 'translate-x-6' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'security' && (
              <div className="bg-card rounded-xl border border-border p-6">
                <h2 className="text-lg font-semibold text-foreground mb-6">Безопасность</h2>
                <div className="p-4 bg-secondary rounded-lg">
                  <div className="flex items-center gap-3 mb-2">
                    <Lock className="w-5 h-5 text-amber-600" />
                    <h3 className="font-medium text-foreground">Изменить пароль</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">Рекомендуем регулярно менять пароль.</p>
                  <div className="space-y-3">
                    <input type="password" className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" placeholder="Текущий пароль" />
                    <input type="password" className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" placeholder="Новый пароль" />
                    <input type="password" className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" placeholder="Подтвердите" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {showPercentLock && (
        <div className="fixed inset-0 bg-foreground/30 flex items-center justify-center z-[100]" onClick={() => setShowPercentLock(false)}>
          <div className="bg-card rounded-2xl p-6 w-80 border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <Lock className="w-5 h-5 text-emerald-600" />
              <h3 className="text-foreground font-semibold">Блокировка процента</h3>
            </div>
            <input type="password" value={percentCode}
              onChange={(e) => { setPercentCode(e.target.value); setPercentError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleLockPercent()}
              className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground text-center text-lg tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-3"
              placeholder="••••" autoFocus />
            {percentError && <p className="text-red-600 text-sm mb-3">{percentError}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setShowPercentLock(false); setPercentCode(''); setPercentError(''); }}
                className="flex-1 bg-secondary hover:bg-border text-foreground py-2 rounded-lg transition-all text-sm">Отмена</button>
              <button onClick={handleLockPercent}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg transition-all flex items-center justify-center gap-1 text-sm">
                <Check className="w-4 h-4" /> Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
