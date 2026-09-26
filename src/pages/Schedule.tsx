import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, storage } from '@/lib/sdk';
import { useAuth } from '../lib/auth';
import { LogOut, ArrowLeft, Save, Send, Lock, Unlock, RefreshCw, Pencil, Trash2, Printer, Loader2, CheckCircle, X, Eye, EyeOff } from 'lucide-react';
import AnodBizLogo from '../components/AnodBizLogo';
import EmployeeSettingsModal from '../components/EmployeeSettingsModal';

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

function shuffleArray<T>(array: T[]): T[] {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
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

interface CanWorkOptions {
  ignoreBreak?: boolean;
  ignoreAdjacency?: boolean;
}

function canWork(
  emp: ScheduleEmployee,
  dayNum: number,
  shift: string,
  empLastWorkDay: number,
  empLastShift: string,
  currentDayIndex: number,
  schedule: string[][],
  empIdx: number,
  options: CanWorkOptions = {}
): boolean {
  if ((shift === 'Д' || shift === 'Дп') && emp.no_day) return false;
  if ((shift === 'Н' || shift === 'Нп') && emp.no_night) return false;
  if (emp.unavailable.includes(dayNum)) return false;
  if (emp.delays.includes(dayNum)) return false;
  if (schedule[empIdx]?.[currentDayIndex]) return false;

  if (empLastWorkDay >= 0) {
    const gap = currentDayIndex - empLastWorkDay;
    if (gap === 1 && !options.ignoreAdjacency) {
      if (!isAdjacentAllowed(empLastShift, shift)) return false;
    }
    if (!options.ignoreBreak && gap <= emp.break_days) return false;
  }

  return true;
}

function getShiftTypes(emp: ScheduleEmployee): string[] {
  switch (emp.status) {
    case 'СТ': return ['Д', 'Н'];
    case 'МЛ': return ['Дп', 'Нп'];
    case 'ЛБ':
    default: return ['Д', 'Н', 'Дп', 'Нп'];
  }
}

function isSubTypeAllowed(shift: string, emp: ScheduleEmployee): boolean {
  if (emp.status !== 'ЛБ') return true;
  if (shift === 'Д' && emp.st_no_day) return false;
  if (shift === 'Н' && emp.st_no_night) return false;
  if (shift === 'Дп' && emp.ml_no_day) return false;
  if (shift === 'Нп' && emp.ml_no_night) return false;
  return true;
}

function countShifts(scheduleRow: string[]): number {
  return scheduleRow.filter(s => s !== '').length;
}

// Преференс = жёсткое ограничение: сотрудник с непустым списком preferences
// в этот день может работать ТОЛЬКО в паре с кем-то из своего списка
// (и только с ним — не с произвольным человеком). Если подходящего партнёра
// на день нет — сотрудник в этот день не ставится вообще (не подставляется "кто попало").
function hasPreferences(emp: ScheduleEmployee): boolean {
  return emp.preferences.length > 0;
}

// Совместимость двух сотрудников для совместной смены с учётом преференций.
// Если у сотрудника указаны преференции — партнёр обязан входить в этот список.
function isCompatiblePair(empA: ScheduleEmployee, empB: ScheduleEmployee): boolean {
  if (hasPreferences(empA) && !empA.preferences.includes(empB.profile_id)) return false;
  if (hasPreferences(empB) && !empB.preferences.includes(empA.profile_id)) return false;
  return true;
}

const ALL_SHIFTS = ['Д', 'Н', 'Дп', 'Нп'];
// Пары "одна смена вместе": день (Д+Дп) и ночь (Н+Нп) — как в бизнес-правиле.
const SAME_SHIFT_PAIRS: Array<[string, string]> = [['Д', 'Дп'], ['Дп', 'Д'], ['Н', 'Нп'], ['Нп', 'Н']];

function generateSchedule(employees: ScheduleEmployee[], totalDays: number): string[][] {
  const active = employees.filter(e => !e.excluded);
  const n = active.length;
  if (n === 0) return [];

  const schedule: string[][] = Array.from({ length: n }, () => Array(totalDays).fill(''));
  const empLastWorkDay: number[] = Array(n).fill(-999);
  const empLastShift: string[] = Array(n).fill('');

  const idxMap = new Map<string, number>();
  active.forEach((emp, i) => idxMap.set(emp.profile_id, i));

  // Пары преференций: только сотрудники, у которых оба совместимы друг с другом
  const prefPairs: Array<[number, number]> = [];
  const pairSeen = new Set<string>();
  active.forEach((emp, i) => {
    for (const prefId of emp.preferences) {
      const j = idxMap.get(prefId);
      if (j === undefined || j === i) continue;
      if (!isCompatiblePair(emp, active[j])) continue;
      const key = Math.min(i, j) + ':' + Math.max(i, j);
      if (pairSeen.has(key)) continue;
      pairSeen.add(key);
      prefPairs.push([i, j]);
    }
  });

  const pickTier = <T extends { emp: ScheduleEmployee; idx: number }>(candidates: T[]): T => {
    candidates.sort((a, b) => {
      const pd = a.emp.priority - b.emp.priority;
      if (pd !== 0) return pd;
      return countShifts(schedule[a.idx]) - countShifts(schedule[b.idx]);
    });
    const bestPriority = candidates[0].emp.priority;
    const bestCount = countShifts(schedule[candidates[0].idx]);
    const tier = candidates.filter(
      c => c.emp.priority === bestPriority && countShifts(schedule[c.idx]) === bestCount
    );
    return tier[Math.floor(Math.random() * tier.length)];
  };

  for (let day = 0; day < totalDays; day++) {
    const dayNum = day + 1;
    const filledIdx = new Set<number>();
    const usedShifts = new Set<string>();

    const place = (idx: number, shift: string) => {
      schedule[idx][day] = shift;
      filledIdx.add(idx);
      usedShifts.add(shift);
    };

    // Phase 1: расставляем пары преференций — строго вместе, строго в одну "смену" (день/ночь)
    const shuffledPairs = shuffleArray(prefPairs);
    for (const [i, j] of shuffledPairs) {
      if (filledIdx.has(i) || filledIdx.has(j)) continue;
      const empI = active[i];
      const empJ = active[j];
      const placements = shuffleArray(SAME_SHIFT_PAIRS);

      for (const [si, sj] of placements) {
        if (usedShifts.has(si) || usedShifts.has(sj)) continue;
        if (!getShiftTypes(empI).includes(si) || !getShiftTypes(empJ).includes(sj)) continue;
        if (!isSubTypeAllowed(si, empI) || !isSubTypeAllowed(sj, empJ)) continue;
        if (!canWork(empI, dayNum, si, empLastWorkDay[i], empLastShift[i], day, schedule, i)) continue;
        if (!canWork(empJ, dayNum, sj, empLastWorkDay[j], empLastShift[j], day, schedule, j)) continue;
        place(i, si);
        place(j, sj);
        break;
      }
    }

    // Phase 2: оставшиеся слоты — только сотрудниками БЕЗ преференций
    // (сотрудник с преференциями, не нашедший пару, в этот день не ставится вообще)
    const fillEmptySlots = (opts: CanWorkOptions) => {
      const emptySlots = ALL_SHIFTS.filter(s => !usedShifts.has(s));
      for (const shift of shuffleArray(emptySlots)) {
        const candidates = active
          .map((emp, idx) => ({ emp, idx }))
          .filter(({ emp, idx }) =>
            !filledIdx.has(idx) &&
            !hasPreferences(emp) &&
            getShiftTypes(emp).includes(shift) &&
            isSubTypeAllowed(shift, emp) &&
            canWork(emp, dayNum, shift, empLastWorkDay[idx], empLastShift[idx], day, schedule, idx, opts)
          );
        if (candidates.length === 0) continue;
        const chosen = pickTier(candidates);
        place(chosen.idx, shift);
      }
    };

    // Строгий проход
    fillEmptySlots({});
    // Если строго ровно 4 в день не набралось — постепенно ослабляем отдых/смежность
    // (правило "преференция — только с этими людьми" при этом никогда не нарушается)
    if (usedShifts.size < 4) fillEmptySlots({ ignoreAdjacency: true });
    if (usedShifts.size < 4) fillEmptySlots({ ignoreAdjacency: true, ignoreBreak: true });

    // Phase 3: если совсем не хватает свободных "безпреференсных" сотрудников —
    // в крайнем случае берём и сотрудников с преференциями, но ТОЛЬКО если для них
    // в этот день в принципе нет совместимого партнёра ни при каких раскладах —
    // такого сотрудника всё равно не ставим одного (жёсткое правило), поэтому здесь
    // просто пытаемся полностью снятыми мягкими ограничениями добрать оставшихся
    // безпреференсных кандидатов ещё раз (уже сделано выше) — форс сверх этого не делаем,
    // чтобы не нарушить правило преференций.

    for (const idx of filledIdx) {
      const shift = schedule[idx][day];
      empLastWorkDay[idx] = day;
      empLastShift[idx] = shift;
    }
  }

  return schedule;
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

  const handleGenerate = () => {
    const schedule = generateSchedule(employees, getDaysInMonth());
    const activeEmps = employees.filter(e => !e.excluded);
    setRows(activeEmps.map((emp, i) => ({
      profile_id: emp.profile_id, full_name: emp.full_name, shifts: schedule[i] || Array(getDaysInMonth()).fill(''),
    })));
    setStatusMessage('Расписание сгенерировано');
    setTimeout(() => setStatusMessage(''), 3000);
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
      const photoDataUrl = await createScheduleImage(monthYear, rows, getDaysInMonth());
      // Картинка графика одна на всех: кладём в storage и кладём ВСЕМ ссылку + текст.
      let photoUrl = '';
      try {
        const blob = await (await fetch(photoDataUrl)).blob();
        const file = new File([blob], 'schedule-' + monthYear.replace('.', '-') + '.png', { type: 'image/png' });
        const up = await storage.upload('schedule', file);
        if (up && up.url) photoUrl = up.url;
      } catch {
        photoUrl = '';
      }
      const text = [
        'В базу АнодБИЗ поступили данные о расписании!',
        '',
        'Ответственный: ' + responsibleName,
        '',
        'На ' + monthYear,
        photoUrl ? 'График (фото): ' + photoUrl : '',
      ].filter(Boolean).join('\n');
      let sent = 0;
      let skipped = 0;
      for (const profile of allProfiles) {
        if (!profile.vk_id || !profile.full_name) { skipped++; continue; }
        await db.from('broadcast_tasks').insert({
          type: 'schedule',
          period: monthYear,
          target_vk_id: Number(profile.vk_id),
          profile_id: profile.id,
          responsible_name: responsibleName,
          message_text: text,
          photo_url: photoUrl,
          status: 'pending',
        });
        sent++;
      }
      setBroadcastResult(
        photoUrl
          ? '✓ Создано ' + sent + ' задач на отправку. Всем сотрудникам уйдёт текст и ссылка на фото графика.'
          : '✓ Создано ' + sent + ' задач на отправку, но фото загрузить не удалось — уйдёт только текст. Используйте «Печать» для табеля с картинкой.'
      );
      setTimeout(() => setBroadcastResult(''), 8000);
    } catch (e) {
      console.error('Schedule broadcast error:', e);
      setBroadcastResult('✗ Ошибка при создании рассылки');
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
        <div className="max-w-full mx-auto px-4 h-14 flex items-center justify-between">
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
            {!isDeputy && isResponsible && (
              <span className="flex items-center gap-1 text-blue-600 text-xs bg-blue-500/10 px-2 py-1 rounded-full">
                Ответственный
              </span>
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
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
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
              <button onClick={handleGenerate} className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm">
                <RefreshCw className="w-4 h-4" /> Генерировать
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