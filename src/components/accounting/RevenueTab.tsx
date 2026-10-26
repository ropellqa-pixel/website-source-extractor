import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { rub, fmtDay } from '@/lib/accountingApi';
import { downloadBase64, runJob, sbisCall, type SbisJob, type SbisReport, type SbisStatus } from '@/lib/sbisApi';

interface Props { from: string; to: string; canLoad: boolean; onLoaded: () => void }

export default function RevenueTab({ from, to, canLoad, onLoaded }: Props) {
  const [rep, setRep] = useState<SbisReport | null>(null);
  const [st, setSt] = useState<SbisStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<Partial<SbisJob> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [r, s] = await Promise.all([
      sbisCall<SbisReport>({ action: 'report', date_from: from, date_to: to }),
      sbisCall<SbisStatus>({ action: 'status' }),
    ]);
    if (r.error) setError(r.error); else setRep(r);
    if (!s.error) setSt(s);
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const fetchSbis = async () => {
    setBusy('load'); setError(null); setJob(null);
    const err = await runJob({ action: 'load', date_from: from, date_to: to }, setJob);
    setBusy('');
    if (err) setError(err);
    load(); onLoaded();
  };

  const xlsx = async () => {
    setBusy('xlsx'); setError(null);
    const r = await sbisCall<{ file: string; name: string }>({ action: 'xlsx', date_from: from, date_to: to });
    setBusy('');
    if (r.error) setError(r.error); else downloadBase64(r.file, r.name);
  };

  const t = rep?.totals;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {canLoad && (
          <Button size="sm" variant="outline" onClick={fetchSbis} disabled={!!busy || !st?.configured} title={st?.configured ? '' : 'Настройте СБИС в админ-панели'}>
            {busy === 'load' ? <Icon name="Loader2" size={15} className="animate-spin" /> : <Icon name="RefreshCw" size={15} />}Получить данные из СБИС за период
          </Button>
        )}
        <Button size="sm" onClick={xlsx} disabled={!!busy}>
          {busy === 'xlsx' ? <Icon name="Loader2" size={15} className="animate-spin" /> : <Icon name="FileSpreadsheet" size={15} />}Полный отчёт xlsx
        </Button>
        {st && !st.configured && <span className="text-xs text-amber-600">СБИС не настроен — Админ-панель → СБИС Престо</span>}
        {st?.data_to && <span className="ml-auto text-xs text-muted-foreground">Данные СБИС есть по {fmtDay(st.data_to)}</span>}
      </div>
      {job && busy === 'load' && (
        <div className="space-y-1"><Progress value={job.percent || 0} /><div className="text-xs text-muted-foreground">Загрузка {job.percent || 0}% · продаж: {job.orders || 0}{job.error && ` · ${job.error}`}</div></div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {t && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4">
            <div className="text-xs text-muted-foreground">СБИС Престо · кассовый оборот</div>
            <div className="text-xl font-semibold tabular-nums">{rub(t.turnover)}</div>
            <div className="text-xs text-muted-foreground">чеков: {t.checks} · безнал {rub(t.bank_sbis)} не учтён</div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="text-xs text-muted-foreground">СберБизнес · поступления на счёт</div>
            <div className="text-xl font-semibold tabular-nums">{rub(t.sber)}</div>
            <div className="text-xs text-muted-foreground">без: {rep.exclude_sber.join(', ') || '—'} ({rub(t.sber_excluded)})</div>
          </div>
          <div className="rounded-xl border border-emerald-600/40 bg-emerald-600/5 p-4">
            <div className="text-xs text-emerald-700">Итог общий</div>
            <div className="text-2xl font-bold text-emerald-700 tabular-nums">{rub(t.total)}</div>
          </div>
        </div>
      )}

      {rep && (
        <div className="overflow-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-3 py-2 font-medium">Дата</th>
                <th className="px-3 py-2 text-right font-medium">Наличные</th>
                <th className="px-3 py-2 text-right font-medium">Сертиф./з/п</th>
                <th className="px-3 py-2 text-right font-medium">Кассовый оборот</th>
                <th className="hidden px-3 py-2 text-right font-medium md:table-cell">Безнал СБИС</th>
                <th className="px-3 py-2 text-right font-medium">Сбер</th>
                <th className="px-3 py-2 text-right font-medium">Итог</th>
              </tr>
            </thead>
            <tbody>
              {rep.days.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">За этот период данных нет</td></tr>}
              {rep.days.map((d) => (
                <tr key={d.date} className="border-b last:border-0 hover:bg-secondary/40 tabular-nums">
                  <td className="whitespace-nowrap px-3 py-2">{fmtDay(d.date)}</td>
                  <td className="px-3 py-2 text-right">{rub(d.cash)}</td>
                  <td className="px-3 py-2 text-right">{rub(d.certificate + d.salary)}</td>
                  <td className="px-3 py-2 text-right font-medium">{rub(d.turnover)}</td>
                  <td className="hidden px-3 py-2 text-right text-muted-foreground md:table-cell">{rub(d.bank_sbis)}</td>
                  <td className="px-3 py-2 text-right">{rub(d.sber)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-emerald-700">{rub(d.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
