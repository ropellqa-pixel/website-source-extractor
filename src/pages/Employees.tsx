import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../lib/auth';
import { db, auth } from '@/lib/sdk';
import { createVkBindCode, getVkStatus, unbindVk } from '../lib/vkBinding';
import { PIN_ADPODS } from '../lib/pinAdpods';
import { listDevices, linkDevice, revokeDevice, setEmployeePassword, type Device } from '../lib/devices';
import {
  Users, UserPlus, Search, Trash2, Shield, Pencil,
  MoreVertical, Check, X, KeyRound, Plus, Copy, RefreshCw, LogIn,
  AlertTriangle, CheckCircle2, ExternalLink, MessageCircle, Loader2, Monitor
} from 'lucide-react';

interface EmployeeProfile {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  role: 'deputy_director' | 'senior_employee' | 'employee';
  department: string;
  status: 'active' | 'inactive';
  has_system_access: boolean;
  vk_id: string | null;
  vk_link: string | null;
}

interface PinCode {
  id: string;
  user_id: string;
  pin: string;
  email: string;
  shortcut_code: string;
  adpod_slug?: string | null;
}

interface VkBinding {
  id: string;
  profile_id: string;
  vk_user_id: number | null;
  vk_link: string | null;
  status: string;
  message: string | null;
}

function generatePin(): string {
  let result = '';
  for (let i = 0; i < 4; i++) result += Math.floor(Math.random() * 10).toString();
  return result;
}

function getErrorMessage(err: any): string {
  if (typeof err === 'string') return err;
  if (err?.message) return err.message;
  if (err?.error?.message) return err.error.message;
  if (err?.code) return `Ошибка БД: ${err.code}`;
  return 'Неизвестная ошибка';
}

function resolveUserId(authUuid: string): string {
  if (authUuid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authUuid)) {
    return authUuid;
  }
  return crypto.randomUUID();
}

export default function Employees() {
  const { refreshRoles } = useAuth();
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [pins, setPins] = useState<PinCode[]>([]);
  const [vkBindings, setVkBindings] = useState<VkBinding[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<EmployeeProfile | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeProfile | null>(null);
  const [showMenu, setShowMenu] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [vkLinkInput, setVkLinkInput] = useState('');
  const [bindCode, setBindCode] = useState<string | null>(null);
  const [selectedAdpodSlug, setSelectedAdpodSlug] = useState<string>('');
  const [generatingCode, setGeneratingCode] = useState(false);

  const [showDevicesModal, setShowDevicesModal] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [linkingDevice, setLinkingDevice] = useState<Device | null>(null);
  const [linkProfileId, setLinkProfileId] = useState('');
  const [linkPassword, setLinkPassword] = useState('');
  const [linkSaving, setLinkSaving] = useState(false);
  const [revealedDeviceToken, setRevealedDeviceToken] = useState<{ token: string; name: string } | null>(null);
  const [passwordDevice, setPasswordDevice] = useState<Device | null>(null);
  const [newDevicePassword, setNewDevicePassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [newEmployee, setNewEmployee] = useState({
    fullName: '',
    email: '',
    role: 'employee' as const,
    department: '',
    hasSystemAccess: false,
    password: '',
  });
  const [editEmployee, setEditEmployee] = useState({
    fullName: '',
    email: '',
    role: 'employee' as string,
    department: '',
    status: 'active' as string,
    hasSystemAccess: false,
  });

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const roleLabels: Record<string, string> = {
    deputy_director: 'Зам. директора',
    senior_employee: 'Старший сотрудник',
    employee: 'Сотрудник',
  };

  const roleColors: Record<string, string> = {
    deputy_director: 'from-amber-500 to-amber-600',
    senior_employee: 'from-blue-500 to-blue-600',
    employee: 'from-slate-500 to-slate-600',
  };

  const departments = ['Руководство', 'Отдел продаж', 'Бухгалтерия', 'IT', 'Маркетинг', 'HR'];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(null);
      }
    };
    if (showMenu) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: profs, error: profErr } = await db.from('profiles').select('*').order('created_at', { ascending: false });
      if (profErr) console.error('[Employees] Profiles error:', profErr);
      const profileList = (profs as EmployeeProfile[]) || [];
      if (profs) setEmployees(profileList);

      const { data: pc, error: pcErr } = await db.from('pin_codes').select('*');
      if (pcErr) console.error('[Employees] Pin codes error:', pcErr);
      if (pc) setPins(pc as PinCode[]);

      // Статусы привязки VK хранятся на сервере (подтверждает бот), запрашиваем по каждому сотруднику
      const statuses = await Promise.all(profileList.map(p => getVkStatus(p.id)));
      const bindings: VkBinding[] = [];
      profileList.forEach((p, i) => {
        const s = statuses[i];
        if (s?.binding) {
          bindings.push({
            id: p.id,
            profile_id: p.id,
            vk_user_id: s.binding.vk_user_id,
            vk_link: s.binding.vk_link,
            status: s.binding.status,
            message: s.binding.message,
          });
        }
      });
      setVkBindings(bindings);
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      await refreshRoles();
      await loadData();
    };
    init();
  }, []);

  const filteredEmployees = employees.filter(emp =>
    (emp.full_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (emp.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (emp.department || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAddEmployee = async () => {
    if (!newEmployee.fullName || !newEmployee.email) return;
    setSaving(true);
    try {
      let authUserId = '';

      if (newEmployee.hasSystemAccess && newEmployee.password) {
        try {
          const result = await auth.signUpWithPassword({
            email: newEmployee.email,
            password: newEmployee.password,
          });
          if (result.needs_email_confirmation) {
            showToast('Аккаунт создан. Пользователь должен подтвердить email.', 'success');
          }
          if (result.user) {
            authUserId = result.user.id;
          }
        } catch (authErr: any) {
          console.error('Auth signup error:', authErr);
          showToast(`Ошибка создания аккаунта: ${getErrorMessage(authErr)}`, 'error');
          setSaving(false);
          return;
        }
      }

      const userId = resolveUserId(authUserId);

      const { error: insertErr } = await db.from('profiles').insert({
        full_name: newEmployee.fullName,
        email: newEmployee.email,
        role: newEmployee.role,
        department: newEmployee.department,
        status: 'active',
        has_system_access: newEmployee.hasSystemAccess,
        user_id: userId,
      }).select();

      if (insertErr) {
        console.error('Insert error:', JSON.stringify(insertErr));
        showToast(`Ошибка сохранения: ${getErrorMessage(insertErr)}`, 'error');
        setSaving(false);
        return;
      }

      setShowAddModal(false);
      setNewEmployee({ fullName: '', email: '', role: 'employee', department: '', hasSystemAccess: false, password: '' });
      showToast('Сотрудник добавлен');
      await loadData();
    } catch (err: any) {
      console.error('Add employee error:', err);
      showToast(`Ошибка: ${getErrorMessage(err)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleEditEmployee = async () => {
    if (!selectedEmployee) return;
    setSaving(true);
    try {
      const { error } = await db.from('profiles').update({
        full_name: editEmployee.fullName,
        email: editEmployee.email,
        role: editEmployee.role,
        department: editEmployee.department,
        status: editEmployee.status,
        has_system_access: editEmployee.hasSystemAccess,
      }).eq('id', selectedEmployee.id);

      if (error) {
        showToast(`Ошибка: ${getErrorMessage(error)}`, 'error');
        setSaving(false);
        return;
      }

      setShowEditModal(false);
      setSelectedEmployee(null);
      showToast('Данные обновлены');
      await loadData();
    } catch (err: any) {
      console.error('Edit employee error:', err);
      showToast(`Ошибка: ${getErrorMessage(err)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEmployee = async (emp: EmployeeProfile) => {
    try {
      await db.from('pin_codes').delete().eq('email', emp.email);
      await unbindVk(emp.id);
      const { error } = await db.from('profiles').delete().eq('id', emp.id);
      if (error) {
        showToast(`Ошибка удаления: ${getErrorMessage(error)}`, 'error');
        return;
      }
      setShowDeleteConfirm(null);
      setShowMenu(null);
      showToast('Сотрудник удалён');
      await loadData();
    } catch (err) {
      console.error('Delete employee error:', err);
      showToast('Ошибка удаления', 'error');
    }
  };

  const openEditModal = (emp: EmployeeProfile) => {
    setSelectedEmployee(emp);
    setEditEmployee({
      fullName: emp.full_name,
      email: emp.email,
      role: emp.role,
      department: emp.department,
      status: emp.status,
      hasSystemAccess: emp.has_system_access,
    });
    setVkLinkInput(emp.vk_link || '');
    getVkStatus(emp.id).then(s => setBindCode(s?.code || null)).catch(() => setBindCode(null));
    setShowEditModal(true);
    setShowMenu(null);
  };

  /** Генерация кода привязки VK */
  const handleGenerateBindCode = async () => {
    if (!selectedEmployee) return;
    setGeneratingCode(true);
    try {
      const code = await createVkBindCode(selectedEmployee.id);
      if (!code) {
        showToast('Ошибка генерации кода', 'error');
        return;
      }
      setBindCode(code);
      showToast('Код сгенерирован', 'success');
    } catch (err: any) {
      console.error('Generate bind code error:', err);
      showToast(`Ошибка: ${getErrorMessage(err)}`, 'error');
    } finally {
      setGeneratingCode(false);
    }
  };

  /** Отвязка VK */
  const handleUnbindVk = async () => {
    if (!selectedEmployee) return;
    try {
      await unbindVk(selectedEmployee.id);
      setVkLinkInput('');
      setBindCode(null);
      showToast('VK отвязан');
      await loadData();
    } catch (err) {
      showToast('Ошибка отвязки', 'error');
    }
  };

  const getBindingForEmployee = (emp: EmployeeProfile): VkBinding | undefined => {
    return vkBindings.find(b => b.profile_id === emp.id);
  };

  const loadDevices = async () => {
    setDevicesLoading(true);
    try {
      setDevices(await listDevices());
    } finally {
      setDevicesLoading(false);
    }
  };

  const openDevicesModal = () => {
    setShowDevicesModal(true);
    loadDevices();
  };

  const openLinkDevice = (device: Device) => {
    setLinkingDevice(device);
    setLinkProfileId('');
    setLinkPassword('');
  };

  const handleLinkDevice = async () => {
    if (!linkingDevice || !linkProfileId) return;
    const targetProfile = employees.find(e => e.id === linkProfileId);
    if (targetProfile && !targetProfile.user_id && linkPassword.length < 6) {
      showToast('У сотрудника ещё нет учётной записи — укажите пароль (не менее 6 символов)', 'error');
      return;
    }
    setLinkSaving(true);
    try {
      const result = await linkDevice(linkingDevice.device_code, linkProfileId, linkPassword);
      showToast(`Устройство привязано к ${result.profileName}`);
      setRevealedDeviceToken({ token: result.apiToken, name: result.profileName });
      setLinkingDevice(null);
      await loadDevices();
      await loadData();
    } catch (err) {
      showToast(`Ошибка привязки: ${getErrorMessage(err)}`, 'error');
    } finally {
      setLinkSaving(false);
    }
  };

  const handleRevokeDevice = async (device: Device) => {
    try {
      await revokeDevice(device.device_code);
      showToast('Доступ устройству отозван');
      await loadDevices();
    } catch (err) {
      showToast(`Ошибка отзыва: ${getErrorMessage(err)}`, 'error');
    }
  };

  const handleSetDevicePassword = async () => {
    if (!passwordDevice?.profile_id || newDevicePassword.length < 6) return;
    setPasswordSaving(true);
    try {
      await setEmployeePassword(passwordDevice.profile_id, newDevicePassword);
      showToast('Пароль обновлён');
      setPasswordDevice(null);
      setNewDevicePassword('');
    } catch (err) {
      showToast(`Ошибка: ${getErrorMessage(err)}`, 'error');
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleGeneratePin = async (employeeProfile: EmployeeProfile, adpodSlug: string) => {
    try {
      if (!employeeProfile.has_system_access) {
        showToast('У сотрудника нет доступа в систему', 'error');
        return null;
      }

      if (!adpodSlug) {
        showToast('Сначала выберите адресный поддомен (АдПод)', 'error');
        return null;
      }

      const email = employeeProfile.email;
      if (!email) {
        showToast('У сотрудника нет email', 'error');
        return null;
      }

      await db.from('pin_codes').delete().eq('email', email);

      let pin = generatePin();
      let attempts = 0;
      while (attempts < 50) {
        const { data: existing } = await db
          .from('pin_codes')
          .select('id')
          .eq('pin', pin)
          .limit(1);
        if (!existing || existing.length === 0) break;
        pin = generatePin();
        attempts++;
      }

      const pinUserId = resolveUserId(employeeProfile.user_id);

      const { error } = await db.from('pin_codes').insert({
        user_id: pinUserId,
        pin,
        email,
        shortcut_code: 'default',
        adpod_slug: adpodSlug,
      });

      if (error) {
        showToast(`Ошибка генерации пина: ${getErrorMessage(error)}`, 'error');
        return null;
      }

      showToast('Пин-код сгенерирован');
      await loadData();
      return pin;
    } catch (err) {
      console.error('Generate pin error:', err);
      showToast('Ошибка генерации пина', 'error');
      return null;
    }
  };

  const getPinForEmployee = (employee: EmployeeProfile) => {
    return pins.find(p => p.email === employee.email);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="min-h-full">
      {toast && (
        <div className={`fixed top-4 right-4 z-[200] px-4 py-3 rounded-lg shadow-xl flex items-center gap-2 text-sm font-medium transition-all ${
          toast.type === 'success' ? 'bg-emerald-500/90 text-white' : 'bg-red-500/90 text-white'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {toast.message}
        </div>
      )}

      <header className="bg-card backdrop-blur-sm border-b border-border sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-2 py-3 sm:h-16 sm:py-0">
            <div className="flex items-center gap-4">
              <a href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </a>
              <h1 className="text-xl font-bold text-foreground">Сотрудники</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={openDevicesModal}
                className="bg-secondary text-foreground px-4 py-2 rounded-lg font-medium hover:bg-border transition-all flex items-center gap-2"
              >
                <Monitor className="w-5 h-5" />
                Устройства
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="bg-primary text-white px-4 py-2 rounded-lg font-medium hover:bg-primary/85 transition-all flex items-center gap-2"
              >
                <UserPlus className="w-5 h-5" />
                Добавить
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-card rounded-xl p-4 border border-border">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center">
                <Users className="w-6 h-6 text-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{employees.length}</p>
                <p className="text-sm text-muted-foreground">Всего</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center">
                <Check className="w-6 h-6 text-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{employees.filter(e => e.status === 'active').length}</p>
                <p className="text-sm text-muted-foreground">Активных</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-violet-600 rounded-xl flex items-center justify-center">
                <LogIn className="w-6 h-6 text-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{employees.filter(e => e.has_system_access).length}</p>
                <p className="text-sm text-muted-foreground">С доступом</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-sky-500 to-sky-600 rounded-xl flex items-center justify-center">
                <MessageCircle className="w-6 h-6 text-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{vkBindings.filter(b => b.status === 'confirmed').length}</p>
                <p className="text-sm text-muted-foreground">VK привязано</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-card border border-border rounded-lg pl-10 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-base"
              placeholder="Поиск сотрудников..."
            />
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border overflow-visible">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-6 py-4 text-sm font-medium text-muted-foreground">Сотрудник</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-muted-foreground hidden md:table-cell">Роль</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-muted-foreground hidden lg:table-cell">Отдел</th>
                <th className="text-center px-6 py-4 text-sm font-medium text-muted-foreground hidden sm:table-cell">VK</th>
                <th className="text-center px-6 py-4 text-sm font-medium text-muted-foreground hidden sm:table-cell">Доступ</th>
                <th className="text-center px-6 py-4 text-sm font-medium text-muted-foreground hidden sm:table-cell">Пин-код</th>
                <th className="text-right px-6 py-4 text-sm font-medium text-muted-foreground">Действия</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">Загрузка...</td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">
                    {searchTerm ? 'Ничего не найдено' : 'Нет сотрудников. Нажмите «Добавить»'}
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((employee) => {
                  const empPin = getPinForEmployee(employee);
                  const binding = getBindingForEmployee(employee);
                  return (
                    <tr key={employee.id} className="border-b border-border hover:bg-secondary transition-all">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-gradient-to-br from-slate-600 to-slate-700 rounded-full flex items-center justify-center shrink-0">
                            <span className="text-sm font-medium text-foreground">
                              {(employee.full_name || '').split(' ').map(n => n[0]).join('').slice(0, 2)}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-foreground text-base truncate">{employee.full_name}</p>
                            <p className="text-sm text-muted-foreground truncate">{employee.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 hidden md:table-cell">
                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-gradient-to-r ${roleColors[employee.role] || roleColors.employee} text-white`}>
                          <Shield className="w-3 h-3" />
                          {roleLabels[employee.role] || employee.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 hidden lg:table-cell">
                        <span className="text-foreground/80">{employee.department || '—'}</span>
                      </td>
                      <td className="px-6 py-4 text-center hidden sm:table-cell">
                        {binding ? (
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                            binding.status === 'confirmed' 
                              ? 'bg-sky-500/20 text-sky-600' 
                              : 'bg-amber-500/20 text-amber-600'
                          }`}>
                            {binding.status === 'confirmed' ? <Check className="w-3 h-3" /> : <Loader2 className="w-3 h-3 animate-spin" />}
                            {binding.status === 'confirmed' ? 'Привязан' : 'Ожидание'}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center hidden sm:table-cell">
                        {employee.has_system_access ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-500/20 text-emerald-600 rounded-full text-xs font-medium">
                            <Check className="w-3 h-3" /> Есть
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-1 bg-muted text-muted-foreground rounded-full text-xs font-medium">
                            <X className="w-3 h-3" /> Нет
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center hidden sm:table-cell">
                        {empPin ? (
                          <div className="flex items-center justify-center gap-2">
                            <span className="font-mono text-amber-600 font-medium">{empPin.pin}</span>
                            <button
                              onClick={() => copyToClipboard(empPin.pin, `pin-${employee.id}`)}
                              className="text-muted-foreground hover:text-foreground transition-colors"
                              title="Копировать"
                            >
                              {copiedId === `pin-${employee.id}` ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="relative inline-block" ref={showMenu === employee.id ? menuRef : undefined}>
                          <button
                            onClick={() => setShowMenu(showMenu === employee.id ? null : employee.id)}
                            className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-all"
                          >
                            <MoreVertical className="w-5 h-5" />
                          </button>
                          {showMenu === employee.id && (
                            <div className="absolute right-0 top-full mt-1 w-56 bg-card border border-border rounded-lg shadow-2xl z-[100] overflow-hidden">
                              <button
                                onClick={() => openEditModal(employee)}
                                className="w-full px-4 py-2.5 text-left text-sm text-foreground hover:bg-secondary flex items-center gap-2 transition-colors"
                              >
                                <Pencil className="w-4 h-4 text-blue-600" />
                                Редактировать
                              </button>
                              <button
                                onClick={() => { setSelectedEmployee(employee); setSelectedAdpodSlug(''); setShowPinModal(true); setShowMenu(null); }}
                                className="w-full px-4 py-2.5 text-left text-sm text-foreground hover:bg-secondary flex items-center gap-2 transition-colors"
                                disabled={!employee.has_system_access}
                              >
                                <KeyRound className={`w-4 h-4 ${employee.has_system_access ? 'text-amber-600' : 'text-muted-foreground'}`} />
                                <span className={!employee.has_system_access ? 'text-muted-foreground' : ''}>Пин-код</span>
                              </button>
                              <div className="border-t border-border" />
                              <button
                                onClick={() => { setShowDeleteConfirm(employee); setShowMenu(null); }}
                                className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-500/10 flex items-center gap-2 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                                Удалить
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* Модалка добавления */}
      {showAddModal && (
        <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-[150] p-4">
          <div className="bg-card rounded-2xl p-6 w-full max-w-md border border-border max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-foreground mb-6">Добавить сотрудника</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">ФИО *</label>
                <input type="text" value={newEmployee.fullName} onChange={(e) => setNewEmployee({ ...newEmployee, fullName: e.target.value })} className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" placeholder="Иванов Иван Иванович" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Email *</label>
                <input type="email" value={newEmployee.email} onChange={(e) => setNewEmployee({ ...newEmployee, email: e.target.value })} className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" placeholder="email@company.ru" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Роль</label>
                <select value={newEmployee.role} onChange={(e) => setNewEmployee({ ...newEmployee, role: e.target.value as any })} className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base">
                  <option value="employee">Сотрудник</option>
                  <option value="senior_employee">Старший сотрудник</option>
                  <option value="deputy_director">Зам. директора</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Отдел</label>
                <select value={newEmployee.department} onChange={(e) => setNewEmployee({ ...newEmployee, department: e.target.value })} className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base">
                  <option value="">Выберите отдел</option>
                  {departments.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                </select>
              </div>
              <div className="border-t border-border pt-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={newEmployee.hasSystemAccess} onChange={(e) => setNewEmployee({ ...newEmployee, hasSystemAccess: e.target.checked })} className="w-5 h-5 rounded border-border text-blue-500 focus:ring-ring bg-secondary" />
                  <div>
                    <span className="text-sm font-medium text-foreground">Доступ в систему</span>
                    <p className="text-xs text-muted-foreground">Сотрудник сможет войти по email + пароль</p>
                  </div>
                </label>
              </div>
              {newEmployee.hasSystemAccess && (
                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-2">Пароль для входа *</label>
                  <input type="password" value={newEmployee.password} onChange={(e) => setNewEmployee({ ...newEmployee, password: e.target.value })} className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" placeholder="Минимум 6 символов" />
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={handleAddEmployee} disabled={saving || !newEmployee.fullName || !newEmployee.email || (newEmployee.hasSystemAccess && !newEmployee.password)} className="flex-1 bg-blue-500 text-white py-3 rounded-lg font-medium hover:bg-blue-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {saving ? 'Сохранение...' : 'Добавить'}
              </button>
              <button onClick={() => setShowAddModal(false)} className="flex-1 bg-secondary text-foreground py-3 rounded-lg font-medium hover:bg-border transition-all">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка редактирования */}
      {showEditModal && selectedEmployee && (
        <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-[150] p-4">
          <div className="bg-card rounded-2xl p-6 w-full max-w-lg border border-border max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-foreground">Редактировать сотрудника</h2>
              <button onClick={() => { setShowEditModal(false); setSelectedEmployee(null); }} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">ФИО</label>
                <input type="text" value={editEmployee.fullName} onChange={(e) => setEditEmployee({ ...editEmployee, fullName: e.target.value })} className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Email</label>
                <input type="email" value={editEmployee.email} onChange={(e) => setEditEmployee({ ...editEmployee, email: e.target.value })} className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Роль</label>
                <select value={editEmployee.role} onChange={(e) => setEditEmployee({ ...editEmployee, role: e.target.value })} className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base">
                  <option value="employee">Сотрудник</option>
                  <option value="senior_employee">Старший сотрудник</option>
                  <option value="deputy_director">Зам. директора</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Отдел</label>
                <select value={editEmployee.department} onChange={(e) => setEditEmployee({ ...editEmployee, department: e.target.value })} className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base">
                  <option value="">Без отдела</option>
                  {departments.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Статус</label>
                <select value={editEmployee.status} onChange={(e) => setEditEmployee({ ...editEmployee, status: e.target.value })} className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base">
                  <option value="active">Активен</option>
                  <option value="inactive">Неактивен</option>
                </select>
              </div>
              <div className="border-t border-border pt-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={editEmployee.hasSystemAccess} onChange={(e) => setEditEmployee({ ...editEmployee, hasSystemAccess: e.target.checked })} className="w-5 h-5 rounded border-border text-blue-500 focus:ring-ring bg-secondary" />
                  <div>
                    <span className="text-sm font-medium text-foreground">Доступ в систему</span>
                    <p className="text-xs text-muted-foreground">Сотрудник сможет войти по email + пароль</p>
                  </div>
                </label>
              </div>

              {/* === Секция привязки VK === */}
              <div className="border-t border-border pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <MessageCircle className="w-5 h-5 text-sky-600" />
                  <h3 className="text-sm font-medium text-foreground">Привязка VK</h3>
                </div>

                {(() => {
                  const binding = getBindingForEmployee(selectedEmployee);
                  if (binding && binding.status === 'confirmed') {
                    return (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 p-3 bg-secondary rounded-lg border border-border">
                          <CheckCircle2 className="w-5 h-5 text-sky-600 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-sky-700">Привязан</p>
                            <a href={binding.vk_link || ''} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground truncate block">
                              {binding.vk_link}
                            </a>
                          </div>
                        </div>
                        <button
                          onClick={handleUnbindVk}
                          className="w-full py-2 border border-red-500/30 rounded-lg text-sm text-red-600 hover:bg-red-500/10 transition-all flex items-center justify-center gap-2"
                        >
                          <X className="w-4 h-4" />
                          Отвязать VK
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-3">
                      {bindCode ? (
                        <div className="p-4 bg-secondary rounded-lg border border-sky-500/30 text-center">
                          <p className="text-xs text-muted-foreground mb-2">Код привязки</p>
                          <p className="font-mono text-3xl text-sky-600 tracking-widest font-bold">{bindCode}</p>
                          <p className="text-xs text-muted-foreground mt-2">
                            Сотрудник отправляет этот код боту VK
                          </p>
                        </div>
                      ) : (
                        <div className="p-3 bg-secondary rounded-lg border border-border text-center">
                          <p className="text-xs text-muted-foreground">
                            Нажмите «Создать код» — сотрудник получит 6-значный код для отправки боту
                          </p>
                        </div>
                      )}
                      <button
                        onClick={handleGenerateBindCode}
                        disabled={generatingCode}
                        className="w-full py-2.5 bg-sky-500/20 border border-sky-500/30 rounded-lg text-sm font-medium text-sky-700 hover:bg-sky-500/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {generatingCode ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Генерация...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-4 h-4" />
                            {bindCode ? 'Новый код' : 'Создать код'}
                          </>
                        )}
                      </button>
                      <div className="p-2.5 bg-secondary rounded-lg border border-border">
                        <p className="text-xs text-muted-foreground">
                          Сотрудник отправляет 6-значный код боту VK — привязка подтверждается автоматически.
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={handleEditEmployee} disabled={saving} className="flex-1 bg-blue-500 text-white py-3 rounded-lg font-medium hover:bg-blue-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button onClick={() => { setShowEditModal(false); setSelectedEmployee(null); }} className="flex-1 bg-secondary text-foreground py-3 rounded-lg font-medium hover:bg-border transition-all">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка удаления */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-[150] p-4">
          <div className="bg-card rounded-2xl p-6 w-full max-w-sm border border-border">
            <div className="text-center">
              <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">Удалить сотрудника?</h3>
              <p className="text-muted-foreground text-sm mb-6">
                <span className="font-medium text-foreground">{showDeleteConfirm.full_name}</span> будет удалён из системы.
              </p>
              <div className="flex gap-3">
                <button onClick={() => handleDeleteEmployee(showDeleteConfirm)} className="flex-1 bg-red-500 text-white py-3 rounded-lg font-medium hover:bg-red-600 transition-all">Удалить</button>
                <button onClick={() => setShowDeleteConfirm(null)} className="flex-1 bg-secondary text-foreground py-3 rounded-lg font-medium hover:bg-border transition-all">Отмена</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Модалка пин-кода */}
      {showPinModal && selectedEmployee && (
        <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-[150] p-4">
          <div className="bg-card rounded-2xl p-6 w-full max-w-md border border-border">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-foreground">Пин-код для входа</h2>
                <p className="text-sm text-muted-foreground mt-1">{selectedEmployee.full_name}</p>
              </div>
              <button onClick={() => { setShowPinModal(false); setSelectedEmployee(null); }} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>

            {!selectedEmployee.has_system_access && (
              <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-700">
                  У сотрудника нет доступа в систему. Пин-код не работает.
                </p>
              </div>
            )}

            <div className="text-center py-6">
              {(() => {
                const empPin = getPinForEmployee(selectedEmployee);
                if (empPin) {
                  const boundAdpod = PIN_ADPODS.find(a => a.slug === empPin.adpod_slug);
                  return (
                    <>
                      <p className="text-sm text-muted-foreground mb-3">Текущий пин-код:</p>
                      <div className="inline-flex items-center gap-3 p-4 bg-secondary rounded-xl">
                        <span className="font-mono text-4xl text-amber-600 tracking-widest font-bold">{empPin.pin}</span>
                        <button onClick={() => copyToClipboard(empPin.pin, `pin-modal-${selectedEmployee.id}`)} className="text-muted-foreground hover:text-foreground transition-colors p-2" title="Копировать">
                          {copiedId === `pin-modal-${selectedEmployee.id}` ? <Check className="w-5 h-5 text-emerald-600" /> : <Copy className="w-5 h-5" />}
                        </button>
                      </div>
                      {boundAdpod && (
                        <p className="text-xs text-muted-foreground mt-3">
                          Привязан к адресу: <span className="font-medium text-foreground">{boundAdpod.label}</span> ({boundAdpod.path})
                        </p>
                      )}

                      <div className="mt-5 pt-4 border-t border-border text-left">
                        <p className="text-xs text-muted-foreground mb-2">Чтобы сгенерировать новый пин, выберите адресный поддомен (АдПод) — привязку изменить нельзя, только пересоздать пин:</p>
                        <select
                          value={selectedAdpodSlug}
                          onChange={(e) => setSelectedAdpodSlug(e.target.value)}
                          className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500 mb-3"
                        >
                          <option value="">— Выберите АдПод —</option>
                          {PIN_ADPODS.map(a => (
                            <option key={a.slug} value={a.slug}>{a.label} ({a.path})</option>
                          ))}
                        </select>
                        <button
                          onClick={async () => { await handleGeneratePin(selectedEmployee, selectedAdpodSlug); setSelectedAdpodSlug(''); }}
                          disabled={!selectedEmployee.has_system_access || !selectedAdpodSlug}
                          className="w-full py-2 border border-dashed border-border rounded-lg text-sm text-muted-foreground hover:text-amber-600 hover:border-amber-500 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <RefreshCw className="w-4 h-4" />
                          Сгенерировать новый пин
                        </button>
                      </div>
                    </>
                  );
                } else {
                  return (
                    <>
                      <KeyRound className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                      <p className="text-muted-foreground mb-4">Пин-код ещё не создан</p>
                      <div className="text-left">
                        <p className="text-xs text-muted-foreground mb-2">Выберите адресный поддомен (АдПод), к которому будет привязан пин-код:</p>
                        <select
                          value={selectedAdpodSlug}
                          onChange={(e) => setSelectedAdpodSlug(e.target.value)}
                          className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500 mb-3"
                        >
                          <option value="">— Выберите АдПод —</option>
                          {PIN_ADPODS.map(a => (
                            <option key={a.slug} value={a.slug}>{a.label} ({a.path})</option>
                          ))}
                        </select>
                      </div>
                      <button
                        onClick={async () => { await handleGeneratePin(selectedEmployee, selectedAdpodSlug); setSelectedAdpodSlug(''); }}
                        disabled={!selectedEmployee.has_system_access || !selectedAdpodSlug}
                        className="w-full py-3 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Plus className="w-4 h-4" />
                        Создать пин-код
                      </button>
                    </>
                  );
                }
              })()}
            </div>

            <div className="mt-4 p-3 bg-secondary rounded-lg border border-border">
              <p className="text-xs text-muted-foreground text-center">
                Пин-код — ключ быстрого входа. Привязан к одному адресу входа: на нём вводятся только 4 цифры и сразу открывается личный кабинет.
              </p>
            </div>
          </div>
        </div>
      )}

      {showDevicesModal && (
        <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowDevicesModal(false)}>
          <div className="bg-card rounded-2xl p-6 w-full max-w-2xl border border-border max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                  <Monitor className="w-5 h-5" />
                  Устройства
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Компьютеры с установленной программой. Каждый показывает свой 9-значный код — привяжи его к сотруднику.
                </p>
              </div>
              <button onClick={() => setShowDevicesModal(false)} className="p-2 text-muted-foreground hover:text-foreground rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            {devicesLoading ? (
              <div className="py-10 text-center text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" /> Загрузка...
              </div>
            ) : devices.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground text-sm">
                Пока ни одно устройство не подключалось. Как только программа запустится на новом ПК, он появится здесь.
              </div>
            ) : (
              <div className="space-y-2">
                {devices.map(device => (
                  <div key={device.id} className="flex items-center justify-between gap-3 p-3 bg-secondary rounded-lg">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-foreground tracking-wider">{device.device_code}</span>
                        {device.status === 'linked' && (
                          <span className="text-xs px-2 py-0.5 bg-emerald-500/15 text-emerald-600 rounded-full font-medium">Привязано</span>
                        )}
                        {device.status === 'pending' && (
                          <span className="text-xs px-2 py-0.5 bg-amber-500/15 text-amber-600 rounded-full font-medium">Ожидает</span>
                        )}
                        {device.status === 'revoked' && (
                          <span className="text-xs px-2 py-0.5 bg-red-500/15 text-red-600 rounded-full font-medium">Отозвано</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {device.hostname || 'Без имени'}
                        {device.profile_name ? ` · ${device.profile_name}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {device.status === 'pending' && (
                        <button
                          onClick={() => openLinkDevice(device)}
                          className="px-3 py-1.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/85 transition-all"
                        >
                          Привязать
                        </button>
                      )}
                      {device.status === 'linked' && (
                        <>
                          <button
                            onClick={() => { setPasswordDevice(device); setNewDevicePassword(''); }}
                            className="px-3 py-1.5 bg-secondary border border-border text-foreground rounded-lg text-sm font-medium hover:bg-border transition-all"
                          >
                            Сменить пароль
                          </button>
                          <button
                            onClick={() => handleRevokeDevice(device)}
                            className="px-3 py-1.5 bg-red-500/10 text-red-600 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-all"
                          >
                            Отозвать
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {linkingDevice && (
        <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-[60] p-4" onClick={() => setLinkingDevice(null)}>
          <div className="bg-card rounded-2xl p-6 w-full max-w-md border border-border" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-foreground">Привязать устройство</h2>
              <button onClick={() => setLinkingDevice(null)} className="p-2 text-muted-foreground hover:text-foreground rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Код устройства: <span className="font-mono font-semibold text-foreground">{linkingDevice.device_code}</span>
            </p>
            <label className="block text-sm font-medium text-foreground/80 mb-2">Сотрудник</label>
            <select
              value={linkProfileId}
              onChange={(e) => setLinkProfileId(e.target.value)}
              className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground text-base focus:outline-none focus:ring-2 focus:ring-ring mb-4"
            >
              <option value="">— Выберите сотрудника —</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.full_name} {e.user_id ? '' : '(нет входа)'}</option>
              ))}
            </select>

            {linkProfileId && !employees.find(e => e.id === linkProfileId)?.user_id && (
              <>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Пароль для входа (у сотрудника ещё нет учётной записи)</label>
                <input
                  type="password"
                  value={linkPassword}
                  onChange={(e) => setLinkPassword(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground text-base focus:outline-none focus:ring-2 focus:ring-ring mb-4"
                  placeholder="Не менее 6 символов"
                />
              </>
            )}

            <button
              onClick={handleLinkDevice}
              disabled={!linkProfileId || linkSaving}
              className="w-full py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary/85 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {linkSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Привязать
            </button>
          </div>
        </div>
      )}

      {revealedDeviceToken && (
        <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-[70] p-4" onClick={() => setRevealedDeviceToken(null)}>
          <div className="bg-card rounded-2xl p-6 w-full max-w-md border border-border" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <h2 className="text-lg font-bold text-foreground">Устройство привязано</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Ключ для программы на ПК сотрудника «{revealedDeviceToken.name}». Введите его в настройках приложения — это единственный раз, когда он показан полностью.
            </p>
            <div className="flex items-center gap-2 mb-4">
              <input
                readOnly
                value={revealedDeviceToken.token}
                className="flex-1 bg-secondary border border-border rounded-lg px-4 py-3 text-foreground font-mono text-sm focus:outline-none"
              />
              <button
                onClick={() => { navigator.clipboard.writeText(revealedDeviceToken.token); showToast('Скопировано'); }}
                className="p-3 bg-secondary border border-border rounded-lg text-muted-foreground hover:text-foreground transition-all"
              >
                <Copy className="w-5 h-5" />
              </button>
            </div>
            <button
              onClick={() => setRevealedDeviceToken(null)}
              className="w-full py-2.5 bg-secondary text-foreground rounded-lg font-medium hover:bg-border transition-all"
            >
              Готово
            </button>
          </div>
        </div>
      )}

      {passwordDevice && (
        <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-[70] p-4" onClick={() => setPasswordDevice(null)}>
          <div className="bg-card rounded-2xl p-6 w-full max-w-md border border-border" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-foreground">Сменить пароль</h2>
              <button onClick={() => setPasswordDevice(null)} className="p-2 text-muted-foreground hover:text-foreground rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Новый пароль для входа сотрудника «{passwordDevice.profile_name}» на сайте anod.saou.ru.
            </p>
            <input
              type="password"
              value={newDevicePassword}
              onChange={(e) => setNewDevicePassword(e.target.value)}
              className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground text-base focus:outline-none focus:ring-2 focus:ring-ring mb-4"
              placeholder="Не менее 6 символов"
            />
            <button
              onClick={handleSetDevicePassword}
              disabled={newDevicePassword.length < 6 || passwordSaving}
              className="w-full py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary/85 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {passwordSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Сохранить пароль
            </button>
          </div>
        </div>
      )}
    </div>
  );
}