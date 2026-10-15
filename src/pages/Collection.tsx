import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../lib/auth';
import { useAccess } from '@/lib/access';
import { db } from '@/lib/sdk';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Coins, Upload, Save, RefreshCw,
  FileSpreadsheet, Check, AlertTriangle, X, Lock, Unlock, Shield
} from 'lucide-react';

interface CollectionRow {
  id?: string;
  shift_date: string;
  shift_type: 'Д' | 'Н';
  sbis_value: number;
  fact_value: number;
  status: 'verified' | 'error' | 'shortage' | null;
  responsible_person: string;
  month_year: string;
  locked?: boolean;
}

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function getDaysInMonth(month: number, year: number): number {
  if (month === 2 && ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)) return 29;
  return DAYS_IN_MONTH[month - 1];
}

function fmt(n: number): string {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function classifyShift(hour: number): 'Д' | 'Н' {
  if (hour >= 5 && hour < 9) return 'Д';
  if (hour >= 18 && hour < 21) return 'Н';
  return hour < 12 ? 'Д' : 'Н';
}

function generateMonthRows(month: number, year: number): CollectionRow[] {
  const days = getDaysInMonth(month, year);
  const monthYear = `${String(month).padStart(2, '0')}.${year}`;
  const rows: CollectionRow[] = [];
  for (let d = 1; d <= days; d++) {
    const dateStr = `${String(d).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
    rows.push({
      shift_date: dateStr, shift_type: 'Д',
      sbis_value: 0, fact_value: 0, status: null,
      responsible_person: '', month_year: monthYear,
    });
    rows.push({
      shift_date: dateStr, shift_type: 'Н',
      sbis_value: 0, fact_value: 0, status: null,
      responsible_person: '', month_year: monthYear,
    });
  }
  return rows;
}

function getNextPeriod(period: string): string {
  const [mStr, yStr] = period.split('.');
  let m = parseInt(mStr, 10);
  let y = parseInt(yStr, 10);
  m++;
  if (m > 12) { m = 1; y++; }
  return `${String(m).padStart(2, '0')}.${y}`;
}

async function parseSabiReport(file: File): Promise<Map<string, number>> {
  let XLSX: any;
  try {
    XLSX = await import(/* @vite-ignore */ 'https://esm.sh/xlsx@0.18.5');
  } catch {
    throw new Error('Не удалось загрузить библиотеку для чтения XLSX. Проверьте подключение к интернету.');
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Файл не содержит листов');
  const sheet = workbook.Sheets[sheetName];
  const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(data.length, 10); i++) {
    const row = data[i];
    if (!row) continue;
    const hasDate = row.some((c: any) => String(c || '').includes('Дата и время открытия'));
    if (hasDate) { headerRowIdx = i; break; }
  }
  if (headerRowIdx === -1) throw new Error('Не найдена строка заголовков в файле. Убедитесь, что загружается отчёт по сменам из САБИ.');

  const headers = data[headerRowIdx].map((h: any) => String(h || '').trim());
  const dtCol = headers.findIndex((h: string) => h.includes('Дата и время открытия'));
  const cashCol = headers.findIndex((h: string) => h === 'Наличными');
  if (dtCol === -1) throw new Error('Не найден столбец «Дата и время открытия»');
  if (cashCol === -1) throw new Error('Не найден столбец «Наличными»');

  const result = new Map<string, number>();

  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    const dtRaw = String(row[dtCol] || '').trim();
    if (!dtRaw || dtRaw.startsWith('Итого')) continue;
    const cashRaw = String(row[cashCol] || '0').replace(/[^\d.,\-]/g, '').replace(',', '.');
    const cash = parseFloat(cashRaw) || 0;
    const parts = dtRaw.split(/\s+/);
    if (parts.length < 2) continue;
    const dateParts = parts[0].split('.');
    if (dateParts.length < 3) continue;
    let day = parseInt(dateParts[0], 10);
    let mo = parseInt(dateParts[1], 10);
    let yr = parseInt(dateParts[2], 10);
    if (yr < 100) yr += 2000;
    const timeParts = parts[1].split(':');
    const hour = parseInt(timeParts[0], 10) || 0;
    const shiftType = classifyShift(hour);
    const dateStr = `${String(day).padStart(2, '0')}.${String(mo).padStart(2, '0')}.${yr}`;
    const key = `${dateStr}_${shiftType}`;
    result.set(key, (result.get(key) || 0) + cash);
  }
  return result;
}

const STATUS_OPTIONS = [
  { value: 'verified', label: 'Проверено', icon: '✓', color: 'text-green-600', bg: 'bg-green-500/10 border-green-500/30' },
  { value: 'error', label: 'Ошибка', icon: '⚠', color: 'text-yellow-600', bg: 'bg-yellow-500/10 border-yellow-500/30' },
  { value: 'shortage', label: 'Недостача', icon: '✗', color: 'text-red-600', bg: 'bg-red-500/10 border-red-500/30' },
];

const UNLOCK_PIN = '2535';

export default function Collection() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { access, can } = useAccess();
  const usePositions = !!access && !access.is_deputy && access.position !== null;
  const isDir = usePositions ? can('collection.edit') : (user?.role === 'director' || user?.role === 'deputy_director');
  const canImport = usePositions ? can('collection.import') : isDir;
  const canUnlock = usePositions ? can('collection.unlock') : isDir;
  const colFields = access?.fields?.collection;
  const colLabel = (key: string, def: string) => colFields?.find((f) => f.key === key)?.label || def;
  const colVisible = (key: string) => !colFields || colFields.find((f) => f.key === key)?.visible !== false;
  const fileRef = useRef<HTMLInputElement>(null);

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fioList, setFioList] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [monthLocked, setMonthLocked] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [tempUnlocked, setTempUnlocked] = useState(false);
  const [unlockedExpiry, setUnlockedExpiry] = useState<number | null>(null);

  const period = `${String(month).padStart(2, '0')}.${year}`;
  const years = useMemo(() => Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i), []);

  useEffect(() => { loadData(); }, [month, year]);

  // Cleanup temp unlock timer
  useEffect(() => {
    if (unlockedExpiry) {
      const timer = setTimeout(() => {
        setTempUnlocked(false);
        setUnlockedExpiry(null);
      }, unlockedExpiry - Date.now());
      return () => clearTimeout(timer);
    }
  }, [unlockedExpiry]);

  async function loadData() {
    setLoading(true);
    setError(null);
    setTempUnlocked(false);
    setUnlockedExpiry(null);
    try {
      const { data: savedData, error: dbErr } = await db.from('collection_data')
        .select('*')
        .eq('month_year', period);

      if (dbErr) {
        console.error('DB read error:', dbErr);
        setError('Ошибка чтения БД: ' + (dbErr.message || JSON.stringify(dbErr)));
      }

      // Check if month is locked
      const lockedRows = (savedData || []).filter((r: any) => r.locked);
      const isLocked = lockedRows.length > 0;
      setMonthLocked(isLocked);

      const generatedRows = generateMonthRows(month, year);
      const savedMap = new Map<string, CollectionRow>();
      (savedData || []).forEach((r: any) => {
        savedMap.set(`${r.shift_date}_${r.shift_type}`, r as CollectionRow);
      });

      const mergedRows = generatedRows.map(gen => {
        const key = `${gen.shift_date}_${gen.shift_type}`;
        const saved = savedMap.get(key);
        return saved || gen;
      });

      setRows(mergedRows);
      await loadFioList();
    } catch (e: any) {
      console.error('Load error:', e);
      setError('Ошибка загрузки: ' + (e.message || ''));
      setRows(generateMonthRows(month, year));
    } finally {
      setLoading(false);
    }
  }

  async function loadFioList() {
    try {
      const { data: salaryProfiles } = await db.from('salary_data').select('profile_id');
      const profileIds = [...new Set((salaryProfiles || []).map((r: any) => r.profile_id))];
      if (profileIds.length === 0) {
        const { data: allProfiles } = await db.from('profiles').select('full_name').neq('role', 'director');
        setFioList((allProfiles || []).map((p: any) => p.full_name).filter(Boolean));
        return;
      }
      const { data: profiles } = await db.from('profiles').select('id, full_name');
      const names = (profiles || [])
        .filter((p: any) => profileIds.includes(p.id))
        .map((p: any) => p.full_name)
        .filter(Boolean);
      setFioList([...new Set(names)] as string[]);
    } catch (e) {
      console.error('FIO list error:', e);
    }
  }

  const totalSbis = useMemo(() => rows.reduce((s, r) => s + (r.sbis_value || 0), 0), [rows]);
  const totalFact = useMemo(() => rows.reduce((s, r) => s + (r.fact_value || 0), 0), [rows]);
  const totalDiscrepancy = totalSbis - totalFact;
  const isEditable = isDir && (!monthLocked || tempUnlocked);

  /** Save only non-empty rows to DB, carry shortages to next month */
  async function handleRefresh() {
    if (!isDir) return;
    setUpdating(true);
    setError(null);
    setSuccessMsg(null);
    try {
      let saved = 0;
      const errors: string[] = [];
      for (const row of rows) {
        const hasData = row.sbis_value > 0 || row.fact_value > 0 || row.status;
        if (!hasData) continue;
        const payload = {
          month_year: row.month_year,
          shift_date: row.shift_date,
          shift_type: row.shift_type,
          sbis_value: row.sbis_value || 0,
          fact_value: row.fact_value || 0,
          status: row.status,
          responsible_person: row.responsible_person || '',
          locked: false,
        };
        if (row.id) {
          const { error: updErr } = await db.from('collection_data').update(payload).eq('id', row.id);
          if (updErr) {
            errors.push(`update ${row.shift_date} ${row.shift_type}: ${updErr.message || JSON.stringify(updErr)}`);
          } else {
            saved++;
          }
        } else {
          const { data: insData, error: insErr } = await db.from('collection_data').insert(payload).select();
          if (insErr) {
            errors.push(`insert ${row.shift_date} ${row.shift_type}: ${insErr.message || JSON.stringify(insErr)}`);
          } else {
            saved++;
            if (insData && insData[0]) {
              row.id = insData[0].id;
            }
          }
        }
      }
      if (errors.length > 0) {
        console.error('Save errors:', errors);
        setError(`Ошибки записи (${errors.length}): ${errors[0]}`);
      }
      await carryShortageToNextMonth();
      // Reload from DB to confirm persistence
      await loadData();
      setSuccessMsg(`Обновлено: ${saved} записей зафиксировано в БД.`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (e: any) {
      console.error('Refresh error:', e);
      setError('Ошибка обновления: ' + (e.message || ''));
    } finally {
      setUpdating(false);
    }
  }

  /** Save all rows + lock the month */
  async function handleSave() {
    if (!isDir) return;
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      let saved = 0;
      const errors: string[] = [];
      for (const row of rows) {
        const payload = {
          month_year: row.month_year,
          shift_date: row.shift_date,
          shift_type: row.shift_type,
          sbis_value: row.sbis_value || 0,
          fact_value: row.fact_value || 0,
          status: row.status,
          responsible_person: row.responsible_person || '',
          locked: true,
        };
        if (row.id) {
          const { error: updErr } = await db.from('collection_data').update(payload).eq('id', row.id);
          if (updErr) {
            errors.push(`update ${row.shift_date} ${row.shift_type}: ${updErr.message || JSON.stringify(updErr)}`);
          } else {
            saved++;
          }
        } else {
          const { data: insData, error: insErr } = await db.from('collection_data').insert(payload).select();
          if (insErr) {
            errors.push(`insert ${row.shift_date} ${row.shift_type}: ${insErr.message || JSON.stringify(insErr)}`);
          } else {
            saved++;
            if (insData && insData[0]) {
              row.id = insData[0].id;
            }
          }
        }
      }
      if (errors.length > 0) {
        console.error('Save errors:', errors);
        setError(`Ошибки записи (${errors.length}): ${errors[0]}`);
      }
      await carryShortageToNextMonth();
      // Reload from DB to confirm
      await loadData();
      setMonthLocked(true);
      setTempUnlocked(false);
      setUnlockedExpiry(null);
      setSuccessMsg(`Месяц заблокирован! Сохранено ${saved} записей.`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (e: any) {
      console.error('Save error:', e);
      setError('Ошибка сохранения: ' + (e.message || ''));
    } finally {
      setSaving(false);
    }
  }

  async function handleUnlock() {
    if (pinInput === UNLOCK_PIN) {
      setPinError(false);
      setShowUnlock(false);
      setPinInput('');
      setTempUnlocked(true);
      // Auto-lock after 15 minutes
      setUnlockedExpiry(Date.now() + 15 * 60 * 1000);
    } else {
      setPinError(true);
      setTimeout(() => setPinError(false), 2000);
    }
  }

  async function carryShortageToNextMonth() {
    try {
      const { data: currentShortages } = await db.from('collection_data')
        .select('*')
        .eq('month_year', period)
        .eq('status', 'shortage')
        .not('responsible_person', 'eq', '');

      if (!currentShortages || currentShortages.length === 0) return;

      const byPerson = new Map<string, number>();
      for (const row of currentShortages) {
        const name = (row as any).responsible_person;
        const discrepancy = Math.max(0, ((row as any).sbis_value || 0) - ((row as any).fact_value || 0));
        if (!name || discrepancy <= 0) continue;
        byPerson.set(name, (byPerson.get(name) || 0) + discrepancy);
      }
      if (byPerson.size === 0) return;

      const nextPeriod = getNextPeriod(period);
      const { data: profiles } = await db.from('profiles').select('id, full_name');
      const profileMap = new Map<string, string>();
      for (const p of (profiles || []) as any[]) {
        if (p.full_name) profileMap.set(p.full_name, p.id);
      }

      for (const [personName, totalShortage] of byPerson) {
        const profileId = profileMap.get(personName);
        if (!profileId) continue;
        const { data: nextSalaryRow } = await db.from('salary_data')
          .select('id, overtime')
          .eq('profile_id', profileId)
          .eq('month_year', nextPeriod)
          .maybeSingle();
        if (nextSalaryRow) {
          const currentOvertime = (nextSalaryRow as any).overtime || 0;
          await db.from('salary_data').update({
            overtime: currentOvertime + totalShortage
          }).eq('id', (nextSalaryRow as any).id);
        } else {
          await db.from('salary_data').insert({
            profile_id: profileId,
            hours_worked: 0,
            revenue: 0,
            days_in_month: 0,
            vacation_pay: 0,
            non_cash: 0,
            overtime: totalShortage,
            tax: 0,
            month_year: nextPeriod,
            user_id: user?.id || '00000000-0000-0000-0000-000000000000',
          });
        }
      }
    } catch (e) {
      console.error('Carry shortage error:', e);
    }
  }

  function updateRow(idx: number, field: string, value: any) {
    if (!isEditable) return;
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isEditable) {
      setError('Месяц заблокирован. Используйте разблокировку пин-кодом для загрузки файла.');
      return;
    }
    setImporting(true);
    setError(null);
    setImportInfo(null);
    try {
      const cashMap = await parseSabiReport(file);
      let matched = 0;
      setRows(prev => prev.map(row => {
        const key = `${row.shift_date}_${row.shift_type}`;
        const val = cashMap.get(key);
        if (val !== undefined && val > 0) {
          matched++;
          return { ...row, sbis_value: val };
        }
        return row;
      }));
      setImportInfo(`Загружено ${matched} смен из файла. Нажмите «Обновить» для сохранения.`);
      setTimeout(() => setImportInfo(null), 6000);
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки файла');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Загрузка данных...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full flex flex-col">
      {/* Unlock Modal */}
      {showUnlock && (
        <div className="fixed inset-0 z-[100] bg-foreground/30 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-card rounded-2xl p-6 border border-border shadow-2xl w-80">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-amber-500/20 rounded-lg flex items-center justify-center">
                <Shield className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-foreground font-bold text-sm">Разблокировка</h3>
                <p className="text-muted-foreground text-xs">Введите пин-код для временного доступа</p>
              </div>
            </div>
            <input type="password" inputMode="numeric" maxLength={4}
              value={pinInput}
              onChange={(e) => { setPinInput(e.target.value); setPinError(false); }}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
              autoFocus
              className={`w-full bg-secondary border ${pinError ? 'border-red-500' : 'border-border'} rounded-lg px-4 py-3 text-center text-2xl text-foreground tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-amber-500 mb-3`}
              placeholder="••••" />
            {pinError && <p className="text-red-600 text-xs mb-3 text-center">Неверный пин-код</p>}
            <div className="flex gap-2">
              <button onClick={() => { setShowUnlock(false); setPinInput(''); setPinError(false); }}
                className="flex-1 px-4 py-2 bg-secondary hover:bg-border text-foreground/80 text-sm rounded-lg transition-all">
                Отмена
              </button>
              <button onClick={handleUnlock}
                className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-all">
                Разблокировать
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="bg-card backdrop-blur-sm border-b border-border sticky top-0 z-50">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-2 py-2 sm:h-14 sm:py-0">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate('/dashboard')}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-all">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2">
                <Coins className="w-6 h-6 text-amber-600" />
                <h1 className="text-lg font-bold text-foreground">ИНКАССАЦИЯ</h1>
              </div>
              {monthLocked && (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-red-500/10 border border-red-500/30 rounded-md text-red-600 text-xs font-medium">
                  <Lock className="w-3 h-3" /> Заблокировано
                </span>
              )}
              {!monthLocked && (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-green-500/10 border border-green-500/30 rounded-md text-green-600 text-xs font-medium">
                  <Unlock className="w-3 h-3" /> Активно
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground/80 font-medium">За</span>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
                className="bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500">
                {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))}
                className="bg-secondary border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={loadData}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-all"
                title="Обновить данные из БД">
                <RefreshCw className="w-4 h-4" />
              </button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />
              <button onClick={() => fileRef.current?.click()} disabled={importing || !isEditable || !canImport}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-all">
                <FileSpreadsheet className="w-3.5 h-3.5" />
                {importing ? 'Загрузка...' : 'Загрузить XLSX'}
              </button>
              {monthLocked && canUnlock && (
                <button onClick={() => setShowUnlock(true)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-amber-600/20 border border-amber-500/30 hover:bg-amber-600/30 text-amber-600 text-xs font-medium rounded-lg transition-all">
                  <Unlock className="w-3.5 h-3.5" /> Разблокировать
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-4 w-full">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <p className="text-red-600 text-sm">{error}</p>
            <button onClick={() => setError(null)} className="ml-auto text-red-600/60 hover:text-red-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {importInfo && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3 mb-4 flex items-center gap-2">
            <Check className="w-4 h-4 text-blue-600 shrink-0" />
            <p className="text-blue-600 text-sm">{importInfo}</p>
          </div>
        )}
        {successMsg && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3 mb-4 flex items-center gap-2">
            <Check className="w-4 h-4 text-green-600 shrink-0" />
            <p className="text-green-600 text-sm">{successMsg}</p>
          </div>
        )}
        {tempUnlocked && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-4 flex items-center gap-2">
            <Unlock className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-amber-600 text-sm">Временная разблокировка активна. Автоблокировка через 15 минут.</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div className="bg-card rounded-xl p-4 border border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-amber-600 rounded-lg flex items-center justify-center">
                <Coins className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Итого нал. (СБИС)</p>
                <p className="text-lg font-bold text-amber-600">{fmt(totalSbis)} ₽</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg flex items-center justify-center">
                <Check className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Итого Факт</p>
                <p className="text-lg font-bold text-emerald-600">{fmt(totalFact)} ₽</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${totalDiscrepancy > 0 ? 'bg-gradient-to-br from-red-500 to-red-600' : totalDiscrepancy < 0 ? 'bg-gradient-to-br from-blue-500 to-blue-600' : 'bg-gradient-to-br from-slate-500 to-slate-600'}`}>
                <AlertTriangle className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Расхождение</p>
                <p className={`text-lg font-bold ${totalDiscrepancy > 0 ? 'text-red-600' : totalDiscrepancy < 0 ? 'text-blue-600' : 'text-foreground/80'}`}>
                  {totalDiscrepancy > 0 ? '+' : ''}{fmt(totalDiscrepancy)} ₽
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary">
                  <th className="text-center px-4 py-3 text-xs font-semibold text-foreground/80 min-w-[110px]">Дата</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-foreground/80 min-w-[60px]">Д/Н</th>
                  {colVisible('sbis_value') && <th className="text-center px-4 py-3 text-xs font-semibold text-amber-700 min-w-[130px]">{colLabel('sbis_value', 'Сбис ₽')}</th>}
                  <th className="text-center px-4 py-3 text-xs font-semibold text-emerald-700 min-w-[130px]">{colLabel('fact_value', 'Факт ₽')}</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-foreground/80 min-w-[130px]">Расхождение ₽</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-foreground/80 min-w-[220px]">Указать</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const discrepancy = (row.sbis_value || 0) - (row.fact_value || 0);
                  return (
                    <tr key={`${row.shift_date}_${row.shift_type}`}
                      className={`border-t border-border ${idx % 2 === 0 ? 'bg-card/60' : 'bg-card/60'}`}>
                      <td className="px-4 py-2.5 text-center">
                        <span className="text-sm text-foreground font-medium">{row.shift_date}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-xs font-bold
                          ${row.shift_type === 'Д'
                            ? 'bg-amber-500/20 text-amber-600 border border-amber-500/30'
                            : 'bg-indigo-500/20 text-indigo-600 border border-indigo-500/30'}`}>
                          {row.shift_type}
                        </span>
                      </td>
                      {colVisible('sbis_value') && <td className="px-4 py-2.5 text-center">
                        {row.sbis_value > 0 ? (
                          <span className="text-sm text-amber-600 font-medium">{fmt(row.sbis_value)}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground/70">—</span>
                        )}
                      </td>}
                      <td className="px-4 py-2.5 text-center">
                        {isEditable ? (
                          <input type="number" step="0.01"
                            value={row.fact_value || ''}
                            onChange={(e) => updateRow(idx, 'fact_value', parseFloat(e.target.value) || 0)}
                            className="w-28 bg-secondary border border-border rounded px-2 py-1 text-sm text-foreground text-right focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            placeholder="0" />
                        ) : (
                          row.fact_value > 0 ? (
                            <span className="text-sm text-emerald-600 font-medium">{fmt(row.fact_value)}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground/70">—</span>
                          )
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {discrepancy !== 0 ? (
                          <span className={`text-sm font-bold ${discrepancy > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                            {discrepancy > 0 ? '+' : ''}{fmt(discrepancy)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/70">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {isEditable ? (
                          <div className="flex items-center gap-1.5">
                            <select value={row.status || ''}
                              onChange={(e) => {
                                const newStatus = e.target.value || null;
                                updateRow(idx, 'status', newStatus);
                                if (newStatus !== 'shortage') updateRow(idx, 'responsible_person', '');
                              }}
                              className="bg-secondary border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500 max-w-[120px]">
                              <option value="">— Указать —</option>
                              {STATUS_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.icon} {o.label}</option>
                              ))}
                            </select>
                            {row.status === 'shortage' && (
                              <select value={row.responsible_person || ''}
                                onChange={(e) => updateRow(idx, 'responsible_person', e.target.value)}
                                className="bg-secondary border border-red-500/30 rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-red-500 max-w-[140px]">
                                <option value="">— ФИО —</option>
                                {fioList.map(name => (
                                  <option key={name} value={name}>{name}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        ) : (
                          <StatusBadge status={row.status} person={row.responsible_person} />
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-amber-500/40 bg-secondary font-bold">
                  <td colSpan={2} className="px-4 py-3 text-center text-sm text-foreground">ИТОГО</td>
                  <td className="px-4 py-3 text-center text-sm text-amber-600">{fmt(totalSbis)}</td>
                  <td className="px-4 py-3 text-center text-sm text-emerald-600">{fmt(totalFact)}</td>
                  <td className={`px-4 py-3 text-center text-sm ${totalDiscrepancy > 0 ? 'text-red-600' : totalDiscrepancy < 0 ? 'text-blue-600' : 'text-foreground/80'}`}>
                    {totalDiscrepancy > 0 ? '+' : ''}{fmt(totalDiscrepancy)}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {isDir && (
        <div className="sticky bottom-0 bg-card backdrop-blur-sm border-t border-border px-4 py-3">
          <div className="max-w-full mx-auto flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground shrink-0">
              {monthLocked && !tempUnlocked
                ? '🔒 Месяц заблокирован. Данные защищены от изменений.'
                : 'Обновить — зафиксировать в БД. Сохранить — заблокировать месяц.'}
            </p>
            <div className="flex items-center gap-3">
              <button onClick={handleRefresh} disabled={updating || !isEditable}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-all">
                {updating ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Обновить
              </button>
              <button onClick={handleSave} disabled={saving || !isEditable}
                className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-all">
                {saving ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Сохранить и заблокировать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, person }: { status: string | null; person?: string }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const opt = STATUS_OPTIONS.find(o => o.value === status);
  if (!opt) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`${opt.color} font-bold text-sm`}>{opt.icon}</span>
      <span className="text-xs text-foreground/80">{opt.label}</span>
      {status === 'shortage' && person && (
        <span className="text-xs text-red-700 font-medium ml-1">({person})</span>
      )}
    </div>
  );
}
