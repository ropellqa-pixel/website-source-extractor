import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../lib/auth';
import { db } from '@/lib/sdk';
import { getAllVkBindings } from '../lib/vkBinding';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, Trash2, Banknote, Calculator,
  Save, Lock, Send, Settings2, Unlock, UserCheck, Loader2, CheckCircle
} from 'lucide-react';
import func2url from '../../backend/func2url.json';

const VK_API_URL = func2url['vk-api'];

interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: string;
  department: string;
  status: string;
  vk_id: string;
}

interface SalaryRow {
  id?: string;
  profile_id: string;
  hours_worked: number;
  revenue: number;
  days_in_month: number;
  vacation_pay: number;
  non_cash: number;
  overtime: number;
  tax: number;
  underpayment: number;
  month_year: string;
  responsible_user_id?: string;
  user_id?: string;
}

interface ManagerRow {
  id?: string;
  profile_id: string;
  osn_hours: number;
  dop_hours: number;
  doplaty: number;
  vacation_pay: number;
  non_cash: number;
  underpayment: number;
  hourly_rate: number;
  month_year: string;
  user_id?: string;
}

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function getDaysForMonth(month: number, year: number): number {
  if (month === 2 && ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)) return 29;
  return DAYS_IN_MONTH[month - 1] || 30;
}

function fmt(n: number) {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadGlobalSettings() {
  const { data } = await db.from('salary_settings').select('*').is('month_year', null).limit(1);
  if (data && data.length > 0) return data[0];
  return null;
}

async function loadGlobalManagerSettings() {
  const { data } = await db.from('manager_settings').select('*').is('month_year', null).limit(1);
  if (data && data.length > 0) return data[0];
  return null;
}

export default function Salary() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isDeputy = user?.role === 'deputy_director';
  const isDirector = user?.role === 'director';

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const selectedPeriod = `${String(selectedMonth).padStart(2, '0')}.${selectedYear}`;

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [salaryRows, setSalaryRows] = useState<SalaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newProfileId, setNewProfileId] = useState('');

  const [globalPercent, setGlobalPercent] = useState(2.5);
  const [responsibleId, setResponsibleId] = useState<string | null>(null);

  const [revenue, setRevenue] = useState(0);
  const [daysInMonth, setDaysInMonth] = useState(30);
  const [periodSettingsId, setPeriodSettingsId] = useState<string | null>(null);
  const [periodLocked, setPeriodLocked] = useState(false);

  const [showFullTable, setShowFullTable] = useState(false);

  // Manager section
  const [managerRows, setManagerRows] = useState<ManagerRow[]>([]);
  const [managerPercent, setManagerPercent] = useState(5);
  const [managerSettingsId, setManagerSettingsId] = useState<string | null>(null);
  const [managerLocked, setManagerLocked] = useState(false);
  const [managerResponsibleId, setManagerResponsibleId] = useState<string | null>(null);
  const [showManagerLock, setShowManagerLock] = useState(false);
  const [unlockCode, setUnlockCode] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [newManagerProfileId, setNewManagerProfileId] = useState('');

  // Broadcast state
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState('');

  const years = useMemo(() => {
    const y = now.getFullYear();
    return Array.from({ length: 5 }, (_, i) => y - 2 + i);
  }, []);

  useEffect(() => { loadData(); }, [selectedPeriod]);

  useEffect(() => {
    if (!periodSettingsId) {
      setDaysInMonth(getDaysForMonth(selectedMonth, selectedYear));
    }
  }, [selectedMonth, selectedYear, periodSettingsId]);

  async function loadData() {
    setLoading(true);
    try {
      const [profilesRes, rowsRes, periodSettingsRes, globalSettings, managerRowsRes, mgrPeriodSettings, mgrGlobalSettings] = await Promise.all([
        db.from('profiles').select('*'),
        db.from('salary_data').select('*').eq('month_year', selectedPeriod),
        db.from('salary_settings').select('*').eq('month_year', selectedPeriod).maybeSingle(),
        loadGlobalSettings(),
        db.from('manager_data').select('*').eq('month_year', selectedPeriod),
        db.from('manager_settings').select('*').eq('month_year', selectedPeriod).maybeSingle(),
        loadGlobalManagerSettings(),
      ]);

      if (profilesRes.data) setProfiles(profilesRes.data as Profile[]);
      if (rowsRes.data) setSalaryRows(rowsRes.data as SalaryRow[]);

      if (globalSettings) {
        setGlobalPercent((globalSettings.percent as number) ?? 2.5);
        setResponsibleId((globalSettings.responsible_profile_id as string) || null);
      }

      if (periodSettingsRes.data) {
        const p = periodSettingsRes.data as Record<string, unknown>;
        setRevenue((p.revenue as number) || 0);
        setDaysInMonth((p.days_in_month as number) || getDaysForMonth(selectedMonth, selectedYear));
        setPeriodSettingsId((p.id as string) || null);
        setPeriodLocked(!!p.is_locked);
      } else {
        setRevenue(0);
        setDaysInMonth(getDaysForMonth(selectedMonth, selectedYear));
        setPeriodSettingsId(null);
        setPeriodLocked(false);
      }

      if (mgrGlobalSettings) {
        setManagerPercent((mgrGlobalSettings.manager_percent as number) ?? 5);
        setManagerResponsibleId((mgrGlobalSettings.responsible_profile_id as string) || null);
      }

      if (mgrPeriodSettings.data) {
        const ms = mgrPeriodSettings.data as Record<string, unknown>;
        setManagerLocked(!!ms.is_locked);
        setManagerSettingsId((ms.id as string) || null);
      } else {
        setManagerLocked(false);
        setManagerSettingsId(null);
      }

      if (managerRowsRes.data && managerRowsRes.data.length > 0) {
        setManagerRows(managerRowsRes.data as ManagerRow[]);
      } else {
        setManagerRows([]);
      }

      if ((!rowsRes.data || rowsRes.data.length === 0) && profilesRes.data && profilesRes.data.length > 0) {
        await copyRowsFromPreviousPeriod(profilesRes.data);
      }

      if ((!managerRowsRes.data || managerRowsRes.data.length === 0) && profilesRes.data) {
        await copyManagerRowsFromPreviousPeriod(profilesRes.data);
      }
    } catch (e) {
      console.error('Load error:', e);
    } finally {
      setLoading(false);
    }
  }

  async function copyRowsFromPreviousPeriod(allProfiles: Profile[]) {
    try {
      const { data: allExistingRows } = await db.from('salary_data')
        .select('month_year').not('month_year', 'is', null).neq('month_year', selectedPeriod)
        .order('month_year', { ascending: false });
      const periods = [...new Set((allExistingRows || []).map((r: Record<string, unknown>) => r.month_year as string))].sort().reverse();
      let profilesToUse: string[] = [];
      if (periods.length > 0) {
        const { data: prevRows } = await db.from('salary_data').select('profile_id').eq('month_year', periods[0]);
        if (prevRows && prevRows.length > 0) profilesToUse = [...new Set(prevRows.map((r: Record<string, unknown>) => r.profile_id as string))] as string[];
      }
      if (profilesToUse.length === 0) profilesToUse = allProfiles.filter(p => p.role !== 'director').map(p => p.id);
      const newRows = profilesToUse.map(pid => ({
        profile_id: pid, hours_worked: 0, revenue: 0, days_in_month: 0,
        vacation_pay: 0, non_cash: 0, overtime: 0, tax: 0, underpayment: 0,
        month_year: selectedPeriod, responsible_user_id: responsibleId,
        user_id: user?.id || '00000000-0000-0000-0000-000000000000',
      }));
      const { data: inserted } = await db.from('salary_data').insert(newRows).select();
      if (inserted) setSalaryRows(inserted as SalaryRow[]);
    } catch (e) { console.error('Copy rows error:', e); }
  }

  async function copyManagerRowsFromPreviousPeriod(allProfiles: Profile[]) {
    try {
      const { data: allExisting } = await db.from('manager_data')
        .select('month_year').not('month_year', 'is', null).neq('month_year', selectedPeriod)
        .order('month_year', { ascending: false });
      const periods = [...new Set((allExisting || []).map((r: Record<string, unknown>) => r.month_year as string))].sort().reverse();
      let profilesToUse: string[] = [];
      if (periods.length > 0) {
        const { data: prevRows } = await db.from('manager_data').select('profile_id').eq('month_year', periods[0]);
        if (prevRows && prevRows.length > 0) profilesToUse = [...new Set(prevRows.map((r: Record<string, unknown>) => r.profile_id as string))] as string[];
      }
      if (profilesToUse.length === 0) {
        profilesToUse = allProfiles.filter(p => p.role !== 'director').map(p => p.id);
      }
      if (profilesToUse.length === 0) return;
      const newRows = profilesToUse.map(pid => ({
        profile_id: pid, osn_hours: 0, dop_hours: 0, doplaty: 0,
        vacation_pay: 0, non_cash: 0, underpayment: 0, hourly_rate: 0,
        month_year: selectedPeriod,
        user_id: user?.id || '00000000-0000-0000-0000-000000000000',
      }));
      const { data: inserted } = await db.from('manager_data').insert(newRows).select();
      if (inserted) setManagerRows(inserted as ManagerRow[]);
    } catch (e) { console.error('Copy manager rows error:', e); }
  }

  const locked = periodLocked;

  function isResponsiblePerson(): boolean {
    if (!responsibleId || !user?.profileId) return false;
    return user.profileId === responsibleId;
  }

  function canEditHours(): boolean { return !locked && (isDeputy || isResponsiblePerson()); }
  function canEditVacation(): boolean { return !locked && (isDeputy || isResponsiblePerson()); }
  function canEditNonCash(): boolean { return !locked && (isDeputy || isResponsiblePerson()); }
  function canEditOvertime(): boolean { return !locked && (isDeputy || isResponsiblePerson()); }
  function canEditTax(): boolean { return !locked && (isDeputy || isResponsiblePerson()); }
  function canEditUnderpayment(): boolean { return !locked && (isDeputy || isResponsiblePerson()); }
  function canEditRevenueDays(): boolean { return !locked && (isDeputy || isResponsiblePerson()); }
  function canAddDeleteRow(): boolean { return !locked && isDeputy; }

  function isManagerResponsible(): boolean {
    if (!managerResponsibleId || !user?.profileId) return false;
    return user.profileId === managerResponsibleId;
  }
  function canEditManager(): boolean { return !managerLocked && (isDeputy || isManagerResponsible()); }
  function canEditManagerHours(): boolean { return canEditManager(); }
  function canEditManagerDopHours(): boolean { return canEditManager(); }
  function canEditManagerNonCash(): boolean { return canEditManager(); }
  function canEditManagerUnderpayment(): boolean { return !managerLocked && (isDeputy || isManagerResponsible()); }

  const employeeRate = useMemo(() => {
    const k2 = daysInMonth * 24;
    return k2 > 0 ? (revenue / k2) * ((globalPercent || 0) / 100) : 0;
  }, [revenue, daysInMonth, globalPercent]);

  const managerRate = useMemo(() => {
    return employeeRate * (1 + (managerPercent || 0) / 100);
  }, [employeeRate, managerPercent]);

  const calculatedRows = useMemo(() => {
    const k2 = daysInMonth * 24;
    const pct = globalPercent || 0;
    const d = k2 > 0 ? (revenue / k2) * (pct / 100) : 0;
    return salaryRows.map(row => {
      const b = row.hours_worked || 0;
      const e = row.vacation_pay || 0;
      const f = row.non_cash || 0;
      const g = row.overtime || 0;
      const h = row.tax || 0;
      const u = row.underpayment || 0;
      const i = (d * b + e) - f - g - h + u;
      const j = i / 4;
      return { ...row, d, i, j };
    });
  }, [salaryRows, revenue, daysInMonth, globalPercent]);

  const calculatedManagerRows = useMemo(() => {
    return managerRows.map(row => {
      const osn = row.osn_hours || 0;
      const dop = row.dop_hours || 0;
      const doplaty = row.doplaty || 0;
      const vacation = row.vacation_pay || 0;
      const bezNal = row.non_cash || 0;
      const u = row.underpayment || 0;
      const hr = managerRate;
      const itog = (((osn * hr) + vacation) - bezNal) + doplaty + (dop * employeeRate) + u;
      const week = itog / 4;
      return { ...row, hr, itog, week };
    });
  }, [managerRows, managerRate, employeeRate]);

  const totals = useMemo(() => {
    return calculatedRows.reduce((acc, r) => ({
      hours: acc.hours + (r.hours_worked || 0),
      underpayment: acc.underpayment + (r.underpayment || 0),
      i: acc.i + r.i,
      j: acc.j + r.j,
    }), { hours: 0, underpayment: 0, i: 0, j: 0 });
  }, [calculatedRows]);

  const managerTotals = useMemo(() => {
    return calculatedManagerRows.reduce((acc, r) => ({
      osn: acc.osn + (r.osn_hours || 0),
      dop: acc.dop + (r.dop_hours || 0),
      underpayment: acc.underpayment + (r.underpayment || 0),
      itog: acc.itog + r.itog,
      week: acc.week + r.week,
    }), { osn: 0, dop: 0, underpayment: 0, itog: 0, week: 0 });
  }, [calculatedManagerRows]);

  const showExpanded = isDeputy || isResponsiblePerson() || showFullTable;

  function getProfileName(id: string) { return profiles.find(p => p.id === id)?.full_name || '—'; }
  function getProfileById(id: string) { return profiles.find(p => p.id === id); }

  const k2 = daysInMonth * 24;
  const dRate = k2 > 0 ? (revenue / k2) * ((globalPercent || 0) / 100) : 0;

  async function addRow() {
    if (!newProfileId || !canAddDeleteRow()) return;
    const { data, error } = await db.from('salary_data').insert({
      profile_id: newProfileId, hours_worked: 0, revenue: 0, days_in_month: 0,
      vacation_pay: 0, non_cash: 0, overtime: 0, tax: 0, underpayment: 0,
      month_year: selectedPeriod, responsible_user_id: responsibleId,
      user_id: user?.id || '00000000-0000-0000-0000-000000000000',
    }).select().single();
    if (data && !error) { setSalaryRows(prev => [...prev, data as SalaryRow]); setNewProfileId(''); }
  }

  async function deleteRow(id: string) {
    if (!canAddDeleteRow()) return;
    const { error } = await db.from('salary_data').delete().eq('id', id);
    if (!error) setSalaryRows(prev => prev.filter(r => r.id !== id));
  }

  async function updateCell(id: string, field: string, value: number) {
    setSalaryRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    await db.from('salary_data').update({ [field]: value }).eq('id', id);
  }

  async function updateRevenue(value: number) {
    setRevenue(value);
    if (periodSettingsId) await db.from('salary_settings').update({ revenue: value }).eq('id', periodSettingsId);
  }

  async function updateDays(value: number) {
    setDaysInMonth(value);
    if (periodSettingsId) await db.from('salary_settings').update({ days_in_month: value }).eq('id', periodSettingsId);
  }

  async function updateManagerCell(id: string, field: string, value: number) {
    setManagerRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    await db.from('manager_data').update({ [field]: value }).eq('id', id);
  }

  async function addManagerRow() {
    if (!isDeputy) return;
    if (!newManagerProfileId) return;
    const { data, error } = await db.from('manager_data').insert({
      profile_id: newManagerProfileId, osn_hours: 0, dop_hours: 0, doplaty: 0,
      vacation_pay: 0, non_cash: 0, underpayment: 0, hourly_rate: 0,
      month_year: selectedPeriod,
      user_id: user?.id || '00000000-0000-0000-0000-000000000000',
    }).select().single();
    if (data && !error) { setManagerRows(prev => [...prev, data as ManagerRow]); setNewManagerProfileId(''); }
  }

  async function deleteManagerRow(id: string) {
    if (!isDeputy) return;
    const { error } = await db.from('manager_data').delete().eq('id', id);
    if (!error) setManagerRows(prev => prev.filter(r => r.id !== id));
  }

  async function saveAll() {
    if (!isDeputy && !isResponsiblePerson()) return;
    setSaving(true);
    try {
      if (periodSettingsId) {
        await db.from('salary_settings').update({ revenue, days_in_month: daysInMonth, is_locked: true }).eq('id', periodSettingsId);
      } else {
        const { data } = await db.from('salary_settings').insert({
          revenue, days_in_month: daysInMonth, percent: globalPercent,
          month_year: selectedPeriod, is_locked: true,
          responsible_profile_id: responsibleId,
        }).select().single();
        if (data) setPeriodSettingsId((data as Record<string, unknown>).id as string);
      }
      for (const row of salaryRows) {
        if (row.id) {
          await db.from('salary_data').update({
            hours_worked: row.hours_worked, vacation_pay: row.vacation_pay,
            non_cash: row.non_cash, overtime: row.overtime, tax: row.tax,
            underpayment: row.underpayment || 0,
          }).eq('id', row.id);
        }
      }

      if (managerSettingsId) {
        await db.from('manager_settings').update({ is_locked: true }).eq('id', managerSettingsId);
      } else {
        const { data } = await db.from('manager_settings').insert({
          manager_percent: managerPercent, is_locked: true, month_year: selectedPeriod,
          responsible_profile_id: managerResponsibleId,
        }).select().single();
        if (data) setManagerSettingsId((data as Record<string, unknown>).id as string);
      }
      for (const row of managerRows) {
        if (row.id) {
          await db.from('manager_data').update({
            osn_hours: row.osn_hours, dop_hours: row.dop_hours,
            doplaty: row.doplaty, vacation_pay: row.vacation_pay, non_cash: row.non_cash,
            underpayment: row.underpayment || 0,
          }).eq('id', row.id);
        }
      }

      setPeriodLocked(true);
      setManagerLocked(true);
    } finally { setSaving(false); }
  }

  function handleUnlockManager() {
    if (unlockCode === '2535') {
      setManagerLocked(false);
      if (managerSettingsId) db.from('manager_settings').update({ is_locked: false }).eq('id', managerSettingsId);
      setShowManagerLock(false);
      setUnlockCode('');
      setUnlockError('');
    } else {
      setUnlockError('Неверный код');
      setUnlockCode('');
    }
  }

  // === BROADCAST SALARY ===
  // Каждая строка зарплаты (по ФИО = profile_id) отправляется строго тому сотруднику,
  // которому принадлежит эта строка — никаких сводных рассылок всем.
  const DIVIDER = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

  function buildEmployeeMessage(row: any, profile: Profile, monthName: string, responsibleName: string): string {
    return [
      '💰 РАСЧЁТ ЗАРПЛАТЫ',
      DIVIDER,
      `🏢 АнодБИЗ · ${monthName} ${selectedYear}`,
      '',
      `👤 Сотрудник: ${profile.full_name}`,
      `👔 Ответственный: ${responsibleName}`,
      '',
      `⏱ Часы: ${row.hours_worked || 0}`,
      `💵 Час/Руб: ${fmt(row.d)}`,
      `🌴 Отпускные: ${fmt(row.vacation_pay || 0)}`,
      `💳 Безнал: ${fmt(row.non_cash || 0)}`,
      `📈 Перебор: ${fmt(row.overtime || 0)}`,
      `📉 Налог: ${fmt(row.tax || 0)}`,
      row.underpayment ? `⚠️ Недоплата: ${fmt(row.underpayment)}` : '',
      DIVIDER,
      `✅ ИТОГО: ${fmt(row.i)} ₽`,
    ].filter(Boolean).join('\n');
  }

  function buildManagerMessage(row: any, profile: Profile, monthName: string, responsibleName: string): string {
    return [
      '💰 РАСЧЁТ ЗАРПЛАТЫ',
      DIVIDER,
      `🏢 АнодБИЗ · ${monthName} ${selectedYear}`,
      '',
      `👤 Сотрудник: ${profile.full_name}`,
      `👔 Ответственный: ${responsibleName}`,
      '',
      `⏱ Часы (ОСН): ${row.osn_hours || 0}`,
      `⏱ Часы (ДОП): ${row.dop_hours || 0}`,
      `💵 Час/Руб: ${fmt(row.hr)}`,
      `➕ Доплаты: ${fmt(row.doplaty || 0)}`,
      `🌴 Отпускные: ${fmt(row.vacation_pay || 0)}`,
      `💳 Безнал: ${fmt(row.non_cash || 0)}`,
      row.underpayment ? `⚠️ Недоплата: ${fmt(row.underpayment)}` : '',
      DIVIDER,
      `✅ ИТОГО: ${fmt(row.itog)} ₽`,
    ].filter(Boolean).join('\n');
  }

  async function handleDistributeSalary() {
    setBroadcasting(true);
    setBroadcastResult('');
    try {
      const responsibleName = responsibleId ? getProfileName(responsibleId) : '—';
      const monthName = MONTHS[selectedMonth - 1];
      const items: { vk_user_id: string; message: string }[] = [];
      let skipped = 0;

      // Привязки VK хранятся отдельно на сервере (подтверждает бот) — берём их одним запросом
      const vkBindings = await getAllVkBindings();

      for (const row of calculatedRows) {
        const profile = getProfileById(row.profile_id);
        const vkUserId = profile ? vkBindings[profile.id] : undefined;
        if (!profile || !vkUserId) { skipped++; continue; }

        items.push({ vk_user_id: vkUserId, message: buildEmployeeMessage(row, profile, monthName, responsibleName) });
      }

      // Строки менеджеров — тоже строго по ФИО, каждому своя строка
      for (const row of calculatedManagerRows) {
        const profile = getProfileById(row.profile_id);
        const vkUserId = profile ? vkBindings[profile.id] : undefined;
        if (!profile || !vkUserId) { skipped++; continue; }

        items.push({ vk_user_id: vkUserId, message: buildManagerMessage(row, profile, monthName, responsibleName) });
      }

      if (items.length === 0) {
        setBroadcastResult('✗ Ни у кого из списка зарплаты не привязан VK — рассылка не отправлена.');
        setTimeout(() => setBroadcastResult(''), 6000);
        return;
      }

      const res = await fetch(VK_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'broadcast', items }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Ошибка отправки');

      setBroadcastResult(
        '✓ Отправлено ' + result.sent + ' из ' + items.length + ' персональных расчётов' +
        (skipped > 0 ? '. Без VK: ' + skipped + '.' : '.') +
        (result.failed > 0 ? ' Не доставлено: ' + result.failed + '.' : '') +
        ' Каждому уходит только его строка.'
      );
    } catch (e) {
      console.error('Broadcast error:', e);
      setBroadcastResult('✗ Ошибка при отправке рассылки');
      setTimeout(() => setBroadcastResult(''), 5000);
    } finally {
      setBroadcasting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Загрузка данных...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full flex flex-col">
      <header className="bg-card backdrop-blur-sm border-b border-border sticky top-0 z-50">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate('/dashboard')} className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-all">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2">
                <Banknote className="w-6 h-6 text-emerald-600" />
                <h1 className="text-lg font-bold text-foreground">ЗАРПЛАТА</h1>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-foreground/80 font-medium">За</span>
                <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500">
                  {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                </select>
                <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500">
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div className="hidden md:flex items-center gap-4 text-xs text-muted-foreground">
                <span>₽/Час: <b className="text-emerald-600">{fmt(dRate)} ₽</b></span>
                <span>Сотр: <b className="text-foreground">{calculatedRows.length}</b></span>
                <span>Итого: <b className="text-emerald-700">{fmt(totals.i)} ₽</b></span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {periodLocked && (
                <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-500/10 px-2 py-1 rounded-lg">
                  <Lock className="w-3 h-3" /> Заблокировано
                </span>
              )}
              {isDirector && (
                <button onClick={() => setShowFullTable(!showFullTable)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${showFullTable ? 'bg-emerald-500 text-white' : 'bg-secondary text-foreground/80 hover:bg-border'}`}>
                  {showFullTable ? 'Скрыть' : 'ПОЛНАЯ'}
                </button>
              )}
              {isDeputy && (
                <a href="/settings" className="flex items-center gap-1 px-3 py-1.5 bg-secondary hover:bg-border text-foreground/80 text-xs font-medium rounded-lg transition-all">
                  <Settings2 className="w-3.5 h-3.5" /> Настройки ЗП
                </a>
              )}
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {isDirector ? '👁 Директор' : isDeputy ? '✏️ Зам. директора' : isResponsiblePerson() ? '✏️ Ответственный' : '👤 Сотрудник'}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-4 w-full">
        <div className="bg-card rounded-xl border border-border p-4 mb-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-sky-700 uppercase tracking-wider">C3. ВЫРУЧКА</label>
              {canEditRevenueDays() ? (
                <input type="number" value={revenue || ''} onChange={(e) => updateRevenue(Number(e.target.value))}
                  className="w-36 bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm text-foreground text-right focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="0" />
              ) : (
                <span className="text-sm text-sky-700 font-bold ml-2">{fmt(revenue)}</span>
              )}
              <span className="text-xs text-muted-foreground">₽</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-sky-700 uppercase tracking-wider">C9. ДНИ</label>
              {canEditRevenueDays() ? (
                <input type="number" value={daysInMonth || ''} onChange={(e) => updateDays(Number(e.target.value))}
                  className="w-20 bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm text-foreground text-right focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="30" />
              ) : (
                <span className="text-sm text-sky-700 font-bold ml-2">{daysInMonth}</span>
              )}
              <span className="text-xs text-muted-foreground">дн.</span>
            </div>
            <div className="text-xs text-muted-foreground">K2 = {daysInMonth} × 24 = <b className="text-foreground/80">{k2}</b></div>
          </div>
        </div>

        {/* EMPLOYEE TABLE */}
        <div className="bg-card rounded-xl border border-border overflow-hidden mb-6">
          <div className="px-4 py-3 bg-secondary border-b border-border">
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Таблица сотрудников</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary">
                  <th className="text-center px-4 py-3 text-xs font-semibold text-foreground/80 min-w-[160px]"><span className="text-muted-foreground mr-1">A.</span>СОТРУДНИК</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-foreground/80 min-w-[90px]"><span className="text-muted-foreground mr-1">B.</span>ЧАСЫ</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-emerald-700 min-w-[90px]"><span className="text-emerald-500 mr-1">D.</span>₽/ЧАС</th>
                  {showExpanded && (
                    <>
                      <th className="text-center px-3 py-3 text-xs font-semibold text-foreground/80 min-w-[90px]"><span className="text-muted-foreground mr-1">E.</span>ОТПУСК</th>
                      <th className="text-center px-3 py-3 text-xs font-semibold text-foreground/80 min-w-[80px]"><span className="text-muted-foreground mr-1">F.</span>БЕЗНАЛ</th>
                      <th className="text-center px-3 py-3 text-xs font-semibold text-foreground/80 min-w-[80px]"><span className="text-muted-foreground mr-1">G.</span>ПЕРЕБОР</th>
                      <th className="text-center px-3 py-3 text-xs font-semibold text-foreground/80 min-w-[80px]"><span className="text-muted-foreground mr-1">H.</span>НАЛОГ</th>
                      <th className="text-center px-3 py-3 text-xs font-semibold text-orange-700 min-w-[100px]"><span className="text-orange-600 mr-1">H2.</span>НЕДОПЛАТА</th>
                    </>
                  )}
                  <th className="text-center px-4 py-3 text-xs font-semibold text-emerald-800 min-w-[110px]"><span className="text-emerald-600 mr-1">I.</span>ИТОГ</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-amber-700 min-w-[90px]"><span className="text-amber-600 mr-1">J.</span>НЕДЕЛЯ</th>
                  {isDeputy && <th className="w-10"></th>}
                </tr>
              </thead>
              <tbody>
                {calculatedRows.map((row, idx) => (
                  <tr key={row.id || idx} className={`border-t border-border ${idx % 2 === 0 ? 'bg-card/60' : 'bg-card/60'}`}>
                    <td className="px-4 py-2.5 text-center"><span className="text-sm text-foreground font-semibold">{getProfileName(row.profile_id)}</span></td>
                    <td className="px-4 py-2.5 text-center">
                      {canEditHours() ? (
                        <input type="number" value={row.hours_worked || ''} onChange={(e) => row.id && updateCell(row.id, 'hours_worked', Number(e.target.value))}
                          className="w-16 bg-secondary border border-border rounded px-2 py-1 text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                      ) : <span className="text-sm text-foreground font-medium">{row.hours_worked || 0}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center"><span className="text-sm text-emerald-600 font-bold">{fmt(row.d)}</span></td>
                    {showExpanded && (
                      <>
                        <td className="px-3 py-2.5 text-center">
                          {canEditVacation() ? (
                            <input type="number" value={row.vacation_pay || ''} onChange={(e) => row.id && updateCell(row.id, 'vacation_pay', Number(e.target.value))}
                              className="w-16 bg-secondary border border-border rounded px-2 py-1 text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                          ) : <span className="text-sm text-foreground">{fmt(row.vacation_pay || 0)}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {canEditNonCash() ? (
                            <input type="number" value={row.non_cash || ''} onChange={(e) => row.id && updateCell(row.id, 'non_cash', Number(e.target.value))}
                              className="w-16 bg-secondary border border-border rounded px-2 py-1 text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                          ) : <span className="text-sm text-foreground">{fmt(row.non_cash || 0)}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {canEditOvertime() ? (
                            <input type="number" value={row.overtime || ''} onChange={(e) => row.id && updateCell(row.id, 'overtime', Number(e.target.value))}
                              className="w-16 bg-secondary border border-border rounded px-2 py-1 text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                          ) : <span className="text-sm text-foreground">{fmt(row.overtime || 0)}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {canEditTax() ? (
                            <input type="number" value={row.tax || ''} onChange={(e) => row.id && updateCell(row.id, 'tax', Number(e.target.value))}
                              className="w-16 bg-secondary border border-border rounded px-2 py-1 text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                          ) : <span className="text-sm text-foreground">{fmt(row.tax || 0)}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {canEditUnderpayment() ? (
                            <input type="number" value={row.underpayment || ''} onChange={(e) => row.id && updateCell(row.id, 'underpayment', Number(e.target.value))}
                              className="w-16 bg-secondary border border-orange-600/50 rounded px-2 py-1 text-sm text-orange-700 text-center focus:outline-none focus:ring-1 focus:ring-orange-500" />
                          ) : <span className="text-sm text-orange-700">{fmt(row.underpayment || 0)}</span>}
                        </td>
                      </>
                    )}
                    <td className="px-4 py-2.5 text-center"><span className={`text-sm font-bold ${row.i >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmt(row.i)}</span></td>
                    <td className="px-4 py-2.5 text-center"><span className="text-sm text-amber-600 font-medium">{fmt(row.j)}</span></td>
                    {isDeputy && (
                      <td className="px-2 py-2.5 text-center">
                        {canAddDeleteRow() && (
                          <button onClick={() => row.id && deleteRow(row.id)} className="p-1 text-red-600/60 hover:text-red-600 hover:bg-red-500/10 rounded transition-all" title="Удалить">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {isDeputy && canAddDeleteRow() && (
                  <tr className="border-t border-border bg-secondary">
                    <td className="px-4 py-2.5">
                      <select value={newProfileId} onChange={(e) => setNewProfileId(e.target.value)}
                        className="w-full bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500">
                        <option value="">— Выберите сотрудника —</option>
                        {profiles.filter(p => !salaryRows.some(r => r.profile_id === p.id) && p.role !== 'director').map(p => (
                          <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                        ))}
                      </select>
                    </td>
                    <td colSpan={showExpanded ? 8 : 3} className="px-4 py-2.5">
                      <button onClick={addRow} disabled={!newProfileId}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded-lg transition-all flex items-center justify-center gap-2">
                        <Plus className="w-4 h-4" /> Добавить сотрудника
                      </button>
                    </td>
                    {isDeputy && <td></td>}
                  </tr>
                )}
                {calculatedRows.length > 0 && (
                  <tr className="border-t-2 border-emerald-500/40 bg-secondary font-bold">
                    <td className="px-4 py-3 text-center text-base text-foreground">ИТОГО</td>
                    <td className="px-4 py-3 text-center text-base text-foreground">{totals.hours}</td>
                    <td className="px-4 py-3 text-center text-sm text-emerald-600">{fmt(dRate)}</td>
                    {showExpanded && <td className="px-4 py-3 text-center text-sm text-muted-foreground">—</td>}
                    {showExpanded && <td className="px-4 py-3 text-center text-sm text-muted-foreground">—</td>}
                    {showExpanded && <td className="px-4 py-3 text-center text-sm text-muted-foreground">—</td>}
                    {showExpanded && <td className="px-4 py-3 text-center text-sm text-muted-foreground">—</td>}
                    {showExpanded && <td className="px-4 py-3 text-center text-sm text-orange-700">{fmt(totals.underpayment)}</td>}
                    <td className="px-4 py-3 text-center text-base text-emerald-700">{fmt(totals.i)}</td>
                    <td className="px-4 py-3 text-center text-base text-amber-600">{fmt(totals.j)}</td>
                    {isDeputy && <td></td>}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {calculatedRows.length === 0 && (
            <div className="text-center py-12">
              <Calculator className="w-16 h-16 text-muted-foreground/70 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-muted-foreground mb-2">Таблица пуста</h3>
              <p className="text-muted-foreground">{isDeputy || isResponsiblePerson() ? 'Добавьте сотрудников для расчёта зарплаты' : 'Зам. директора ещё не добавил сотрудников'}</p>
            </div>
          )}
        </div>

        {/* MANAGER TABLE */}
        <div className="bg-card rounded-xl border border-border overflow-hidden mb-6">
          <div className="px-4 py-3 bg-indigo-700/30 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-indigo-600" />
              <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Заведующий</h2>
              <span className="text-xs text-indigo-600/60 ml-2">Настройки в разделе «Настройки → Зарплата»</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-indigo-700 font-medium">₽/Час:</span>
                <span className="text-indigo-600 font-bold">{fmt(managerRate)}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-indigo-700">Процент:</span>
                <span className="text-indigo-600 font-bold">{managerPercent}%</span>
              </div>
              {managerLocked && (
                <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-500/10 px-2 py-1 rounded-lg">
                  <Lock className="w-3 h-3" /> Заблокировано
                </span>
              )}
              {isDeputy && managerLocked && (
                <button onClick={() => setShowManagerLock(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-amber-600/20 text-amber-600 text-xs font-medium rounded-lg border border-amber-500/30 hover:bg-amber-600/30 transition-all">
                  <Unlock className="w-3 h-3" /> Разблокировать
                </button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary">
                  <th className="text-center px-4 py-3 text-xs font-semibold text-foreground/80 min-w-[160px]"><span className="text-muted-foreground mr-1">1.</span>ФИО</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-foreground/80 min-w-[90px]"><span className="text-muted-foreground mr-1">2.</span>ОСН-Часы</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-foreground/80 min-w-[90px]"><span className="text-muted-foreground mr-1">3.</span>ДОП-Часы</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-indigo-700 min-w-[90px]"><span className="text-indigo-600 mr-1">4.</span>Час/Руб</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-foreground/80 min-w-[90px]"><span className="text-muted-foreground mr-1">5.</span>Доплаты</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-foreground/80 min-w-[90px]"><span className="text-muted-foreground mr-1">6.</span>Отпускные</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-foreground/80 min-w-[90px]"><span className="text-muted-foreground mr-1">7.</span>Безнал</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-orange-700 min-w-[100px]"><span className="text-orange-600 mr-1">7.1.</span>НЕДОПЛАТА</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-emerald-800 min-w-[110px]"><span className="text-emerald-600 mr-1">8.</span>ИТОГ</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-amber-700 min-w-[90px]"><span className="text-amber-600 mr-1">9.</span>Неделя</th>
                  {isDeputy && <th className="w-10"></th>}
                </tr>
              </thead>
              <tbody>
                {calculatedManagerRows.map((row, idx) => (
                  <tr key={row.id || idx} className={`border-t border-border ${idx % 2 === 0 ? 'bg-card/60' : 'bg-card/60'}`}>
                    <td className="px-4 py-2.5 text-center">
                      <span className="text-sm text-foreground font-semibold">{getProfileName(row.profile_id)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {canEditManagerHours() ? (
                        <input type="number" value={row.osn_hours || ''} onChange={(e) => row.id && updateManagerCell(row.id, 'osn_hours', Number(e.target.value))}
                          className="w-16 bg-secondary border border-border rounded px-2 py-1 text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                      ) : <span className="text-sm text-foreground font-medium">{row.osn_hours || 0}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {canEditManagerDopHours() ? (
                        <input type="number" value={row.dop_hours || ''} onChange={(e) => row.id && updateManagerCell(row.id, 'dop_hours', Number(e.target.value))}
                          className="w-16 bg-secondary border border-border rounded px-2 py-1 text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                      ) : <span className="text-sm text-foreground font-medium">{row.dop_hours || 0}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="text-sm text-indigo-600 font-bold">{fmt(row.hr)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {isDeputy && !managerLocked ? (
                        <input type="number" value={row.doplaty || ''} onChange={(e) => row.id && updateManagerCell(row.id, 'doplaty', Number(e.target.value))}
                          className="w-16 bg-secondary border border-border rounded px-2 py-1 text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                      ) : <span className="text-sm text-foreground">{fmt(row.doplaty || 0)}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {isDeputy && !managerLocked ? (
                        <input type="number" value={row.vacation_pay || ''} onChange={(e) => row.id && updateManagerCell(row.id, 'vacation_pay', Number(e.target.value))}
                          className="w-16 bg-secondary border border-border rounded px-2 py-1 text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                      ) : <span className="text-sm text-foreground">{fmt(row.vacation_pay || 0)}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {canEditManagerNonCash() ? (
                        <input type="number" value={row.non_cash || ''} onChange={(e) => row.id && updateManagerCell(row.id, 'non_cash', Number(e.target.value))}
                          className="w-16 bg-secondary border border-border rounded px-2 py-1 text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                      ) : <span className="text-sm text-foreground">{fmt(row.non_cash || 0)}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {canEditManagerUnderpayment() ? (
                        <input type="number" value={row.underpayment || ''} onChange={(e) => row.id && updateManagerCell(row.id, 'underpayment', Number(e.target.value))}
                          className="w-16 bg-secondary border border-orange-600/50 rounded px-2 py-1 text-sm text-orange-700 text-center focus:outline-none focus:ring-1 focus:ring-orange-500" />
                      ) : <span className="text-sm text-orange-700">{fmt(row.underpayment || 0)}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-sm font-bold ${row.itog >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmt(row.itog)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="text-sm text-amber-600 font-medium">{fmt(row.week)}</span>
                    </td>
                    {isDeputy && (
                      <td className="px-2 py-2.5 text-center">
                        {!managerLocked && (
                          <button onClick={() => row.id && deleteManagerRow(row.id)} className="p-1 text-red-600/60 hover:text-red-600 hover:bg-red-500/10 rounded transition-all" title="Удалить">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {isDeputy && !managerLocked && (
                  <tr className="border-t border-border bg-secondary">
                    <td className="px-4 py-2.5">
                      <select value={newManagerProfileId} onChange={(e) => setNewManagerProfileId(e.target.value)}
                        className="w-full bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <option value="">— Выберите сотрудника —</option>
                        {profiles.filter(p => p.role !== 'director' && !managerRows.some(r => r.profile_id === p.id)).map(p => (
                          <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                        ))}
                      </select>
                    </td>
                    <td colSpan={8} className="px-4 py-2.5">
                      <button onClick={addManagerRow} disabled={!newManagerProfileId}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded-lg transition-all flex items-center justify-center gap-2">
                        <Plus className="w-4 h-4" /> Добавить заведующего
                      </button>
                    </td>
                    {isDeputy && <td></td>}
                  </tr>
                )}
                {calculatedManagerRows.length > 0 && (
                  <tr className="border-t-2 border-indigo-500/40 bg-secondary font-bold">
                    <td className="px-4 py-3 text-center text-base text-foreground">ИТОГО</td>
                    <td className="px-4 py-3 text-center text-base text-foreground">{managerTotals.osn}</td>
                    <td className="px-4 py-3 text-center text-base text-foreground">{managerTotals.dop}</td>
                    <td className="px-4 py-3 text-center text-sm text-indigo-600">{fmt(managerRate)}</td>
                    <td className="px-4 py-3 text-center text-sm text-muted-foreground">—</td>
                    <td className="px-4 py-3 text-center text-sm text-muted-foreground">—</td>
                    <td className="px-4 py-3 text-center text-sm text-muted-foreground">—</td>
                    <td className="px-4 py-3 text-center text-sm text-orange-700">{fmt(managerTotals.underpayment)}</td>
                    <td className="px-4 py-3 text-center text-base text-emerald-700">{fmt(managerTotals.itog)}</td>
                    <td className="px-4 py-3 text-center text-base text-amber-600">{fmt(managerTotals.week)}</td>
                    {isDeputy && <td></td>}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {calculatedManagerRows.length === 0 && (
            <div className="text-center py-8">
              <UserCheck className="w-12 h-12 text-muted-foreground/70 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-muted-foreground mb-1">Нет заведующих</h3>
              <p className="text-sm text-muted-foreground">Добавьте любого сотрудника в таблицу заведующих</p>
              {isDeputy && (
                <p className="text-xs text-muted-foreground/70 mt-1">Используйте выпадающий список ниже таблицы</p>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Bottom bar — рассылка доступна любому сотруднику с доступом в систему */}
      {calculatedRows.length > 0 && (
        <div className="sticky bottom-0 bg-card backdrop-blur-sm border-t border-border px-4 py-3">
          <div className="max-w-full mx-auto flex items-center justify-end gap-3">
            <button onClick={handleDistributeSalary} disabled={broadcasting || calculatedRows.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {broadcasting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {broadcasting ? 'Отправка...' : 'Рассылка'}
            </button>
            {(isDeputy || isResponsiblePerson()) && (
              <button onClick={saveAll} disabled={saving || (periodLocked && managerLocked)}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50">
                {periodLocked ? <Lock className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                {saving ? 'Сохранение...' : (periodLocked && managerLocked) ? 'Заблокировано' : 'Сохранить'}
              </button>
            )}
          </div>
          {broadcastResult && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-4">
              <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-6 text-center">
                <div className={broadcastResult.startsWith('✓') ? 'text-emerald-600' : 'text-red-600'}>
                  <CheckCircle className="w-10 h-10 mx-auto mb-3" />
                </div>
                <p className="text-foreground text-base leading-relaxed whitespace-pre-line">{broadcastResult}</p>
                <button
                  onClick={() => setBroadcastResult('')}
                  className="mt-5 w-full px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-all">
                  Понятно
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showManagerLock && (
        <div className="fixed inset-0 bg-foreground/30 flex items-center justify-center z-[100]" onClick={() => { setShowManagerLock(false); setUnlockCode(''); setUnlockError(''); }}>
          <div className="bg-card rounded-2xl p-6 w-80 border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <Unlock className="w-5 h-5 text-amber-600" />
              <h3 className="text-foreground font-semibold">Разблокировка таблицы</h3>
            </div>
            <p className="text-muted-foreground text-sm mb-4">Введите код для разблокировки таблицы «Заведующий»:</p>
            <input type="password" value={unlockCode} onChange={(e) => { setUnlockCode(e.target.value); setUnlockError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlockManager()}
              className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground text-center text-lg tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-amber-500 mb-3"
              placeholder="••••" autoFocus />
            {unlockError && <p className="text-red-600 text-sm mb-3">{unlockError}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setShowManagerLock(false); setUnlockCode(''); setUnlockError(''); }}
                className="flex-1 bg-secondary hover:bg-border text-foreground py-2 rounded-lg transition-all text-sm">Отмена</button>
              <button onClick={handleUnlockManager}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white py-2 rounded-lg transition-all text-sm">Разблокировать</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}