import { ArrowLeft, Banknote, Lock, Settings2, Unlock, Loader2, CalendarDays } from 'lucide-react';
import { MONTHS, fmt } from '@/components/salary/salaryUtils';

interface Props {
  onBack: () => void;
  selectedMonth: number;
  setSelectedMonth: (v: number) => void;
  selectedYear: number;
  setSelectedYear: (v: number) => void;
  years: number[];
  dRate: number;
  rowsCount: number;
  totalI: number;
  periodLocked: boolean;
  canLock: boolean;
  onUnlockPeriod: () => void;
  isDirector: boolean;
  isDeputy: boolean;
  showFullTable: boolean;
  setShowFullTable: (v: boolean) => void;
  canEditHours: boolean;
  onFillHours: () => void;
  tabelBusy: boolean;
  isResponsible: boolean;
}

export default function SalaryHeader({
  onBack, selectedMonth, setSelectedMonth, selectedYear, setSelectedYear, years, dRate, rowsCount, totalI,
  periodLocked, canLock, onUnlockPeriod, isDirector, isDeputy, showFullTable, setShowFullTable,
  canEditHours, onFillHours, tabelBusy, isResponsible,
}: Props) {
  return (
    <header className="bg-card backdrop-blur-sm border-b border-border sticky top-0 z-50">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-2 py-2 sm:h-14 sm:py-0">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-all">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <Banknote className="w-6 h-6 text-emerald-600" />
              <h1 className="page-title text-lg text-foreground">ЗАРПЛАТА</h1>
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
              <span>Сотр: <b className="text-foreground">{rowsCount}</b></span>
              <span>Итого: <b className="text-emerald-700">{fmt(totalI)} ₽</b></span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {periodLocked && (
              canLock ? (
                <button onClick={onUnlockPeriod}
                  className="flex items-center gap-1 text-xs text-white bg-amber-600 hover:bg-amber-700 px-2.5 py-1 rounded-lg transition-all"
                  title="Разблокировать таблицу сотрудников для правок">
                  <Unlock className="w-3 h-3" /> Разблокировать
                </button>
              ) : (
                <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-500/10 px-2 py-1 rounded-lg">
                  <Lock className="w-3 h-3" /> Заблокировано
                </span>
              )
            )}
            {isDirector && (
              <button onClick={() => setShowFullTable(!showFullTable)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${showFullTable ? 'bg-emerald-500 text-white' : 'bg-secondary text-foreground/80 hover:bg-border'}`}>
                {showFullTable ? 'Скрыть' : 'ПОЛНАЯ'}
              </button>
            )}
            {canEditHours && (
              <button onClick={onFillHours} disabled={tabelBusy}
                className="flex items-center gap-1 px-3 py-1.5 bg-secondary hover:bg-border text-foreground/80 text-xs font-medium rounded-lg transition-all disabled:opacity-50"
                title="Посчитать часы по сменам из раздела «Табель»">
                {tabelBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarDays className="w-3.5 h-3.5" />} Часы из табеля
              </button>
            )}
            {isDeputy && (
              <a href="/admin" className="flex items-center gap-1 px-3 py-1.5 bg-secondary hover:bg-border text-foreground/80 text-xs font-medium rounded-lg transition-all">
                <Settings2 className="w-3.5 h-3.5" /> Настройки ЗП
              </a>
            )}
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {isDirector ? '👁 Директор' : isDeputy ? '✏️ Зам. директора' : isResponsible ? '✏️ Ответственный' : '👤 Сотрудник'}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
