import { vkAuth } from '@/lib/vkBinding';
import { useState, useEffect, useCallback } from 'react';
import { solveSchedule } from '@/lib/scheduleSolver';
import { useNavigate } from 'react-router-dom';
import { db } from '@/lib/sdk';
import { useAuth } from '../lib/auth';
import { getAllVkBindings } from '../lib/vkBinding';
import { LogOut, ArrowLeft, Save, Send, Lock, Unlock, RefreshCw, Pencil, Trash2, Printer, Loader2, CheckCircle, X, Eye, EyeOff } from 'lucide-react';
import AnodBizLogo from '../components/AnodBizLogo';
import EmployeeSettingsModal from '../components/EmployeeSettingsModal';
import { apiUrl } from '@/lib/apiUrls';
import Icon from '@/components/ui/icon';
import ConfiguratorDialog from '@/components/schedule/ConfiguratorDialog';
import { loadConfigurators, parseIdList } from '@/components/schedule/configuratorApi';
import { buildConfiguratorEngine, EngineViolation } from '@/components/schedule/configuratorEngine';
import type { ConfiguratorRecord } from '@/components/schedule/configuratorCatalog';

const VK_API_URL = apiUrl('vk-api');

const RUSSIAN_MONTHS = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'
];

const SHIFT_OPTIONS = ['', 'Д', 'Н', 'Дп', 'Нп'] as const;
const SHIFT_COLORS: Record<string, string> = {
  '': '',
  'Д': 'bg-green-500/20 text-green-700',
  'Н': 'bg-blue-500/20 text-blue-700',
  'Дп': 'bg-amber-500/20 text-amber-700',
  'Нп': 'bg-purple-500/20 text-purple-700',
};

function parseDateRange(rangeStr: string): number[] {
  if (!rangeStr || rangeStr.trim() === '') return [];
  const result: number[] = [];
  const parts = rangeStr.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
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
}

interface ScheduleEmployee {
  profile_id: string;
  full_name: string;
  status: string;
  no_day: boolean;
  no_night: boolean;
  break_days: number;
  priority: number;
  delays: number[];
  unavailable: number[];
  excluded: boolean;
  preferences: string[];
  st_no_day: boolean;
  st_no_night: boolean;
  ml_no_day: boolean;
  ml_no_night: boolean;
  configurator_ids: string[];
}

interface ScheduleRow {
  profile_id: string;
  full_name: string;
  shifts: string[];
}

function isAdjacentAllowed(prevShift: string, nextShift: string): boolean {
  if (prevShift === 'Д' && nextShift === 'Н') return true;
  if (prevShift === 'Дп' && nextShift === 'Н') return true;
  if (prevShift === 'Д' && nextShift === 'Нп') return true;
  return false;
}

// Генерация табеля: ровно 4 смены в день, правила СТ/МЛ, равномерность смен (см. scheduleSolver).
function generateSchedule(
  employees: ScheduleEmployee[],
  totalDays: number,
  year?: number,
  month?: number,
  configurators: ConfiguratorRecord[] = [],
): { rows: string[][]; violations: EngineViolation[]; notify: boolean } {
  const active = employees.filter(e => !e.excluded);
  const engine = year !== undefined && month !== undefined && configurators.length
    ? buildConfiguratorEngine(active, configurators, year, month, totalDays)
    : null;
  const rows = solveSchedule(active, totalDays, isAdjacentAllowed, 60, engine?.hooks);
  return { rows, violations: engine ? engine.findViolations(rows) : [], notify: !!engine?.notify };
}

function createScheduleImage(monthYear: string, rows: ScheduleRow[], days: number): Promise<string> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const shiftCountsLocal = (shifts: string[]) => {
      const c: Record<string, number> = { 'Д': 0, 'Н': 0, 'Дп': 0, 'Нп': 0 };
      shifts.forEach(s => { if (c[s] !== undefined) c[s]++; });
      return c;
    };
    const colW = 32;
    const rowH = 28;
    const nameW = 180;
    const totalW = 80;
    const headerH = 50;
    const w = nameW + days * colW + totalW * 4 + 20;
    const h = headerH + (rows.length + 2) * rowH + 20;
    canvas.width = w * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 14px Arial';
    ctx.fillText('Табель — ' + monthYear, 10, 20);
    ctx.font = '10px Arial';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Создано: ' + new Date().toLocaleDateString('ru-RU'), 10, 36);
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, headerH - 1, w, 1);
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 9px Arial';
    let xPos = 5;
    ctx.fillText('ФИО', xPos, headerH + 14);
    xPos = nameW;
    for (let i = 1; i <= days; i++) {
      ctx.fillText(String(i), xPos + colW / 2 - 3, headerH + 14);
      xPos += colW;
    }
    ctx.fillText('Д', xPos + 10, headerH + 14);
    ctx.fillText('Н', xPos + 30, headerH + 14);
    ctx.fillText('Дп', xPos + 50, headerH + 14);
    ctx.fillText('Нп', xPos + 70, headerH + 14);
    const shiftColors: Record<string, string> = { 'Д': '#22c55e', 'Н': '#3b82f6', 'Дп': '#f59e0b', 'Нп': '#a855f7' };
    rows.forEach((row, rowIdx) => {
      const yPos = headerH + (rowIdx + 1) * rowH + 4;
      if (rowIdx % 2 === 0) {
        ctx.fillStyle = '#1a2332';
        ctx.fillRect(0, yPos - 4, w, rowH);
      }
      ctx.fillStyle = '#f8fafc';
      ctx.font = '10px Arial';
      ctx.fillText(row.full_name, 8, yPos + 10);
      xPos = nameW;
      row.shifts.forEach((shift) => {
        if (shift) {
          ctx.fillStyle = shiftColors[shift] || '#94a3b8';
          ctx.font = 'bold 10px Arial';
          ctx.fillText(shift, xPos + colW / 2 - 3, yPos + 10);
        }
        xPos += colW;
      });
      const counts = shiftCountsLocal(row.shifts);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px Arial';
      ctx.fillText(String(counts['Д']), xPos + 13, yPos + 10);
      ctx.fillText(String(counts['Н']), xPos + 33, yPos + 10);
      ctx.fillText(String(counts['Дп']), xPos + 53, yPos + 10);
      ctx.fillText(String(counts['Нп']), xPos + 73, yPos + 10);
    });
    const totalY = headerH + (rows.length + 1) * rowH + 4;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, totalY - 4, w, rowH);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 10px Arial';
    ctx.fillText('ИТОГО', 8, totalY + 10);
    xPos = nameW + days * colW;
    const totals = { 'Д': 0, 'Н': 0, 'Дп': 0, 'Нп': 0 };
    rows.forEach(r => {
      r.shifts.forEach(s => { if (s in totals) totals[s as keyof typeof totals]++; });
    });
    ctx.fillText(String(totals['Д']), xPos + 13, totalY + 10);
    ctx.fillText(String(totals['Н']), xPos + 33, totalY + 10);
    ctx.fillText(String(totals['Дп']), xPos + 53, totalY + 10);
    ctx.fillText(String(totals['Нп']), xPos + 73, totalY + 10);
    resolve(canvas.toDataURL('image/png'));
  });
}

function printSchedule(monthYear: string, rows: ScheduleRow[], days: number) {
  const shiftCountsLocal = (shifts: string[]) => {
    const c: Record<string, number> = { 'Д': 0, 'Н': 0, 'Дп': 0, 'Нп': 0 };
    shifts.forEach(s => { if (c[s] !== undefined) c[s]++; });
    return c;
  };
  const dayTotalsLocal = (dayIdx: number) => {
    const c: Record<string, number> = { 'Д': 0, 'Н': 0, 'Дп': 0, 'Нп': 0 };
    rows.forEach(r => { const s = r.shifts[dayIdx]; if (c[s] !== undefined) c[s]++; });
    return c;
  };
  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Табель — ${monthYear}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 10px; margin: 20px; }
  h1 { font-size: 16px; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 11px; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #333; padding: 3px 4px; text-align: center; font-size: 10px; }
  th { background: #f0f0f0; font-weight: bold; }
  td.name { text-align: left; font-weight: 500; min-width: 120px; }
  td.total { font-weight: bold; background: #f5f5f5; }
  .shift-Д { color: #16a34a; font-weight: bold; }
  .shift-Н { color: #2563eb; font-weight: bold; }
  .shift-Дп { color: #d97706; font-weight: bold; }
  .shift-Нп { color: #9333ea; font-weight: bold; }
  @media print { body { margin: 10mm; } @page { size: landscape; margin: 10mm; } }
</style></head><body>`;
  html += `<h1>Табель учёта рабочего времени</h1>`;
  html += `<div class="subtitle">${monthYear} • Напечатано: ${new Date().toLocaleDateString('ru-RU')}</div>`;
  html += `<table><thead><tr><th>ФИО</th>`;
  for (let i = 1; i <= days; i++) html += `<th>${i}</th>`;
  html += `<th>Итого</th><th>Д</th><th>Н</th><th>Дп</th><th>Нп</th></tr></thead><tbody>`;
  for (const row of rows) {
    const counts = shiftCountsLocal(row.shifts);
    const total = counts['Д'] + counts['Н'] + counts['Дп'] + counts['Нп'];
    html += `<tr><td class="name">${row.full_name}</td>`;
    for (let d = 0; d < days; d++) {
      const s = row.shifts[d] || '';
      html += `<td class="shift-${s}">${s || '—'}</td>`;
    }
    html += `<td class="total">${total}</td>`;
    html += `<td class="total">${counts['Д']}</td><td class="total">${counts['Н']}</td><td class="total">${counts['Дп']}</td><td class="total">${counts['Нп']}</td></tr>`;
  }
  html += `<tr class="total"><td class="name total">ИТОГО</td>`;
  for (let d = 0; d < days; d++) {
    const dt = dayTotalsLocal(d);
    const dayTotal = dt['Д'] + dt['Н'] + dt['Дп'] + dt['Нп'];
    html += `<td class="total">${dayTotal}</td>`;
  }
  const grandTotal = rows.reduce((s, r) => s + shiftCountsLocal(r.shifts)['Д'] + shiftCountsLocal(r.shifts)['Н'] + shiftCountsLocal(r.shifts)['Дп'] + shiftCountsLocal(r.shifts)['Нп'], 0);
  html += `<td class="total">${grandTotal}</td>`;
  html += `<td class="total">${rows.reduce((s, r) => s + shiftCountsLocal(r.shifts)['Д'], 0)}</td>`;
  html += `<td class="total">${rows.reduce((s, r) => s + shiftCountsLocal(r.shifts)['Н'], 0)}</td>`;
  html += `<td class="total">${rows.reduce((s, r) => s + shiftCountsLocal(r.shifts)['Дп'], 0)}</td>`;
  html += `<td class="total">${rows.reduce((s, r) => s + shiftCountsLocal(r.shifts)['Нп'], 0)}</td>`;
  html += `</tr></tbody></table></body></html>`;
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => { printWindow.print(); };
  }
}

export default function Schedule() {
  return <ScheduleContent />;
}

function ScheduleContent() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const isDeputy = user?.role === 'deputy_director' || user?.role === 'director';

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());

  const [employees, setEmployees] = useState<ScheduleEmployee[]>([]);
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [isLocked, setIsLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [scheduleResponsibleId, setScheduleResponsibleId] = useState<string | null>(null);
  const [isResponsible, setIsResponsible] = useState(false);
  const [editing, setEditing] = useState(false);
  const [debugInfo, setDebugInfo] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState('');
  const [allProfiles, setAllProfiles] = useState<{ id: string; full_name: string; vk_id: string }[]>([]);
  const [selectedEmployeeForSettings, setSelectedEmployeeForSettings] = useState<{ employee: ScheduleEmployee; index: number } | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [configurators, setConfigurators] = useState<ConfiguratorRecord[]>([]);
  const [showConfigurator, setShowConfigurator] = useState(false);

  useEffect(() => {
    loadConfigurators(user?.companyId).then(setConfigurators);
  }, [user?.companyId]);

  const monthYear = `${RUSSIAN_MONTHS[selectedMonth]} ${selectedYear}`;
  const getDaysInMonth = useCallback(() => new Date(selectedYear, selectedMonth + 1, 0).getDate(), [selectedMonth, selectedYear]);

  const loadEmployees = useCallback(async (): Promise<ScheduleEmployee[]> => {
    const { data: profiles, error: profilesErr } = await db.from('profiles').select('*');
    if (profilesErr) {
      console.error('[Schedule] Profiles error:', profilesErr);
      setDebugInfo(`Ошибка профилей: ${profilesErr.message || JSON.stringify(profilesErr)}`);
      return [];
    }
    if (!profiles || profiles.length === 0) {
      setDebugInfo('Таблица profiles пуста.');
      return [];
    }

    setAllProfiles((profiles as Record<string, unknown>[]).map(p => ({
      id: p.id as string,
      full_name: (p.full_name as string) || (p.email as string) || 'Без имени',
      vk_id: (p.vk_id as string) || '',
    })));

    const nonDirector = profiles.filter((p: Record<string, unknown>) => p.role && p.role !== 'director' && p.role !== '');

    if (nonDirector.length === 0) {
      setDebugInfo(`Из ${profiles.length} профилей нет сотрудников с рабочей ролью.`);
      return [];
    }

    const { data: configs } = await db.from('schedule_config').select('*');
    const configMap = new Map<string, Record<string, unknown>>();
    (configs || []).forEach((c: Record<string, unknown>) => configMap.set(c.profile_id as string, c));

    const { data: varSettings } = await db.from('employee_schedule_settings').select('*').eq('month_year', monthYear);
    const varMap = new Map<string, Record<string, unknown>>();
    (varSettings || []).forEach((v: Record<string, unknown>) => varMap.set(v.profile_id as string, v));

    return nonDirector.map((p: any) => {
      const cfg = configMap.get(p.id as string);
      const vs = varMap.get(p.id as string);

      const permDelays = parseDateRange((cfg?.delays as string) || '');
      const varDelays = parseDateRange((vs?.delay as string) || '');
      const allDelays = [...new Set([...permDelays, ...varDelays])];

      const permUnavail = parseDateRange((cfg?.unavailable as string) || '');
      const varUnavail = parseDateRange((vs?.unavailable as string) || '');
      const allUnavail = [...new Set([...permUnavail, ...varUnavail])];

      const prefsRaw = cfg?.preferences;
      let preferences: string[] = [];
      if (Array.isArray(prefsRaw)) {
        preferences = (prefsRaw as string[]).filter(Boolean);
      } else if (typeof prefsRaw === 'string' && prefsRaw.trim()) {
        preferences = prefsRaw.split(',').map(s => s.trim()).filter(Boolean);
      }

      return {
        profile_id: p.id as string,
        full_name: (p.full_name as string) || (p.email as string) || 'Без имени',
        status: (cfg?.status as string) || 'ЛБ',
        no_day: (cfg?.no_day as boolean) || false,
        no_night: (cfg?.no_night as boolean) || false,
        break_days: (cfg?.break_days as number) ?? 0,
        priority: (cfg?.priority as number) ?? 3,
        delays: allDelays,
        unavailable: allUnavail,
        excluded: (cfg?.excluded as boolean) || false,
        preferences,
        st_no_day: (cfg?.st_no_day as boolean) || false,
        st_no_night: (cfg?.st_no_night as boolean) || false,
        ml_no_day: (cfg?.ml_no_day as boolean) || false,
        ml_no_night: (cfg?.ml_no_night as boolean) || false,
        configurator_ids: parseIdList(cfg?.configurator_ids),
      };
    });
  }, [monthYear]);

  const loadSchedule = useCallback(async () => {
    setLoading(true);
    setDebugInfo('');
    const emps = await loadEmployees();
    setEmployees(emps);

    const { data: schSettings } = await db.from('schedule_settings')
      .select('responsible_profile_id').is('month_year', null).limit(1);
    const respId = schSettings?.[0]?.responsible_profile_id || null;
    setScheduleResponsibleId(respId);
    setIsResponsible(user?.profileId === respId);

    const days = getDaysInMonth();
    const { data: existing } = await db.from('schedule_data').select('*').eq('month_year', monthYear);
    if (existing && existing.length > 0) {
      const loadedRows: ScheduleRow[] = existing
        .filter((row: Record<string, unknown>) => {
          const emp = emps.find(e => e.profile_id === row.profile_id);
          return emp && !emp.excluded;
        })
        .map((row: Record<string, unknown>) => ({
          profile_id: row.profile_id as string,
          full_name: emps.find(e => e.profile_id === row.profile_id)?.full_name || '',
          shifts: ((row.shifts as string[]) || []).slice(0, days),
        }));
      setRows(loadedRows);
    } else {
      setRows(emps.filter(e => !e.excluded).map(e => ({
        profile_id: e.profile_id, full_name: e.full_name, shifts: Array(days).fill(''),
      })));
    }

    const { data: settings } = await db.from('schedule_settings').select('is_locked').eq('month_year', monthYear).limit(1);
    setIsLocked(settings?.[0]?.is_locked || false);
    setLoading(false);
  }, [selectedMonth, selectedYear, monthYear, loadEmployees, getDaysInMonth, user]);

  useEffect(() => { loadSchedule(); }, [loadSchedule]);

  const canEdit = (isDeputy || isResponsible) && editing && !isLocked;
  const canManageSettings = isDeputy || isResponsible;
  const canSave = isDeputy || isResponsible;
  const canLock = isDeputy;
  const canUnlock = isDeputy;

  const [generating, setGenerating] = useState(false);
  const handleGenerate = () => {
    setGenerating(true);
    setStatusMessage('Подбираю лучший вариант табеля...');
    // Даём странице нарисовать индикатор, затем считаем (1–3 секунды).
    setTimeout(() => {
      const { rows: schedule, violations, notify } = generateSchedule(employees, getDaysInMonth(), selectedYear, selectedMonth, configurators);
      const activeEmps = employees.filter(e => !e.excluded);
      setRows(activeEmps.map((emp, i) => ({
        profile_id: emp.profile_id, full_name: emp.full_name, shifts: schedule[i] || Array(getDaysInMonth()).fill(''),
      })));
      setGenerating(false);
      if (notify && violations.length && isDeputy) {
        const nameOf = (id: string) => activeEmps.find(e => e.profile_id === id)?.full_name || '';
        const sample = violations.slice(0, 3).map(v => `${nameOf(v.profile_id)}, ${v.day} — ${v.rule}`).join('; ');
        setStatusMessage(`Сгенерировано. Нарушено условий конфигуратора: ${violations.length}. ${sample}${violations.length > 3 ? '…' : ''}`);
        setTimeout(() => setStatusMessage(''), 12000);
      } else {
        setStatusMessage('Расписание сгенерировано: 4 смены каждый день');
        setTimeout(() => setStatusMessage(''), 3000);
      }
    }, 50);
  };

  const handleShiftChange = (rowIdx: number, dayIdx: number, value: string) => {
    if (!canEdit) return;
    setRows(prev => {
      const updated = [...prev];
      const shifts = [...updated[rowIdx].shifts];
      shifts[dayIdx] = value;
      updated[rowIdx] = { ...updated[rowIdx], shifts };
      return updated;
    });
  };

  const handleDeleteRow = async (rowIdx: number) => {
    const profileId = rows[rowIdx].profile_id;
    const { data: existing } = await db.from('schedule_config')
      .select('id')
      .eq('profile_id', profileId)
      .limit(1);
    if (existing && existing.length > 0) {
      await db.from('schedule_config').update({ excluded: true }).eq('id', existing[0].id);
    } else {
      await db.from('schedule_config').insert({ profile_id: profileId, excluded: true });
    }
    setRows(prev => prev.filter((_, i) => i !== rowIdx));
    setEmployees(prev => prev.map(e => e.profile_id === profileId ? { ...e, excluded: true } : e));
  };

  const handleRestoreEmployee = async (profileId: string) => {
    const { data: existing } = await db.from('schedule_config')
      .select('id')
      .eq('profile_id', profileId)
      .limit(1);
    if (existing && existing.length > 0) {
      await db.from('schedule_config').update({ excluded: false }).eq('id', existing[0].id);
    }
    setEmployees(prev => prev.map(e => e.profile_id === profileId ? { ...e, excluded: false } : e));
    await loadSchedule();
    setStatusMessage('Сотрудник возвращён в табель');
    setTimeout(() => setStatusMessage(''), 3000);
  };

  const handleSave = async () => {
    setSaving(true);
    await db.from('schedule_data').delete().eq('month_year', monthYear);
    for (const row of rows) {
      await db.from('schedule_data').insert({
        month_year: monthYear, profile_id: row.profile_id, shifts: row.shifts, user_id: user?.id || '',
      });
    }
    if (canLock) {
      const { data: existing } = await db.from('schedule_settings').select('id').eq('month_year', monthYear).limit(1);
      if (existing && existing.length > 0) {
        await db.from('schedule_settings').update({ is_locked: true }).eq('id', existing[0].id);
      } else {
        await db.from('schedule_settings').insert({ month_year: monthYear, is_locked: true });
      }
      setIsLocked(true);
    }
    setSaving(false);
    setEditing(false);
    setStatusMessage(canLock ? 'Расписание сохранено и заблокировано' : 'Расписание сохранено');
    setTimeout(() => setStatusMessage(''), 3000);
  };

  const handleUnlock = async () => {
    if (!canUnlock) return;
    const { data: existing } = await db.from('schedule_settings').select('id').eq('month_year', monthYear).limit(1);
    if (existing && existing.length > 0) {
      await db.from('schedule_settings').update({ is_locked: false }).eq('id', existing[0].id);
    }
    setIsLocked(false);
    setEditing(true);
  };

  const handleDistributeSchedule = async () => {
    setBroadcasting(true);
    setBroadcastResult('');
    try {
      const responsibleProfile = allProfiles.find(p => p.id === scheduleResponsibleId);
      const responsibleName = responsibleProfile?.full_name || '—';
      // Картинка табеля одна на всех — рисуем один раз и отправляем всем сотрудникам из списка табеля
      const photoDataUrl = await createScheduleImage(monthYear, rows, getDaysInMonth());
      const rowProfileIds = new Set(rows.map(r => r.profile_id));

      const text = [
        '📅 РАСПИСАНИЕ ОБНОВЛЕНО',
        '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
        `🏢 АнодБИЗ · ${monthYear}`,
        '',
        `👔 Ответственный: ${responsibleName}`,
        '',
        'В базу поступили новые данные о расписании — смотрите приложенный табель.',
      ].join('\n');

      // Привязки VK хранятся отдельно на сервере (подтверждает бот) — берём их одним запросом
      const vkBindings = await getAllVkBindings();
      const targets = allProfiles.filter(p => rowProfileIds.has(p.id));
      const items = targets.filter(p => vkBindings[p.id]).map(p => ({ vk_user_id: vkBindings[p.id], message: text }));
      const skipped = targets.length - items.length;

      if (items.length === 0) {
        setBroadcastResult('✗ Ни у кого из табеля не привязан VK — рассылка не отправлена.');
        setTimeout(() => setBroadcastResult(''), 6000);
        return;
      }

      const res = await fetch(VK_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...vkAuth() },
        body: JSON.stringify({ action: 'broadcast', items, photo_base64: photoDataUrl }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Ошибка отправки');

      setBroadcastResult(
        '✓ Табель (фото) отправлен в VK: ' + result.sent + ' из ' + items.length +
        (skipped > 0 ? '. Без VK: ' + skipped + '.' : '.') +
        (result.failed > 0 ? ' Не доставлено: ' + result.failed + '.' : '') +
        (result.photo_error ? ' Фото не прикрепилось (ВК: ' + result.photo_error + ') — проверьте право «Фотографии» у ключа сообщества.' : '')
      );
      setTimeout(() => setBroadcastResult(''), result.photo_error ? 20000 : 8000);
    } catch (e) {
      console.error('Schedule broadcast error:', e);
      setBroadcastResult('✗ Ошибка при отправке рассылки');
      setTimeout(() => setBroadcastResult(''), 5000);
    } finally {
      setBroadcasting(false);
    }
  };

  const handleOpenEmployeeSettings = (emp: ScheduleEmployee, index: number) => {
    setSelectedEmployeeForSettings({ employee: emp, index });
  };

  const handleRowContextMenu = (e: React.MouseEvent, rowProfileId: string) => {
    e.preventDefault();
    const empIdx = activeEmployees.findIndex(emp => emp.profile_id === rowProfileId);
    if (empIdx >= 0) {
      handleOpenEmployeeSettings(activeEmployees[empIdx], empIdx);
    }
  };

  const handleSaveEmployeeSettings = async () => {
    await loadSchedule();
  };

  const handleNextEmployee = () => {
    if (!selectedEmployeeForSettings) return;
    const nextIdx = selectedEmployeeForSettings.index + 1;
    if (nextIdx < activeEmployees.length) {
      setSelectedEmployeeForSettings({ employee: activeEmployees[nextIdx], index: nextIdx });
    } else {
      setSelectedEmployeeForSettings(null);
    }
  };

  const days = getDaysInMonth();
  const shiftCountsLocal = (shifts: string[]) => {
    const c: Record<string, number> = { 'Д': 0, 'Н': 0, 'Дп': 0, 'Нп': 0 };
    shifts.forEach(s => { if (c[s] !== undefined) c[s]++; });
    return c;
  };
  const dayTotalsLocal = (dayIdx: number) => {
    const c: Record<string, number> = { 'Д': 0, 'Н': 0, 'Дп': 0, 'Нп': 0 };
    rows.forEach(r => { const s = r.shifts[dayIdx]; if (c[s] !== undefined) c[s]++; });
    return c;
  };

  const activeEmployees = employees.filter(e => !e.excluded);
  const excludedEmployees = employees.filter(e => e.excluded);
  const allEmployeesForModal = allProfiles.map(p => ({ id: p.id, full_name: p.full_name }));

  return (
    <div className="min-h-full">
      <header className="bg-card backdrop-blur-sm border-b border-border sticky top-0 z-50">
        <div className="max-w-full mx-auto px-4 py-2 sm:h-14 sm:py-0 flex flex-wrap gap-2 items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/dashboard')} className="p-2 text-muted-foreground hover:text-foreground rounded-lg">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <AnodBizLogo size="sm" />
            <span className="text-lg font-bold text-foreground hidden sm:block">Табель</span>
          </div>
          <div className="flex items-center gap-3">
            {isLocked && (
              <span className="flex items-center gap-1 text-amber-600 text-xs bg-amber-500/10 px-2 py-1 rounded-full">
                <Lock className="w-3 h-3" /> Заблокировано
              </span>
            )}
            {isLocked && canUnlock && (
              <button onClick={handleUnlock}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-amber-500 text-white hover:bg-amber-600">
                <Unlock className="w-3 h-3" /> Разблокировать
              </button>
            )}
            {!isDeputy && isResponsible && (
              <span className="flex items-center gap-1 text-blue-600 text-xs bg-blue-500/10 px-2 py-1 rounded-full">
                Ответственный
              </span>
            )}
            {isDeputy && (
              <button onClick={() => setShowConfigurator(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-secondary text-foreground hover:bg-border">
                <Icon name="SlidersHorizontal" className="w-4 h-4" />
                <span className="hidden sm:inline">Конфигуратор</span>
              </button>
            )}
            <button onClick={() => signOut().then(() => navigate('/login'))} className="p-2 text-muted-foreground hover:text-foreground rounded-lg">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-full mx-auto px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground text-sm">На</span>
            <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))}
              className="bg-card border border-border rounded-lg px-3 py-2 text-foreground text-sm">
              {RUSSIAN_MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
            <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}
              className="bg-card border border-border rounded-lg px-3 py-2 text-foreground text-sm">
              {[2025, 2026, 2027, 2028].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            {(isDeputy || isResponsible) && (
              <button onClick={() => setEditing(!editing)}
                className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg transition-all ${editing ? 'bg-emerald-600 text-white' : 'bg-secondary text-foreground/80 hover:bg-secondary'}`}>
                <Pencil className="w-4 h-4" />
                {editing ? 'Редактирование' : 'Редактировать'}
              </button>
            )}
            {excludedEmployees.length > 0 && (
              <button onClick={() => setShowExcluded(!showExcluded)}
                className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg transition-all ${showExcluded ? 'bg-red-600/20 text-red-600 border border-red-500/30' : 'bg-secondary text-muted-foreground hover:bg-secondary'}`}>
                {showExcluded ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                Исключённые ({excludedEmployees.length})
              </button>
            )}
          </div>
        </div>

        {statusMessage && (
          <div className="mb-3 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-600 text-sm">
            ✓ {statusMessage}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 && excludedEmployees.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg mb-2">Нет сотрудников для отображения</p>
            {debugInfo && <p className="text-xs text-amber-600/60 mt-3 font-mono bg-card p-2 rounded max-w-lg mx-auto">{debugInfo}</p>}
          </div>
        ) : (
          <div>
            <div className="space-y-3 md:hidden">
              {rows.map((row, rowIdx) => {
                const counts = shiftCountsLocal(row.shifts);
                return (
                  <div key={row.profile_id} className="rounded-xl border border-border bg-card p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <span className="font-medium text-foreground">{row.full_name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        <b className="text-foreground">{counts['Д'] + counts['Н'] + counts['Дп'] + counts['Нп']}</b> смен ·{' '}
                        <span className="text-green-600">Д {counts['Д']}</span> · <span className="text-blue-600">Н {counts['Н']}</span>
                        {counts['Дп'] > 0 && <> · <span className="text-amber-600">Дп {counts['Дп']}</span></>}
                        {counts['Нп'] > 0 && <> · <span className="text-purple-600">Нп {counts['Нп']}</span></>}
                      </span>
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {Array.from({ length: days }, (_, dayIdx) => {
                        const wd = new Date(selectedYear, selectedMonth, dayIdx + 1).getDay();
                        return (
                          <div key={dayIdx} className={`relative flex h-11 flex-col items-center justify-center rounded-md border border-border text-xs ${SHIFT_COLORS[row.shifts[dayIdx]] || ''}`}>
                            <span className={`text-[10px] leading-none ${wd === 0 || wd === 6 ? 'text-red-500' : 'text-muted-foreground'}`}>{dayIdx + 1}</span>
                            <span className="mt-0.5 font-semibold leading-none">{row.shifts[dayIdx] || '·'}</span>
                            {canEdit && (
                              <select value={row.shifts[dayIdx] || ''} onChange={e => handleShiftChange(rowIdx, dayIdx, e.target.value)}
                                className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label={`${row.full_name}, ${dayIdx + 1} число`}>
                                {SHIFT_OPTIONS.map(sh => <option key={sh} value={sh}>{sh || '—'}</option>)}
                              </select>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          <div className="hidden overflow-x-auto md:block">
            <table data-no-cards className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-card">
                  <th className="px-3 py-2 text-left text-foreground/80 font-medium border border-border sticky left-0 bg-card z-10 min-w-[160px]">ФИО</th>
                  {Array.from({ length: days }, (_, i) => (
                    <th key={i} className="px-1 py-1 text-center text-muted-foreground font-medium border border-border min-w-[42px]">{i + 1}</th>
                  ))}
                  <th className="px-2 py-2 text-center text-foreground/80 font-bold border border-border min-w-[50px]">Итого</th>
                  <th className="px-2 py-2 text-center text-green-600 font-medium border border-border min-w-[50px]">Д</th>
                  <th className="px-2 py-2 text-center text-blue-600 font-medium border border-border min-w-[50px]">Н</th>
                  <th className="px-2 py-2 text-center text-amber-600 font-medium border border-border min-w-[50px]">Дп</th>
                  <th className="px-2 py-2 text-center text-purple-600 font-medium border border-border min-w-[50px]">Нп</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIdx) => {
                  const counts = shiftCountsLocal(row.shifts);
                  const empTotal = counts['Д'] + counts['Н'] + counts['Дп'] + counts['Нп'];
                  return (
                    <tr key={row.profile_id} className="hover:bg-secondary cursor-pointer select-none"
                      onContextMenu={(e) => handleRowContextMenu(e, row.profile_id)}>
                      <td className="px-3 py-1.5 text-foreground font-medium border border-border sticky left-0 bg-background z-10 whitespace-nowrap">{row.full_name}</td>
                      {Array.from({ length: days }, (_, dayIdx) => (
                        <td key={dayIdx} className={`px-0.5 py-0.5 border border-border text-center ${SHIFT_COLORS[row.shifts[dayIdx]] || ''}`}>
                          {canEdit ? (
                            <select value={row.shifts[dayIdx] || ''} onChange={e => handleShiftChange(rowIdx, dayIdx, e.target.value)}
                              className="w-full bg-transparent border-0 text-center text-xs focus:outline-none cursor-pointer appearance-none">
                              {SHIFT_OPTIONS.map(s => <option key={s} value={s} className="bg-card text-foreground">{s || '—'}</option>)}
                            </select>
                          ) : <span className="text-xs">{row.shifts[dayIdx] || '—'}</span>}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-center text-foreground font-bold border border-border">{empTotal}</td>
                      <td className="px-2 py-1.5 text-center text-green-600 font-medium border border-border">{counts['Д']}</td>
                      <td className="px-2 py-1.5 text-center text-blue-600 font-medium border border-border">{counts['Н']}</td>
                      <td className="px-2 py-1.5 text-center text-amber-600 font-medium border border-border">{counts['Дп']}</td>
                      <td className="px-2 py-1.5 text-center text-purple-600 font-medium border border-border">{counts['Нп']}</td>
                    </tr>
                  );
                })}
                {rows.length > 0 && (
                  <tr className="bg-card font-semibold">
                    <td className="px-3 py-2 text-foreground/80 border border-border sticky left-0 bg-card z-10">ИТОГО</td>
                    {Array.from({ length: days }, (_, dayIdx) => {
                      const dt = dayTotalsLocal(dayIdx);
                      const total = dt['Д'] + dt['Н'] + dt['Дп'] + dt['Нп'];
                      return (
                        <td key={dayIdx} className={`px-1 py-1 text-center text-xs border border-border font-bold ${total >= 4 ? 'text-emerald-600' : total > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                          {total}
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-center text-foreground font-bold border border-border">
                      {rows.reduce((s, r) => { const c = shiftCountsLocal(r.shifts); return s + c['Д'] + c['Н'] + c['Дп'] + c['Нп']; }, 0)}
                    </td>
                    <td className="px-2 py-2 text-center text-green-600 border border-border">{rows.reduce((s, r) => s + shiftCountsLocal(r.shifts)['Д'], 0)}</td>
                    <td className="px-2 py-2 text-center text-blue-600 border border-border">{rows.reduce((s, r) => s + shiftCountsLocal(r.shifts)['Н'], 0)}</td>
                    <td className="px-2 py-2 text-center text-amber-600 border border-border">{rows.reduce((s, r) => s + shiftCountsLocal(r.shifts)['Дп'], 0)}</td>
                    <td className="px-2 py-2 text-center text-purple-600 border border-border">{rows.reduce((s, r) => s + shiftCountsLocal(r.shifts)['Нп'], 0)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

            {showExcluded && excludedEmployees.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-red-600 mb-2 flex items-center gap-2">
                  <Trash2 className="w-4 h-4" /> Исключённые из табеля ({excludedEmployees.length})
                </h3>
                <div className="bg-card rounded-lg border border-red-500/20 divide-y divide-border">
                  {excludedEmployees.map(emp => (
                    <div key={emp.profile_id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <span className="text-foreground/80 font-medium">{emp.full_name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">({emp.status})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setSelectedEmployeeForSettings({ employee: emp, index: -1 });
                          }}
                          className="px-3 py-1.5 text-xs bg-secondary text-foreground/80 rounded-lg hover:bg-border transition-all"
                        >
                          Настройки
                        </button>
                        <button
                          onClick={() => handleRestoreEmployee(emp.profile_id)}
                          className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all"
                        >
                          Вернуть
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between sticky bottom-0 bg-background py-3 border-t border-border">
          <div className="flex items-center gap-2">
            {(isDeputy || isResponsible) && !isLocked && (
              <button onClick={handleGenerate} disabled={generating} className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm disabled:opacity-60">
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {generating ? 'Подбираю...' : 'Генерировать'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {rows.length > 0 && (
              <button onClick={() => printSchedule(monthYear, rows, days)}
                className="flex items-center gap-2 px-4 py-2.5 bg-muted text-foreground/80 rounded-lg hover:bg-border font-medium text-sm">
                <Printer className="w-4 h-4" /> Печать
              </button>
            )}
            <button onClick={handleDistributeSchedule} disabled={broadcasting || rows.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 bg-secondary text-foreground/80 rounded-lg hover:bg-border font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed">
              {broadcasting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {broadcasting ? 'Отправка...' : 'Рассылка'}
            </button>
            {canUnlock && isLocked && (
              <button onClick={handleUnlock}
                className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-medium text-sm">
                <Unlock className="w-4 h-4" /> Разблокировать
              </button>
            )}
            {canSave && !isLocked && (
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium text-sm disabled:opacity-50">
                <Save className="w-4 h-4" /> {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            )}
          </div>
        </div>
        {broadcastResult && (
          <div className="mt-2 mb-2">
            <div className={`text-sm px-3 py-2 rounded-lg ${broadcastResult.startsWith('✓') ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'}`}>
              <CheckCircle className="w-4 h-4 inline mr-1" />
              {broadcastResult}
            </div>
          </div>
        )}
      </main>

      {isDeputy && (
        <ConfiguratorDialog
          open={showConfigurator}
          onOpenChange={setShowConfigurator}
          companyId={user?.companyId}
          userId={user?.profileId || user?.id}
          employees={allEmployeesForModal}
          onChanged={setConfigurators}
        />
      )}

      {selectedEmployeeForSettings && (
        <EmployeeSettingsModal
          employee={{
            id: selectedEmployeeForSettings.employee.profile_id,
            full_name: selectedEmployeeForSettings.employee.full_name,
            email: '',
            role: '',
            status: selectedEmployeeForSettings.employee.status,
          }}
          monthYear={monthYear}
          allEmployees={allEmployeesForModal}
          onClose={() => setSelectedEmployeeForSettings(null)}
          onSave={handleSaveEmployeeSettings}
          onNext={selectedEmployeeForSettings.index >= 0 ? handleNextEmployee : () => {}}
          isExcluded={selectedEmployeeForSettings.employee.excluded}
          nextEmployee={selectedEmployeeForSettings.index >= 0 && activeEmployees[selectedEmployeeForSettings.index + 1] ? {
            id: activeEmployees[selectedEmployeeForSettings.index + 1].profile_id,
            full_name: activeEmployees[selectedEmployeeForSettings.index + 1].full_name,
            email: '',
            role: '',
            status: '',
          } : null}
        />
      )}
    </div>
  );
}