"""Еженедельная выплата зарплаты: каждое воскресенье каждому сотруднику добавляется сумма из столбца
«НЕДЕЛЯ» раздела «Зарплата», в последний день месяца — остаток, чтобы сумма выплат совпала с ИТОГО.
Файл одинаковый в accounting-api и sber-api."""
from datetime import date, timedelta
from typing import Any, Dict, List

from formulas import compute_period, global_params, load_config


def _last_day(y: int, m: int) -> date:
    return date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)


def _staff_id(cur, schema: str, profile_id: str, name: str) -> int:
    cur.execute(f'SELECT id FROM {schema}.acc_staff WHERE profile_id = %s ORDER BY id LIMIT 1', (profile_id,))
    r = cur.fetchone()
    if r:
        return r[0]
    cur.execute(f"INSERT INTO {schema}.acc_staff (name, profile_id, pay_type, rate) VALUES (%s, %s, 'tabel', 0) RETURNING id",
                (name or 'Сотрудник', profile_id))
    return cur.fetchone()[0]


def _months(today: date) -> List[date]:
    first = today.replace(day=1)
    prev = (first - timedelta(days=1)).replace(day=1)
    return [prev, first]


def run(cur, schema: str, today: date = None) -> Dict[str, Any]:
    today = today or date.today()
    cur.execute(f"SELECT value FROM {schema}.app_settings WHERE key = 'accounting'")
    r = cur.fetchone()
    start = str(((r[0] if r and isinstance(r[0], dict) else {}) or {}).get('start_period') or '2000-01')
    cfg, params = load_config(cur, schema), global_params(cur, schema)
    added = 0
    for m in _months(today):
        period = m.strftime('%Y-%m')
        if period < start:
            continue
        cur.execute(f'SELECT closed FROM {schema}.acc_periods WHERE period = %s', (period,))
        c = cur.fetchone()
        if c and c[0]:
            continue
        last = _last_day(m.year, m.month)
        sundays = [m + timedelta(days=i) for i in range((last - m).days + 1) if (m + timedelta(days=i)).weekday() == 6]
        due = [d for d in sundays if d <= today]
        final = today >= last
        if not due and not final:
            continue
        calc = compute_period(cur, schema, f'{m.month:02d}.{m.year}', cfg, params)
        people = [p for p in calc['people'] if round(p['total'], 2) > 0]
        if not people:
            continue
        cur.execute(f'SELECT id, profile_id FROM {schema}.acc_staff WHERE profile_id = ANY(%s) ORDER BY id DESC',
                    ([p['profile_id'] for p in people],))
        sid_of = {pid: sid for sid, pid in cur.fetchall()}
        cur.execute(f"SELECT staff_id, source_key, amount FROM {schema}.acc_payments "
                    f"WHERE COALESCE(period, to_char(pay_date, 'YYYY-MM')) = %s", (period,))
        paid_other: Dict[int, float] = {}
        keys = set()
        for sid, key, amount in cur.fetchall():
            if key:
                keys.add(key)
            if not (key and key.endswith(':final')):
                paid_other[sid] = paid_other.get(sid, 0.0) + float(amount)
        rows, finals_drop = [], []
        for p in people:
            total = round(p['total'], 2)
            sid = sid_of.get(p['profile_id']) or _staff_id(cur, schema, p['profile_id'], p['name'])
            base = f"week:{period}:{p['kind']}:{p['profile_id']}"
            paid = paid_other.get(sid, 0.0)
            for i, d in enumerate(due, 1):
                key = f'{base}:{d.isoformat()}'
                if key in keys:
                    continue
                amount = round(min(p['week'], total - paid), 2)
                if amount <= 0:
                    continue
                paid += amount
                rows.append((sid, d.isoformat(), amount, f'Неделя {i} из «Зарплаты»', 'Авто: неделя', key))
            if final:
                key = f'{base}:final'
                finals_drop.append(key)
                rest = round(total - paid, 2)
                if rest > 0:
                    rows.append((sid, last.isoformat(), rest, 'Остаток до ИТОГО за месяц', 'Авто: итог месяца', key))
        if finals_drop:
            cur.execute(f'DELETE FROM {schema}.acc_payments WHERE source_key = ANY(%s)', (finals_drop,))
        if rows:
            cur.execute(f'INSERT INTO {schema}.acc_payments (staff_id, pay_date, amount, period, comment, created_by, source_key) '
                        f'SELECT s, d::date, a, %s, c, b, k FROM unnest(%s::bigint[], %s::text[], %s::numeric[], %s::text[], %s::text[], %s::text[]) '
                        f'AS v(s, d, a, c, b, k) ON CONFLICT DO NOTHING',
                        (period, [r[0] for r in rows], [r[1] for r in rows], [r[2] for r in rows],
                         [r[3] for r in rows], [r[4] for r in rows], [r[5] for r in rows]))
            added += len(rows)
    return {'weekly_added': added}
