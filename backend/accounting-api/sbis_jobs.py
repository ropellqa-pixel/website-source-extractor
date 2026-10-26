"""Загрузка продаж СБИС по шагам: задание хранится в app_settings('sbis_job') и продолжается
следующим вызовом (с сайта или планировщиком), пока не будет пройден весь промежуток."""
import json
import time
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

import sbis_client as sbis

CHUNK_DAYS = 7
CAT = 'Кассовый оборот'
KINDS = ('cash', 'bank', 'certificate', 'salary')
DEFAULT_INCLUDE = {'cash': True, 'certificate': True, 'salary': True, 'bank': False}


def jget(cur, schema: str, key: str) -> Dict[str, Any]:
    cur.execute(f'SELECT value FROM {schema}.app_settings WHERE key = %s', (key,))
    r = cur.fetchone()
    if not r or r[0] is None:
        return {}
    return r[0] if isinstance(r[0], dict) else json.loads(r[0])


def jset(cur, schema: str, key: str, value: Dict[str, Any], who: str = 'СБИС') -> None:
    cur.execute(f'INSERT INTO {schema}.app_settings (key, value, updated_by) VALUES (%s, %s, %s) '
                f'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()',
                (key, json.dumps(value, ensure_ascii=False, default=str), who))


def new_job(kind: str, d_from: str, d_to: str, points: List[int], who: str) -> Dict[str, Any]:
    return {'kind': kind, 'from': d_from, 'to': d_to, 'points': points, 'pi': 0, 'cursor': d_from, 'page': 0,
            'done': False, 'error': None, 'by': who, 'started': date.today().isoformat(), 'orders': 0, 'days_done': 0}


def progress(job: Dict[str, Any]) -> Dict[str, Any]:
    if not job:
        return {}
    total = max(1, (date.fromisoformat(job['to']) - date.fromisoformat(job['from'])).days + 1) * max(1, len(job['points']))
    done_days = job.get('pi', 0) * (total // max(1, len(job['points']))) + \
        max(0, (date.fromisoformat(job['cursor']) - date.fromisoformat(job['from'])).days)
    pct = 100 if job.get('done') else min(99, int(done_days * 100 / total))
    return {'kind': job['kind'], 'from': job['from'], 'to': job['to'], 'done': job.get('done', False), 'error': job.get('error'),
            'percent': pct, 'orders': job.get('orders', 0), 'cursor': job.get('cursor'), 'by': job.get('by')}


def _apply_page(cur, schema: str, point: int, orders: List[Dict[str, Any]]) -> int:
    agg: Dict[str, Dict[str, float]] = {}
    for o in orders:
        if o.get('Deleted'):
            continue
        d = sbis.order_day(o)
        if not d:
            continue
        a = agg.setdefault(d, {'cash': 0.0, 'bank': 0.0, 'certificate': 0.0, 'salary': 0.0, 'returns': 0.0, 'checks': 0})
        s = sbis.order_sums(o)
        for k in KINDS:
            a[k] += s[k]
        if o.get('Return'):
            a['returns'] += sum(abs(v) for v in s.values())
        a['checks'] += 1
    for d, a in agg.items():
        cur.execute(f'INSERT INTO {schema}.sbis_daily (point_id, day, cash, bank, certificate, salary, returns, checks) '
                    f'VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (point_id, day) DO UPDATE SET '
                    f'cash = sbis_daily.cash + EXCLUDED.cash, bank = sbis_daily.bank + EXCLUDED.bank, '
                    f'certificate = sbis_daily.certificate + EXCLUDED.certificate, salary = sbis_daily.salary + EXCLUDED.salary, '
                    f'returns = sbis_daily.returns + EXCLUDED.returns, checks = sbis_daily.checks + EXCLUDED.checks, updated_at = now()',
                    (point, d, round(a['cash'], 2), round(a['bank'], 2), round(a['certificate'], 2), round(a['salary'], 2),
                     round(a['returns'], 2), int(a['checks'])))
    return len(orders)


def _cat_id(cur, schema: str) -> int:
    cur.execute(f"SELECT id FROM {schema}.acc_categories WHERE kind = 'income' AND lower(name) = lower(%s)", (CAT,))
    r = cur.fetchone()
    if r:
        return r[0]
    cur.execute(f"INSERT INTO {schema}.acc_categories (kind, name) VALUES ('income', %s) RETURNING id", (CAT,))
    return cur.fetchone()[0]


def post_entries(cur, schema: str, d_from: str, d_to: str, settings: Dict[str, Any]) -> int:
    """Выручка СБИС по дням → бухгалтерия, статья «Кассовый оборот» (без оплат, что идут на расчётный счёт)."""
    inc = {**DEFAULT_INCLUDE, **(settings.get('include') or {})}
    points = [int(p) for p in settings.get('points') or []]
    if not points:
        return 0
    cols = ' + '.join(k for k in KINDS if inc.get(k)) or '0'
    cur.execute(f'SELECT day, SUM({cols}), SUM(checks) FROM {schema}.sbis_daily WHERE point_id = ANY(%s) AND day BETWEEN %s AND %s GROUP BY 1',
                (points, d_from, d_to))
    rows = cur.fetchall()
    cur.execute(f'SELECT period FROM {schema}.acc_periods WHERE closed')
    closed = {r[0] for r in cur.fetchall()}
    cat = _cat_id(cur, schema)
    n = 0
    seen = set()
    for day, total, checks in rows:
        d = day.isoformat()
        period = d[:7]
        if period in closed:
            continue
        seen.add(d)
        total = float(total or 0)
        cur.execute(f'INSERT INTO {schema}.acc_entries (kind, entry_date, amount, category_id, comment, source, source_key, period, created_by, void) '
                    f"VALUES ('income', %s, %s, %s, %s, 'sbis', %s, %s, 'СБИС Престо', %s) "
                    f'ON CONFLICT (source, source_key) WHERE source IS NOT NULL DO UPDATE SET amount = EXCLUDED.amount, '
                    f'category_id = EXCLUDED.category_id, comment = EXCLUDED.comment, period = EXCLUDED.period, void = EXCLUDED.void, updated_at = now()',
                    (d, round(abs(total), 2) or 0.01, cat, f'СБИС Престо: кассовый оборот за день, чеков: {int(checks or 0)}',
                     d, period, total <= 0))
        n += 1
    cur.execute(f"UPDATE {schema}.acc_entries SET void = true WHERE source = 'sbis' AND entry_date BETWEEN %s AND %s "
                f'AND NOT (source_key = ANY(%s)) AND NOT (period = ANY(%s))', (d_from, d_to, list(seen) or [''], list(closed) or ['']))
    return n


def run(conn, cur, schema: str, client: 'sbis.Client', settings: Dict[str, Any], budget_s: float) -> Dict[str, Any]:
    """Выполняет задание столько, сколько позволяет время. Каждая страница — отдельная транзакция."""
    t0 = time.time()
    job = jget(cur, schema, 'sbis_job')
    if not job or job.get('done'):
        return progress(job)
    to = date.fromisoformat(job['to'])
    while time.time() - t0 < budget_s:
        if job['pi'] >= len(job['points']):
            post_entries(cur, schema, job['from'], job['to'], settings)
            job['done'] = True
            job['finished'] = date.today().isoformat()
            if job['kind'] == 'backfill':
                s = jget(cur, schema, 'sbis')
                s['backfill_done'] = date.today().isoformat()
                jset(cur, schema, 'sbis', s)
            break
        point = int(job['points'][job['pi']])
        c_from = date.fromisoformat(job['cursor'])
        c_to = min(to, c_from + timedelta(days=CHUNK_DAYS - 1))
        try:
            orders = client.orders(point, c_from.isoformat(), c_to.isoformat(), job['page'])
        except sbis.RateLimit as e:
            job['error'] = str(e)
            break
        conn.autocommit = False
        try:
            if job['page'] == 0:
                cur.execute(f'DELETE FROM {schema}.sbis_daily WHERE point_id = %s AND day BETWEEN %s AND %s',
                            (point, c_from.isoformat(), c_to.isoformat()))
            job['orders'] = job.get('orders', 0) + _apply_page(cur, schema, point, orders)
            job['error'] = None
            if len(orders) >= sbis.PAGE:
                job['page'] += 1
            else:
                job['page'] = 0
                if c_to >= to:
                    job['pi'] += 1
                    job['cursor'] = job['from']
                else:
                    job['cursor'] = (c_to + timedelta(days=1)).isoformat()
                post_entries(cur, schema, c_from.isoformat(), c_to.isoformat(), settings)
            jset(cur, schema, 'sbis_job', job)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.autocommit = True
    jset(cur, schema, 'sbis_job', job)
    return progress(job)


def start(cur, schema: str, kind: str, d_from: str, d_to: str, points: List[int], who: str) -> Optional[str]:
    job = jget(cur, schema, 'sbis_job')
    if job and not job.get('done') and job.get('kind') == 'backfill' and kind != 'backfill':
        return 'Сейчас идёт разовая выгрузка за 2 года — дождитесь её окончания'
    jset(cur, schema, 'sbis_job', new_job(kind, d_from, d_to, points, who), who)
    return None
