import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { PAY_LABELS, SBIS_URL, runJob, sbisCall, type PayKind, type SbisJob, type SbisStatus } from '@/lib/sbisApi';

const fmt = (s?: string | null) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '—');

export default function SbisSection() {
  const [st, setSt] = useState<SbisStatus | null>(null);
  const [keys, setKeys] = useState({ client_id: '', app_secret: '', secret_key: '' });
  const [points, setPoints] = useState<{ id: number; name: string; address: string }[]>([]);
  const [sel, setSel] = useState<number[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [include, setInclude] = useState<Record<PayKind, boolean>>({ cash: true, certificate: true, salary: true, bank: false });
  const [exclude, setExclude] = useState('Инкассация');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [job, setJob] = useState<Partial<SbisJob> | null>(null);

  const apply = (s: SbisStatus) => {
    setSt(s); setSel(s.points); setNames(s.point_names || {}); setInclude(s.include); setExclude((s.exclude_sber || []).join(', '));
    if (s.job && s.job.kind && !s.job.done) setJob(s.job);
  };
  const load = () => sbisCall<SbisStatus>({ action: 'status' }).then((r) => { if (r.error) setMsg({ ok: false, text: r.error }); else apply(r); });
  useEffect(() => { load(); }, []);

  const call = async (action: string, body: Record<string, unknown> = {}, ok = 'Сохранено') => {
    setBusy(action); setMsg(null);
    const r = await sbisCall<{ status?: SbisStatus; points?: typeof points }>({ action, ...body });
    setBusy('');
    if (r.error) { setMsg({ ok: false, text: r.error }); return null; }
    if (r.status) apply(r.status);
    setMsg({ ok: true, text: ok });
    return r;
  };

  const loadPoints = async () => {
    const r = await call('points', {}, 'Список точек продаж получен');
    if (r?.points) setPoints(r.points);
  };

  const save = () => call('settings_save', {
    points: sel, point_names: Object.fromEntries(sel.map((id) => [String(id), names[String(id)] || points.find((p) => p.id === id)?.name || `Точка ${id}`])),
    include, exclude_sber: exclude.split(',').map((x) => x.trim()).filter(Boolean),
  });

  const backfill = async (force = false) => {
    if (!force && !confirm('Загрузить продажи из СБИС за последние 2 года? Это разовая операция и может занять 10–30 минут — не закрывайте страницу.')) return;
    setBusy('backfill'); setMsg(null);
    const err = await runJob({ action: 'backfill', force }, setJob);
    setBusy('');
    if (err) setMsg({ ok: false, text: err }); else { setMsg({ ok: true, text: 'Выгрузка за 2 года завершена, выручка перенесена в бухгалтерию' }); load(); }
  };

  if (!st) return <div className="flex justify-center py-10"><Icon name="Loader2" size={22} className="animate-spin text-muted-foreground" /></div>;
  const cronUrl = st.cron_key ? `${SBIS_URL}?cron=${st.cron_key}` : '';
  const shownPoints = points.length ? points : sel.map((id) => ({ id, name: names[String(id)] || `Точка ${id}`, address: '' }));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Icon name="Store" size={18} className="text-emerald-600" />
          <h2 className="font-semibold">СБИС Престо — подключение</h2>
          <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${st.has_keys ? 'bg-emerald-500/10 text-emerald-700' : 'bg-secondary text-muted-foreground'}`}>
            {st.has_keys ? `Подключено (${st.client_id})` : 'Не подключено'}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          В СБИС: Настройки → Интеграция → API → «Добавить приложение», включите сервисную авторизацию и доступ к «Розница / Presto».
          Скопируйте сюда ID приложения, защищённый ключ и сервисный ключ. Ключи хранятся в зашифрованном виде.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input placeholder="ID приложения (app_client_id)" value={keys.client_id} onChange={(e) => setKeys({ ...keys, client_id: e.target.value })} />
          <Input placeholder="Защищённый ключ (app_secret)" type="password" value={keys.app_secret} onChange={(e) => setKeys({ ...keys, app_secret: e.target.value })} />
          <Input placeholder="Сервисный ключ (secret_key)" type="password" value={keys.secret_key} onChange={(e) => setKeys({ ...keys, secret_key: e.target.value })} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => call('keys_save', keys, 'Ключи проверены и сохранены').then((r) => r && setKeys({ client_id: '', app_secret: '', secret_key: '' }))} disabled={!!busy}>
            {busy === 'keys_save' && <Icon name="Loader2" size={14} className="animate-spin" />}Проверить и сохранить
          </Button>
          {st.has_keys && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => confirm('Удалить ключи СБИС?') && call('keys_delete', {}, 'Ключи удалены')}>Отключить</Button>}
        </div>
      </div>

      {st.has_keys && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Точки продаж и что считать выручкой</h2>
            <Button size="sm" variant="outline" className="ml-auto" onClick={loadPoints} disabled={!!busy}>
              {busy === 'points' ? <Icon name="Loader2" size={14} className="animate-spin" /> : <Icon name="RefreshCw" size={14} />}Получить точки из СБИС
            </Button>
          </div>
          {shownPoints.length === 0 ? <p className="text-sm text-muted-foreground">Нажмите «Получить точки из СБИС» и отметьте свои кафе.</p> : (
            <div className="space-y-1">
              {shownPoints.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={sel.includes(p.id)} onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} />
                  <span className="font-medium">{p.name}</span><span className="text-muted-foreground">{p.address}</span>
                </label>
              ))}
            </div>
          )}
          <div>
            <div className="mb-1 text-sm font-medium">Статья «Кассовый оборот» = сумма оплат:</div>
            <div className="grid gap-1 sm:grid-cols-2">
              {(Object.keys(PAY_LABELS) as PayKind[]).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!include[k]} onChange={(e) => setInclude({ ...include, [k]: e.target.checked })} />{PAY_LABELS[k]}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Безнал, QR и терминал не включаются: эти деньги приходят на расчётный счёт и уже есть в выписке СберБизнес.</p>
          </div>
          <div>
            <div className="mb-1 text-sm font-medium">Поступления Сбера, которые НЕ добавлять в общий итог (статьи через запятую)</div>
            <Input value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="Инкассация" />
            <p className="mt-1 text-xs text-muted-foreground">Инкассация — это те же наличные из кассы, иначе они посчитаются дважды.</p>
          </div>
          <Button size="sm" onClick={save} disabled={!!busy}>{busy === 'settings_save' && <Icon name="Loader2" size={14} className="animate-spin" />}Сохранить настройки</Button>
        </div>
      )}

      {st.configured && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <h2 className="font-semibold">Выгрузка данных</h2>
          <div className="text-sm text-muted-foreground">
            В базе: {st.days ? `${fmt(st.data_from)} — ${fmt(st.data_to)} (${st.days} дн.)` : 'данных пока нет'}
            {st.last_auto && <> · последняя автозагрузка {st.last_auto.replace('T', ' ')}</>}
          </div>
          {st.backfill_done ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Icon name="CheckCircle" size={16} className="text-emerald-600" />Разовая выгрузка за 2 года выполнена {fmt(st.backfill_done)}
              <Button size="sm" variant="ghost" onClick={() => confirm('Повторить выгрузку за 2 года заново?') && backfill(true)} disabled={!!busy}>Повторить</Button>
            </div>
          ) : (
            <Button onClick={() => backfill()} disabled={!!busy}>
              {busy === 'backfill' ? <Icon name="Loader2" size={16} className="animate-spin" /> : <Icon name="Download" size={16} />}Выгрузить за последние 2 года (разово)
            </Button>
          )}
          {job && job.kind && (
            <div className="space-y-1">
              <Progress value={job.percent || 0} />
              <div className="text-xs text-muted-foreground">
                {job.done ? 'Готово' : `Загружено ${job.percent || 0}% · дошли до ${fmt(job.cursor)} · продаж: ${job.orders || 0}`}
                {job.error && <span className="text-amber-600"> · {job.error}</span>}
              </div>
            </div>
          )}
          {cronUrl && (
            <div className="rounded-lg bg-secondary p-3 text-xs space-y-1">
              <div className="font-medium text-sm">Планировщик (автозагрузка новых продаж)</div>
              <p>Поставьте в планировщик (cron-job.org или cron на сервере) запуск этой ссылки <b>каждые 10–15 минут</b>. Раз в час она догружает последние 3 дня продаж; если идёт выгрузка — продолжает её.</p>
              <code className="block select-all break-all">{cronUrl}</code>
              <p className="text-muted-foreground">На Beget: Панель → CRON → добавить задачу <code className="select-all">*/15 * * * * curl -s "{cronUrl}" &gt;/dev/null</code></p>
              <Button size="sm" variant="ghost" onClick={() => confirm('Сменить ключ? Старая ссылка перестанет работать.') && call('cron_reset', {}, 'Ключ планировщика обновлён')}>Сменить ключ</Button>
            </div>
          )}
        </div>
      )}

      {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}
    </div>
  );
}
