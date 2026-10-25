import { vkAuth } from '@/lib/vkBinding';
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../lib/auth';
import { db } from '@/lib/sdk';
import { getAllVkBindings } from '../lib/vkBinding';
import { useNavigate } from 'react-router-dom';
import { Lock, Unlock, UserCheck } from 'lucide-react';
import { apiUrl } from '@/lib/apiUrls';
import { evalFormula, useAccess, type FieldDef } from '@/lib/access';
import SalaryGrid, { type GridRow } from '@/components/salary/SalaryGrid';
import {
  type Profile, type SalaryRow, type ManagerRow, MONTHS, getDaysForMonth, DEFAULT_FX, DEFAULT_FIELDS,
  rowEnv, fmt, loadGlobalSettings, loadGlobalManagerSettings,
} from '@/components/salary/salaryUtils';
import SalaryHeader from '@/components/salary/SalaryHeader';
import SalaryRevenueBar from '@/components/salary/SalaryRevenueBar';
import SalaryBottomBar from '@/components/salary/SalaryBottomBar';
import ManagerUnlockDialog from '@/components/salary/ManagerUnlockDialog';

const VK_API_URL = apiUrl('vk-api');

export default function Salary() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isDeputy = user?.role === 'deputy_director';
  const isDirector = user?.role === 'director';
  const { access, can } = useAccess();
  const usePositions = !!access && !isDeputy && access.position !== null;
  const canEditPerm = isDeputy || can('salary.edit');
  const canManageRows = isDeputy || can('salary.manage_rows');
  const canLock = isDeputy || can('salary.lock');
  const canViewFull = isDeputy || can('salary.view_full');
  const fx = access?.formulas || DEFAULT_FX;
  const fields = access?.fields || DEFAULT_FIELDS;

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

      if (!rowsRes.error && Array.isArray(rowsRes.data) && rowsRes.data.length === 0 && profilesRes.data && profilesRes.data.length > 0) {
        await copyRowsFromPreviousPeriod(profilesRes.data);
      }

      if (!managerRowsRes.error && Array.isArray(managerRowsRes.data) && managerRowsRes.data.length === 0 && profilesRes.data) {
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

  function canEditHours(): boolean { return !locked && (usePositions ? canEditPerm : (isDeputy || isResponsiblePerson())); }
  function canEditRevenueDays(): boolean { return !locked && (isDeputy || isResponsiblePerson()); }
  function canAddDeleteRow(): boolean { return !locked && canManageRows; }

  function isManagerResponsible(): boolean {
    if (!managerResponsibleId || !user?.profileId) return false;
    return user.profileId === managerResponsibleId;
  }
  function canEditManager(): boolean { return !managerLocked && (usePositions ? canEditPerm : (isDeputy || isManagerResponsible())); }

  const baseEnv = useMemo(() => ({ revenue, days: daysInMonth, percent: globalPercent || 0, manager_percent: managerPercent || 0 }),
    [revenue, daysInMonth, globalPercent, managerPercent]);
  const employeeRate = useMemo(() => evalFormula(fx.rate, baseEnv), [fx.rate, baseEnv]);
  const managerRate = useMemo(() => evalFormula(fx.manager_rate, { ...baseEnv, rate: employeeRate }), [fx.manager_rate, baseEnv, employeeRate]);

  const calculatedRows = useMemo(() => {
    const d = employeeRate;
    return salaryRows.map(row => {
      const env = { ...baseEnv, rate: d, ...rowEnv(row as unknown as Record<string, unknown>, fields.salary) };
      const i = evalFormula(fx.total, env);
      const j = evalFormula(fx.week, { ...env, total: i });
      return { ...row, d, i, j };
    });
  }, [salaryRows, baseEnv, employeeRate, fx.total, fx.week, fields.salary]);

  const calculatedManagerRows = useMemo(() => {
    return managerRows.map(row => {
      const hr = managerRate;
      const env = { ...baseEnv, rate: employeeRate, manager_rate: hr, ...rowEnv(row as unknown as Record<string, unknown>, fields.manager) };
      const itog = evalFormula(fx.manager_total, env);
      const week = evalFormula(fx.manager_week, { ...env, manager_total: itog });
      return { ...row, hr, itog, week };
    });
  }, [managerRows, managerRate, employeeRate, baseEnv, fx.manager_total, fx.manager_week, fields.manager]);

  const totals = useMemo(() => {
    return calculatedRows.reduce((acc, r) => ({
      hours: acc.hours + (r.hours_worked || 0),
      underpayment: acc.underpayment + (r.underpayment || 0),
      i: acc.i + r.i,
      j: acc.j + r.j,
    }), { hours: 0, underpayment: 0, i: 0, j: 0 });
  }, [calculatedRows]);

  const showExpanded = canViewFull || isResponsiblePerson() || showFullTable;

  function getProfileName(id: string) { return profiles.find(p => p.id === id)?.full_name || '—'; }
  function getProfileById(id: string) { return profiles.find(p => p.id === id); }

  const k2 = daysInMonth * 24;
  const dRate = employeeRate;

  async function updateGridCell(table: 'salary_data' | 'manager_data', row: SalaryRow | ManagerRow, f: FieldDef, value: number | string) {
    if (!row.id) return;
    const setter = table === 'salary_data' ? setSalaryRows : setManagerRows;
    if (f.builtin) {
      (setter as (fn: (prev: (SalaryRow | ManagerRow)[]) => (SalaryRow | ManagerRow)[]) => void)(prev => prev.map(r => r.id === row.id ? { ...r, [f.key]: value } : r));
      await db.from(table).update({ [f.key]: value }).eq('id', row.id);
    } else {
      const extra = { ...(row.extra || {}), [f.key]: value };
      (setter as (fn: (prev: (SalaryRow | ManagerRow)[]) => (SalaryRow | ManagerRow)[]) => void)(prev => prev.map(r => r.id === row.id ? { ...r, extra } : r));
      await db.from(table).update({ extra }).eq('id', row.id);
    }
  }

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

  async function updateRevenue(value: number) {
    setRevenue(value);
    if (periodSettingsId) await db.from('salary_settings').update({ revenue: value }).eq('id', periodSettingsId);
  }

  async function updateDays(value: number) {
    setDaysInMonth(value);
    if (periodSettingsId) await db.from('salary_settings').update({ days_in_month: value }).eq('id', periodSettingsId);
  }

  async function addManagerRow() {
    if (!canManageRows) return;
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
    if (!canManageRows) return;
    const { error } = await db.from('manager_data').delete().eq('id', id);
    if (!error) setManagerRows(prev => prev.filter(r => r.id !== id));
  }

  async function saveAll() {
    if (!canLock && !isResponsiblePerson()) return;
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

  // Зам. директора разблокирует таблицу сотрудников, чтобы внести изменения.
  const [tabelBusy, setTabelBusy] = useState(false);
  async function fillHoursFromSchedule() {
    if (!canEditHours()) return;
    setTabelBusy(true);
    try {
      const { data } = await db.from('schedule_data').select('profile_id, shifts').eq('month_year', `${MONTHS[selectedMonth - 1]} ${selectedYear}`);
      const sh = { 'Д': 12, 'Н': 12, 'Дп': 12, 'Нп': 12, ...(access?.general?.shift_hours || {}) } as Record<string, number>;
      const hoursBy = new Map<string, number>();
      for (const r of (data || []) as { profile_id: string; shifts: string[] | string }[]) {
        const shifts: string[] = Array.isArray(r.shifts) ? r.shifts : JSON.parse(r.shifts || '[]');
        hoursBy.set(r.profile_id, (hoursBy.get(r.profile_id) || 0) + shifts.reduce((s, x) => s + (sh[x] || 0), 0));
      }
      if (hoursBy.size === 0) { alert('В табеле за этот месяц нет смен'); return; }
      const changes = salaryRows.filter(r => r.id && hoursBy.has(r.profile_id) && hoursBy.get(r.profile_id) !== (r.hours_worked || 0));
      if (changes.length === 0) { alert('Часы уже совпадают с табелем'); return; }
      const list = changes.map(r => `${getProfileName(r.profile_id)}: ${r.hours_worked || 0} → ${hoursBy.get(r.profile_id)}`).join('\n');
      if (!confirm(`Подставить часы из табеля?\n\n${list}`)) return;
      for (const r of changes) {
        await db.from('salary_data').update({ hours_worked: hoursBy.get(r.profile_id) }).eq('id', r.id!);
      }
      setSalaryRows(prev => prev.map(r => hoursBy.has(r.profile_id) && changes.some(c => c.id === r.id) ? { ...r, hours_worked: hoursBy.get(r.profile_id)! } : r));
    } finally { setTabelBusy(false); }
  }

  async function handleUnlockPeriod() {
    if (!canLock) return;
    setPeriodLocked(false);
    if (periodSettingsId) {
      await db.from('salary_settings').update({ is_locked: false }).eq('id', periodSettingsId);
    }
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
        headers: { 'Content-Type': 'application/json', ...vkAuth() },
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
      <SalaryHeader
        onBack={() => navigate('/dashboard')}
        selectedMonth={selectedMonth} setSelectedMonth={setSelectedMonth}
        selectedYear={selectedYear} setSelectedYear={setSelectedYear}
        years={years} dRate={dRate} rowsCount={calculatedRows.length} totalI={totals.i}
        periodLocked={periodLocked} canLock={canLock} onUnlockPeriod={handleUnlockPeriod}
        isDirector={isDirector} isDeputy={isDeputy}
        showFullTable={showFullTable} setShowFullTable={setShowFullTable}
        canEditHours={canEditHours()} onFillHours={fillHoursFromSchedule} tabelBusy={tabelBusy}
        isResponsible={isResponsiblePerson()}
      />

      <main className="flex-1 max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-4 w-full">
        <SalaryRevenueBar canEdit={canEditRevenueDays()} revenue={revenue} daysInMonth={daysInMonth} k2={k2}
          onRevenue={updateRevenue} onDays={updateDays} />

        {/* EMPLOYEE TABLE */}
        <SalaryGrid
          title={<div className="px-4 py-3 bg-secondary border-b border-border"><h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Таблица сотрудников</h2></div>}
          accent="emerald" fields={fields.salary} rows={salaryRows as unknown as GridRow[]} computed={calculatedRows.map(r => ({ rate: r.d, total: r.i, week: r.j }))}
          rate={dRate} showAll={showExpanded} shortKeys={['hours_worked']}
          canEdit={canEditHours()} canManageRows={canAddDeleteRow()} profileName={getProfileName}
          onCell={(row, f, v) => row.id && updateGridCell('salary_data', row as unknown as SalaryRow, f, v)}
          onDelete={(row) => row.id && deleteRow(row.id)}
          addOptions={profiles.filter(p => !salaryRows.some(r => r.profile_id === p.id) && p.role !== 'director').map(p => ({ id: p.id, name: p.full_name || p.email }))}
          newProfileId={newProfileId} setNewProfileId={setNewProfileId} onAdd={addRow} addLabel="Добавить сотрудника"
          emptyText={canAddDeleteRow() ? 'Добавьте сотрудников для расчёта зарплаты' : 'Сотрудники ещё не добавлены'}
        />

        {/* MANAGER TABLE */}
        <SalaryGrid
          title={
          <div className="px-4 py-3 bg-indigo-700/30 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-indigo-600" />
              <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Заведующий</h2>
              <span className="text-xs text-indigo-600/60 ml-2">Формулы и колонки — в админ-панели</span>
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
              {canLock && managerLocked && (
                <button onClick={() => setShowManagerLock(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-amber-600/20 text-amber-600 text-xs font-medium rounded-lg border border-amber-500/30 hover:bg-amber-600/30 transition-all">
                  <Unlock className="w-3 h-3" /> Разблокировать
                </button>
              )}
            </div>
          </div>
          }
          accent="indigo" fields={fields.manager} rows={managerRows as unknown as GridRow[]} computed={calculatedManagerRows.map(r => ({ rate: r.hr, total: r.itog, week: r.week }))}
          rate={managerRate} showAll shortKeys={[]}
          canEdit={canEditManager()} canManageRows={canManageRows && !managerLocked} profileName={getProfileName}
          onCell={(row, f, v) => row.id && updateGridCell('manager_data', row as unknown as ManagerRow, f, v)}
          onDelete={(row) => row.id && deleteManagerRow(row.id)}
          addOptions={profiles.filter(p => p.role !== 'director' && !managerRows.some(r => r.profile_id === p.id)).map(p => ({ id: p.id, name: p.full_name || p.email }))}
          newProfileId={newManagerProfileId} setNewProfileId={setNewManagerProfileId} onAdd={addManagerRow} addLabel="Добавить заведующего"
          emptyText="Нет заведующих"
        />
      </main>

      {/* Bottom bar — рассылка доступна любому сотруднику с доступом в систему */}
      {calculatedRows.length > 0 && (
        <SalaryBottomBar
          showBroadcast={!usePositions || can('salary.broadcast')} onBroadcast={handleDistributeSalary}
          broadcasting={broadcasting} rowsCount={calculatedRows.length}
          showSave={canLock || isResponsiblePerson()} onSave={saveAll} saving={saving}
          periodLocked={periodLocked} managerLocked={managerLocked}
          broadcastResult={broadcastResult} onCloseResult={() => setBroadcastResult('')}
        />
      )}

      {showManagerLock && (
        <ManagerUnlockDialog
          unlockCode={unlockCode} unlockError={unlockError}
          onCodeChange={(v) => { setUnlockCode(v); setUnlockError(''); }}
          onClose={() => { setShowManagerLock(false); setUnlockCode(''); setUnlockError(''); }}
          onUnlock={handleUnlockManager}
        />
      )}
    </div>
  );
}
