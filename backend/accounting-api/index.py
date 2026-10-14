import json
import os
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Tuple

import psycopg2

from access import current_user
from bank import guess_category, parse_file
from formulas import compute_period, global_params, load_config

SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')
CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Authorization',
    'Access-Control-Max-Age': '86400',
}
KINDS = {'income', 'expense'}
PAY_TYPES = {'salary', 'percent', 'hourly', 'tabel'}
PERIOD_RE = re.compile(r'^\d{4}-(0[1-9]|1[0-2])$')
CAT_EMP = 'Зарплата сотрудников'
CAT_MGR = 'Зарплата руководителей'
CAT_COL = 'Инкассация'
CP_KINDS = {'supplier': 'Поставщик', 'customer': 'Покупатель', 'landlord': 'Арендодатель', 'other': 'Прочее'}


def _resp(status: int, payload: Any) -> Dict[str, Any]:
    return {'statusCode': status, 'headers': {**CORS, 'Content-Type': 'application/json'},
            'body': json.dumps(payload, ensure_ascii=False, default=str)}


def _err(text: str, status: int = 400) -> Dict[str, Any]:
    return _resp(status, {'error': text})


def _money(v: Any, allow_zero: bool = False) -> Optional[Decimal]:
    try:
        d = Decimal(str(v).replace(' ', '').replace(',', '.')).quantize(Decimal('0.01'))
    except (InvalidOperation, ValueError):
        return None
    if d < 0 or (d == 0 and not allow_zero) or d > Decimal('999999999999'):
        return None
    return d


def _date(v: Any) -> Optional[str]:
    try:
        return date.fromisoformat(str(v)[:10]).isoformat()
    except ValueError:
        return None


def _num(v: Any) -> float:
    return float(v) if v is not None else 0.0


def _period_of(d: str) -> str:
    return str(d)[:7]


def _my(period: str) -> str:
    return f'{period[5:7]}.{period[:4]}'


def _last_day(period: str) -> str:
    y, m = int(period[:4]), int(period[5:7])
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return date.fromordinal(nxt.toordinal() - 1).isoformat()


def _range(body: Dict[str, Any]) -> Tuple[str, str]:
    return (_date(body.get('date_from')) or '2000-01-01', _date(body.get('date_to')) or '2100-12-31')


def _log(cur, user: Dict[str, Any], action: str, details: str) -> None:
    cur.execute(f'INSERT INTO {SCHEMA}.acc_log (user_name, action, details) VALUES (%s, %s, %s)',
                (user['name'], action, details[:500]))


def _cat_id(cur, kind: str, name: str) -> int:
    cur.execute(f'SELECT id FROM {SCHEMA}.acc_categories WHERE kind = %s AND lower(name) = lower(%s)', (kind, name))
    r = cur.fetchone()
    if r:
        return r[0]
    cur.execute(f'INSERT INTO {SCHEMA}.acc_categories (kind, name) VALUES (%s, %s) RETURNING id', (kind, name))
    return cur.fetchone()[0]


def _setting(cur, key: str, default: Any) -> Any:
    cur.execute(f'SELECT value FROM {SCHEMA}.app_settings WHERE key = %s', (key,))
    r = cur.fetchone()
    if not r:
        return default
    return r[0] if isinstance(r[0], (dict, list)) else json.loads(r[0])


def _start(cur) -> str:
    v = str((_setting(cur, 'accounting', {}) or {}).get('start_period') or '2000-01')
    return v if PERIOD_RE.match(v) else '2000-01'


def _closed(cur) -> Dict[str, Dict[str, Any]]:
    cur.execute(f'SELECT period, closed, closed_at, closed_by, synced_at, snapshot FROM {SCHEMA}.acc_periods')
    return {r[0]: {'closed': r[1], 'closed_at': r[2], 'closed_by': r[3], 'synced_at': r[4], 'snapshot': r[5]}
            for r in cur.fetchall()}


def _is_closed(cur, period: str) -> bool:
    cur.execute(f'SELECT closed FROM {SCHEMA}.acc_periods WHERE period = %s', (period,))
    r = cur.fetchone()
    return bool(r and r[0])


# ---------------------------------------------------------------- синхронизация месяца

def _data_periods(cur) -> List[str]:
    cur.execute(f"SELECT month_year FROM {SCHEMA}.salary_settings WHERE month_year ~ '^\\d{{2}}\\.\\d{{4}}$' "
                f"UNION SELECT month_year FROM {SCHEMA}.collection_data WHERE month_year ~ '^\\d{{2}}\\.\\d{{4}}$' "
                f"UNION SELECT month_year FROM {SCHEMA}.manager_data WHERE month_year ~ '^\\d{{2}}\\.\\d{{4}}$' "
                f"AND (COALESCE(osn_hours,0) + COALESCE(dop_hours,0) + COALESCE(doplaty,0) + COALESCE(vacation_pay,0)) > 0")
    start = _start(cur)
    return sorted(p for p in {f'{r[0][3:]}-{r[0][:2]}' for r in cur.fetchall()} if p >= start)


def _fingerprint(cur, period: str, cfg: Dict[str, Any], params: Dict[str, float]) -> str:
    my = _my(period)
    cur.execute(f"SELECT md5(COALESCE((SELECT string_agg(t::text, '|' ORDER BY t::text) FROM {SCHEMA}.salary_data t WHERE month_year = %s), '') "
                f"|| COALESCE((SELECT string_agg(t::text, '|' ORDER BY t::text) FROM {SCHEMA}.manager_data t WHERE month_year = %s), '') "
                f"|| COALESCE((SELECT revenue::text || '/' || days_in_month::text FROM {SCHEMA}.salary_settings WHERE month_year = %s LIMIT 1), '') "
                f"|| COALESCE((SELECT string_agg(shift_date || shift_type || COALESCE(fact_value, 0)::text, '|' ORDER BY shift_date, shift_type) "
                f"FROM {SCHEMA}.collection_data WHERE month_year = %s), '') "
                f"|| COALESCE((SELECT string_agg(id::text || ':' || profile_id, ',' ORDER BY id) FROM {SCHEMA}.acc_staff), '') "
                f"|| %s)", (my, my, my, my, json.dumps([cfg, params], sort_keys=True, ensure_ascii=False)))
    return cur.fetchone()[0]


def _upsert_entry(cur, source: str, key: str, kind: str, d: str, amount: float, cat: int, comment: str, period: str) -> None:
    cur.execute(f'INSERT INTO {SCHEMA}.acc_entries (kind, entry_date, amount, category_id, comment, source, source_key, period, created_by) '
                f"VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'Синхронизация') "
                f'ON CONFLICT (source, source_key) WHERE source IS NOT NULL DO UPDATE SET kind = EXCLUDED.kind, '
                f'entry_date = EXCLUDED.entry_date, amount = EXCLUDED.amount, category_id = EXCLUDED.category_id, '
                f'comment = EXCLUDED.comment, period = EXCLUDED.period, void = false, updated_at = now()',
                (kind, d, round(amount, 2), cat, comment, source, key, period))


def _staff_for_profile(cur, profile_id: str, name: str) -> int:
    cur.execute(f'SELECT id FROM {SCHEMA}.acc_staff WHERE profile_id = %s ORDER BY id LIMIT 1', (profile_id,))
    r = cur.fetchone()
    if r:
        return r[0]
    cur.execute(f"INSERT INTO {SCHEMA}.acc_staff (name, profile_id, pay_type, rate) VALUES (%s, %s, 'tabel', 0) RETURNING id",
                (name or 'Сотрудник', profile_id))
    return cur.fetchone()[0]


def sync_period(cur, period: str, cfg=None, params=None, force: bool = False) -> Dict[str, Any]:
    """Переносит в бухгалтерию данные месяца: ИТОГО к выдаче из «Зарплаты» (расход + начисления сотрудникам)
    и фактическую инкассацию по дням (доход). Записи постоянные; закрытый месяц не трогается."""
    if _is_closed(cur, period):
        return {'period': period, 'skipped': 'closed'}
    if period < _start(cur):
        return {'period': period, 'skipped': 'before_start'}
    cfg = cfg or load_config(cur, SCHEMA)
    params = params or global_params(cur, SCHEMA)
    fp = _fingerprint(cur, period, cfg, params)
    cur.execute(f'SELECT fingerprint, snapshot FROM {SCHEMA}.acc_periods WHERE period = %s', (period,))
    prev = cur.fetchone()
    if prev and prev[0] == fp and not force:
        return {'period': period, 'skipped': 'unchanged', **(prev[1] or {})}
    calc = compute_period(cur, SCHEMA, _my(period), cfg, params)
    last = _last_day(period)
    totals = {'emp': 0.0, 'mgr': 0.0}
    counts = {'emp': 0, 'mgr': 0}
    keep_acc: List[str] = []
    for p in calc['people']:
        totals[p['kind']] += p['raw']
        if p['total'] == 0:
            continue
        counts[p['kind']] += 1
        sid = _staff_for_profile(cur, p['profile_id'], p['name'])
        key = f"sheet:{period}:{p['kind']}:{p['profile_id']}"
        keep_acc.append(key)
        details = json.dumps({'kind': p['kind'], 'rate': p['rate'], 'values': p['values']}, ensure_ascii=False)
        cur.execute(f"INSERT INTO {SCHEMA}.acc_accruals (staff_id, period, pay_type, rate, base, bonus, amount, comment, created_by, source_key, details) "
                    f"VALUES (%s, %s, 'tabel', %s, 0, 0, %s, %s, 'Синхронизация', %s, %s) "
                    f'ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO UPDATE SET amount = EXCLUDED.amount, '
                    f'rate = EXCLUDED.rate, details = EXCLUDED.details, staff_id = EXCLUDED.staff_id, void = false',
                    (sid, period, p['rate'], round(p['total'], 2),
                     'Из раздела «Зарплата»' + (' (руководитель)' if p['kind'] == 'mgr' else ''), key, details))
    cur.execute(f'UPDATE {SCHEMA}.acc_accruals SET void = true WHERE period = %s AND source_key LIKE %s AND NOT (source_key = ANY(%s))',
                (period, f'sheet:{period}:%', keep_acc or ['']))
    for kind, cat_name, label in (('emp', CAT_EMP, 'сотрудников'), ('mgr', CAT_MGR, 'руководителей')):
        key = f'{period}:{kind}'
        if round(totals[kind], 2) > 0:
            _upsert_entry(cur, 'salary', key, 'expense', last, totals[kind], _cat_id(cur, 'expense', cat_name),
                          f'ИТОГО к выдаче из «Зарплаты», {label}: {counts[kind]}', period)
        else:
            cur.execute(f"UPDATE {SCHEMA}.acc_entries SET void = true WHERE source = 'salary' AND source_key = %s", (key,))
    cur.execute(f"SELECT shift_date, SUM(COALESCE(fact_value, 0)), COUNT(*) FROM {SCHEMA}.collection_data "
                f"WHERE month_year = %s AND shift_date ~ '^\\d{{2}}\\.\\d{{2}}\\.\\d{{4}}$' GROUP BY 1", (_my(period),))
    keep_col: List[str] = []
    col_total = 0.0
    col_cat = _cat_id(cur, 'income', CAT_COL)
    for sd, total, n in cur.fetchall():
        total = _num(total)
        if total <= 0:
            continue
        d = f'{sd[6:10]}-{sd[3:5]}-{sd[0:2]}'
        keep_col.append(d)
        col_total += total
        _upsert_entry(cur, 'collection', d, 'income', d, total, col_cat, f'Инкассация (факт), смен: {n}', period)
    cur.execute(f"UPDATE {SCHEMA}.acc_entries SET void = true WHERE source = 'collection' AND period = %s AND NOT (source_key = ANY(%s))",
                (period, keep_col or ['']))
    snap = {'salary_emp': round(totals['emp'], 2), 'salary_mgr': round(totals['mgr'], 2), 'collection': round(col_total, 2),
            'revenue': calc['base']['revenue'], 'rate': round(calc['base']['rate'], 6)}
    cur.execute(f'INSERT INTO {SCHEMA}.acc_periods (period, synced_at, snapshot, fingerprint) VALUES (%s, now(), %s, %s) '
                f'ON CONFLICT (period) DO UPDATE SET synced_at = now(), snapshot = EXCLUDED.snapshot, fingerprint = EXCLUDED.fingerprint',
                (period, json.dumps(snap), _fingerprint(cur, period, cfg, params)))
    return {'period': period, **snap}


def sync_range(cur, d_from: str, d_to: str) -> None:
    cur_month = date.today().strftime('%Y-%m')
    closed = _closed(cur)
    todo = [p for p in _data_periods(cur)
            if d_from[:7] <= p <= d_to[:7] and p <= cur_month and not closed.get(p, {}).get('closed')]
    if not todo:
        return
    cfg, params = load_config(cur, SCHEMA), global_params(cur, SCHEMA)
    for p in todo[-12:]:
        sync_period(cur, p, cfg, params)


# ---------------------------------------------------------------- чтение

def _entries(cur, d_from: str, d_to: str) -> List[Dict[str, Any]]:
    cur.execute(f'SELECT e.id, e.kind, e.entry_date, e.amount, e.category_id, c.name, e.comment, e.payment_id, e.created_by, '
                f'e.source, e.counterparty_id, cp.name FROM {SCHEMA}.acc_entries e '
                f'LEFT JOIN {SCHEMA}.acc_categories c ON c.id = e.category_id '
                f'LEFT JOIN {SCHEMA}.acc_counterparties cp ON cp.id = e.counterparty_id '
                f'WHERE e.entry_date BETWEEN %s AND %s AND NOT e.void ORDER BY e.entry_date DESC, e.id DESC LIMIT 3000', (d_from, d_to))
    return [{'id': r[0], 'kind': r[1], 'date': r[2], 'amount': _num(r[3]), 'category_id': r[4], 'category': r[5] or 'Без статьи',
             'comment': r[6], 'from_salary': r[7] is not None, 'created_by': r[8], 'linked': r[9],
             'counterparty_id': r[10], 'counterparty': r[11]} for r in cur.fetchall()]


def _profit(cur, d_from: str, d_to: str) -> Dict[str, Any]:
    cur.execute(f"SELECT e.kind, COALESCE(c.name, 'Без статьи'), SUM(e.amount), COUNT(*), MAX(e.source) "
                f'FROM {SCHEMA}.acc_entries e LEFT JOIN {SCHEMA}.acc_categories c ON c.id = e.category_id '
                f'WHERE e.entry_date BETWEEN %s AND %s AND NOT e.void GROUP BY 1, 2 ORDER BY 3 DESC', (d_from, d_to))
    rows = [{'kind': r[0], 'category': r[1], 'total': _num(r[2]), 'count': r[3], 'linked': r[4]} for r in cur.fetchall()]
    cur.execute(f"SELECT to_char(entry_date, 'YYYY-MM'), SUM(CASE WHEN kind = 'income' THEN amount ELSE 0 END), "
                f"SUM(CASE WHEN kind = 'expense' THEN amount ELSE 0 END) FROM {SCHEMA}.acc_entries "
                f'WHERE entry_date BETWEEN %s AND %s AND NOT void GROUP BY 1 ORDER BY 1', (d_from, d_to))
    months = [{'month': r[0], 'income': _num(r[1]), 'expense': _num(r[2])} for r in cur.fetchall()]
    income = round(sum(r['total'] for r in rows if r['kind'] == 'income'), 2)
    expense = round(sum(r['total'] for r in rows if r['kind'] == 'expense'), 2)
    return {'income': income, 'expense': expense, 'profit': round(income - expense, 2), 'by_category': rows, 'by_month': months}


def _dds(cur, d_from: str, d_to: str) -> Dict[str, Any]:
    """Отчёт о движении денежных средств: статьи × месяцы, остаток на начало и конец."""
    cur.execute(f"SELECT COALESCE(SUM(CASE WHEN kind = 'income' THEN amount ELSE -amount END), 0) FROM {SCHEMA}.acc_entries "
                f'WHERE entry_date < %s AND NOT void', (d_from,))
    opening = _num(cur.fetchone()[0])
    cur.execute(f"SELECT e.kind, COALESCE(c.name, 'Без статьи'), to_char(e.entry_date, 'YYYY-MM'), SUM(e.amount) "
                f'FROM {SCHEMA}.acc_entries e LEFT JOIN {SCHEMA}.acc_categories c ON c.id = e.category_id '
                f'WHERE e.entry_date BETWEEN %s AND %s AND NOT e.void GROUP BY 1, 2, 3', (d_from, d_to))
    months, rows = set(), {}
    for kind, cat, m, total in cur.fetchall():
        months.add(m)
        r = rows.setdefault((kind, cat), {'kind': kind, 'category': cat, 'months': {}, 'total': 0.0})
        r['months'][m] = round(_num(total), 2)
        r['total'] = round(r['total'] + _num(total), 2)
    months_l = sorted(months)
    bal, balances = opening, []
    for m in months_l:
        inc = sum(r['months'].get(m, 0) for r in rows.values() if r['kind'] == 'income')
        exp = sum(r['months'].get(m, 0) for r in rows.values() if r['kind'] == 'expense')
        start = bal
        bal = round(bal + inc - exp, 2)
        balances.append({'month': m, 'start': round(start, 2), 'income': round(inc, 2), 'expense': round(exp, 2), 'end': bal})
    return {'opening': round(opening, 2), 'closing': round(bal, 2), 'months': months_l, 'balances': balances,
            'rows': sorted(rows.values(), key=lambda r: (r['kind'] != 'income', -r['total']))}


def _budget(cur, period: str) -> Dict[str, Any]:
    d_from, d_to = f'{period}-01', _last_day(period)
    cur.execute(f'SELECT category_id, amount FROM {SCHEMA}.acc_budget WHERE period = %s', (period,))
    plan = {r[0]: _num(r[1]) for r in cur.fetchall()}
    cur.execute(f'SELECT category_id, SUM(amount) FROM {SCHEMA}.acc_entries WHERE entry_date BETWEEN %s AND %s AND NOT void GROUP BY 1',
                (d_from, d_to))
    fact = {r[0]: _num(r[1]) for r in cur.fetchall()}
    cur.execute(f'SELECT id, kind, name, archived FROM {SCHEMA}.acc_categories ORDER BY kind, name')
    rows = []
    for cid, kind, name, archived in cur.fetchall():
        p, f = plan.get(cid, 0.0), fact.get(cid, 0.0)
        if archived and not p and not f:
            continue
        rows.append({'category_id': cid, 'kind': kind, 'category': name, 'plan': p, 'fact': f, 'diff': round(f - p, 2),
                     'pct': round(f / p * 100, 1) if p else None})
    return {'period': period, 'rows': rows}


def _counterparties(cur) -> List[Dict[str, Any]]:
    cur.execute(f"SELECT cp.id, cp.name, cp.kind, cp.inn, cp.phone, cp.comment, cp.archived, "
                f"(SELECT COALESCE(SUM(amount), 0) FROM {SCHEMA}.acc_cp_docs d WHERE d.counterparty_id = cp.id AND d.direction = 'in'), "
                f"(SELECT COALESCE(SUM(amount), 0) FROM {SCHEMA}.acc_cp_docs d WHERE d.counterparty_id = cp.id AND d.direction = 'out'), "
                f"(SELECT COALESCE(SUM(amount), 0) FROM {SCHEMA}.acc_entries e WHERE e.counterparty_id = cp.id AND e.kind = 'expense' AND NOT e.void), "
                f"(SELECT COALESCE(SUM(amount), 0) FROM {SCHEMA}.acc_entries e WHERE e.counterparty_id = cp.id AND e.kind = 'income' AND NOT e.void) "
                f'FROM {SCHEMA}.acc_counterparties cp ORDER BY cp.archived, cp.name')
    out = []
    for r in cur.fetchall():
        got, gave, paid, received = _num(r[7]), _num(r[8]), _num(r[9]), _num(r[10])
        balance = round((got - paid) - (gave - received), 2)
        out.append({'id': r[0], 'name': r[1], 'kind': r[2], 'kind_label': CP_KINDS.get(r[2], r[2]), 'inn': r[3], 'phone': r[4],
                    'comment': r[5], 'archived': r[6], 'got': got, 'gave': gave, 'paid': paid, 'received': received,
                    'we_owe': balance if balance > 0 else 0.0, 'they_owe': -balance if balance < 0 else 0.0})
    return out


def _cp_history(cur, cp_id: int) -> List[Dict[str, Any]]:
    cur.execute(f"SELECT 'doc', id, doc_date, direction, amount, comment FROM {SCHEMA}.acc_cp_docs WHERE counterparty_id = %s "
                f"UNION ALL SELECT 'pay', id, entry_date, kind, amount, comment FROM {SCHEMA}.acc_entries WHERE counterparty_id = %s AND NOT void "
                f'ORDER BY 3 DESC, 2 DESC', (cp_id, cp_id))
    labels = {('doc', 'in'): 'Получено от контрагента (товар/услуга)', ('doc', 'out'): 'Отгружено/оказано контрагенту',
              ('pay', 'expense'): 'Оплата контрагенту', ('pay', 'income'): 'Оплата от контрагента'}
    return [{'type': r[0], 'id': r[1], 'date': r[2], 'direction': r[3], 'amount': _num(r[4]), 'comment': r[5],
             'label': labels.get((r[0], r[3]), '')} for r in cur.fetchall()]


def _salary(cur, period: str, with_profiles: bool) -> Dict[str, Any]:
    start = _start(cur)
    cur.execute(f'SELECT id, name, profile_id, position, pay_type, rate, active FROM {SCHEMA}.acc_staff ORDER BY active DESC, name')
    staff = [{'id': r[0], 'name': (r[1] or '').strip(), 'profile_id': r[2], 'position': r[3], 'pay_type': r[4], 'rate': _num(r[5]),
              'active': r[6]} for r in cur.fetchall()]
    cur.execute(f'SELECT staff_id, SUM(CASE WHEN period < %s THEN amount ELSE 0 END), SUM(CASE WHEN period = %s THEN amount ELSE 0 END), '
                f'SUM(CASE WHEN period = %s AND source_key IS NOT NULL THEN amount ELSE 0 END) '
                f'FROM {SCHEMA}.acc_accruals WHERE NOT void AND period >= %s AND period <= %s GROUP BY 1', (period, period, period, start, period))
    acc = {r[0]: (_num(r[1]), _num(r[2]), _num(r[3])) for r in cur.fetchall()}
    cur.execute(f"SELECT staff_id, SUM(CASE WHEN p < %s THEN amount ELSE 0 END), SUM(CASE WHEN p = %s THEN amount ELSE 0 END) FROM "
                f"(SELECT staff_id, amount, COALESCE(period, to_char(pay_date, 'YYYY-MM')) p FROM {SCHEMA}.acc_payments) x "
                f'WHERE p >= %s AND p <= %s GROUP BY 1', (period, period, start, period))
    pay = {r[0]: (_num(r[1]), _num(r[2])) for r in cur.fetchall()}
    for s in staff:
        a_before, a_now, sheet = acc.get(s['id'], (0.0, 0.0, 0.0))
        p_before, p_now = pay.get(s['id'], (0.0, 0.0))
        s['debt_start'] = round(a_before - p_before, 2)
        s['accrued'] = round(a_now, 2)
        s['sheet'] = round(sheet, 2) if s['pay_type'] == 'tabel' else None
        s['paid'] = round(p_now, 2)
        s['debt'] = round(s['debt_start'] + a_now - p_now, 2)
    staff = [s for s in staff if s['active'] or s['accrued'] or s['paid'] or s['debt']]
    cur.execute(f'SELECT id, staff_id, period, pay_type, rate, base, bonus, amount, comment, created_at, source_key '
                f'FROM {SCHEMA}.acc_accruals WHERE period = %s AND NOT void ORDER BY created_at DESC', (period,))
    accruals = [{'id': r[0], 'staff_id': r[1], 'period': r[2], 'pay_type': r[3], 'rate': _num(r[4]), 'base': _num(r[5]),
                 'bonus': _num(r[6]), 'amount': _num(r[7]), 'comment': r[8], 'created_at': r[9], 'auto': r[10] is not None}
                for r in cur.fetchall()]
    cur.execute(f"SELECT id, staff_id, pay_date, amount, period, comment FROM {SCHEMA}.acc_payments "
                f"WHERE COALESCE(period, to_char(pay_date, 'YYYY-MM')) = %s ORDER BY pay_date DESC, id DESC", (period,))
    payments = [{'id': r[0], 'staff_id': r[1], 'date': r[2], 'amount': _num(r[3]), 'period': r[4], 'comment': r[5]}
                for r in cur.fetchall()]
    out = {'period': period, 'start_period': start, 'before_start': period < start, 'staff': staff, 'accruals': accruals,
           'payments': payments, 'total_debt': round(sum(s['debt'] for s in staff), 2),
           'total_debt_start': round(sum(s['debt_start'] for s in staff), 2), 'closed': _is_closed(cur, period)}
    if with_profiles:
        cur.execute(f"SELECT id, full_name FROM {SCHEMA}.profiles WHERE status = 'active' ORDER BY full_name")
        out['profiles'] = [{'id': r[0], 'name': (r[1] or '').strip()} for r in cur.fetchall()]
    return out


def _payslip(cur, staff_id: int, period: str) -> Dict[str, Any]:
    cur.execute(f'SELECT name, position, pay_type, rate, profile_id FROM {SCHEMA}.acc_staff WHERE id = %s', (staff_id,))
    st = cur.fetchone()
    if not st:
        return {}
    cfg = load_config(cur, SCHEMA)
    start = _start(cur)
    cur.execute(f'SELECT COALESCE(SUM(amount), 0) FROM {SCHEMA}.acc_accruals WHERE staff_id = %s AND period < %s AND period >= %s AND NOT void',
                (staff_id, period, start))
    acc_before = _num(cur.fetchone()[0])
    cur.execute(f"SELECT COALESCE(SUM(amount), 0) FROM {SCHEMA}.acc_payments WHERE staff_id = %s "
                f"AND COALESCE(period, to_char(pay_date, 'YYYY-MM')) < %s AND COALESCE(period, to_char(pay_date, 'YYYY-MM')) >= %s",
                (staff_id, period, start))
    debt_start = round(acc_before - _num(cur.fetchone()[0]), 2)
    lines: List[Dict[str, Any]] = []
    cur.execute(f'SELECT amount, comment, details FROM {SCHEMA}.acc_accruals WHERE staff_id = %s AND period = %s AND NOT void ORDER BY id',
                (staff_id, period))
    total_acc = 0.0
    for amount, comment, details in cur.fetchall():
        total_acc += _num(amount)
        det = details if isinstance(details, dict) else (json.loads(details) if details else None)
        if det:
            fields = cfg['fields']['manager' if det.get('kind') == 'mgr' else 'salary']
            lines.append({'section': 'info', 'label': 'Ставка, ₽/час', 'amount': det.get('rate')})
            for f in fields:
                v = (det.get('values') or {}).get(f['key'], 0)
                if not v:
                    continue
                sec = {'accrual': 'accrual', 'deduction': 'deduction'}.get(f.get('kind'), 'info')
                if f['var'] in ('hours', 'osn_hours', 'dop_hours'):
                    sec = 'info'
                lines.append({'section': sec, 'label': f['label'].capitalize(), 'amount': v})
            lines.append({'section': 'total', 'label': 'ИТОГО к выдаче по разделу «Зарплата»', 'amount': _num(amount)})
        else:
            lines.append({'section': 'accrual', 'label': comment or 'Начисление', 'amount': _num(amount)})
    cur.execute(f"SELECT pay_date, amount, comment FROM {SCHEMA}.acc_payments WHERE staff_id = %s "
                f"AND COALESCE(period, to_char(pay_date, 'YYYY-MM')) = %s ORDER BY pay_date", (staff_id, period))
    pays = [{'date': r[0], 'amount': _num(r[1]), 'comment': r[2]} for r in cur.fetchall()]
    paid = sum(p['amount'] for p in pays)
    return {'name': (st[0] or '').strip(), 'position': st[1], 'period': period, 'debt_start': debt_start, 'lines': lines,
            'accrued': round(total_acc, 2), 'payments': pays, 'paid': round(paid, 2),
            'debt_end': round(debt_start + total_acc - paid, 2)}


def _categories(cur) -> List[Dict[str, Any]]:
    cur.execute(f'SELECT id, kind, name, archived FROM {SCHEMA}.acc_categories ORDER BY kind, name')
    return [{'id': r[0], 'kind': r[1], 'name': r[2], 'archived': r[3]} for r in cur.fetchall()]


def _calc_accrual(pay_type: str, rate: Decimal, base: Decimal, bonus: Decimal) -> Decimal:
    main = rate if pay_type == 'salary' else base * rate / Decimal(100) if pay_type == 'percent' else base * rate
    return (main + bonus).quantize(Decimal('0.01'))


# ---------------------------------------------------------------- изменения

def _bank(cur, user: Dict[str, Any], parsed: Dict[str, Any], commit: bool, body: Dict[str, Any]) -> Dict[str, Any]:
    """Выписка СберБизнес → операции. Контрагенты находятся по ИНН или названию (новые создаются),
    статья — по правилу контрагента или по назначению платежа. Повторно загруженные строки пропускаются."""
    cats = {(c['kind'], c['name'].lower()): c['id'] for c in _categories(cur) if not c['archived']}
    cur.execute(f'SELECT id, name, inn, default_category_id FROM {SCHEMA}.acc_counterparties')
    cps = [{'id': r[0], 'name': r[1], 'inn': r[2], 'cat': r[3]} for r in cur.fetchall()]
    overrides = {str(k): v for k, v in (body.get('categories') or {}).items()}
    closed = {p for p, v in _closed(cur).items() if v['closed']}
    rows, added, skipped = [], 0, 0
    for i, op in enumerate(parsed['ops']):
        if not op['date'] or op['amount'] <= 0:
            continue
        key = f"{op['date']}|{op['kind']}|{op['amount']:.2f}|{op['number']}|{op['inn'] or op['name'][:40]}"
        cur.execute(f"SELECT 1 FROM {SCHEMA}.acc_entries WHERE source = 'bank' AND source_key = %s", (key,))
        dup = cur.fetchone() is not None
        low = op['name'].lower()
        cp = next((c for c in cps if op['inn'] and c['inn'] == op['inn']), None) or \
            next((c for c in cps if low and c['name'].lower() == low), None)
        cat_id = overrides.get(str(i))
        if cat_id in (None, ''):
            cat_id = cp['cat'] if cp and cp['cat'] else None
            if not cat_id:
                g = guess_category(op)
                cat_id = cats.get((op['kind'], g.lower())) if g else None
        is_closed = _period_of(op['date']) in closed
        row = {**op, 'idx': i, 'duplicate': dup, 'closed': is_closed, 'counterparty_id': cp['id'] if cp else None,
               'counterparty_new': not cp and bool(op['name']), 'category_id': int(cat_id) if cat_id else None}
        rows.append(row)
        if not commit:
            continue
        if dup or is_closed or str(i) in (body.get('skip') or []):
            skipped += 1
            continue
        if not cp and op['name']:
            cur.execute(f"INSERT INTO {SCHEMA}.acc_counterparties (name, kind, inn) VALUES (%s, %s, %s) RETURNING id",
                        (op['name'][:150], 'supplier' if op['kind'] == 'expense' else 'customer', op['inn'] or None))
            cp = {'id': cur.fetchone()[0], 'name': op['name'], 'inn': op['inn'], 'cat': None}
            cps.append(cp)
        if cp and row['category_id'] and not cp['cat']:
            cur.execute(f'UPDATE {SCHEMA}.acc_counterparties SET default_category_id = %s WHERE id = %s', (row['category_id'], cp['id']))
            cp['cat'] = row['category_id']
        comment = (f"Банк №{op['number']}: " if op['number'] else 'Банк: ') + (op['purpose'] or '')[:400]
        cur.execute(f"INSERT INTO {SCHEMA}.acc_entries (kind, entry_date, amount, category_id, comment, counterparty_id, period, "
                    f"source, source_key, bank_purpose, created_by) VALUES (%s, %s, %s, %s, %s, %s, %s, 'bank', %s, %s, %s) "
                    f"ON CONFLICT (source, source_key) WHERE source IS NOT NULL DO NOTHING",
                    (op['kind'], op['date'], op['amount'], row['category_id'], comment, cp['id'] if cp else None,
                     _period_of(op['date']), key, op['purpose'][:1000], user['name']))
        added += 1
    if commit:
        cur.execute(f'INSERT INTO {SCHEMA}.acc_bank_imports (file_name, account, date_from, date_to, added, skipped, created_by) '
                    f'VALUES (%s, %s, %s, %s, %s, %s, %s)', (str(body.get('file_name') or '')[:200], parsed['account'],
                                                           parsed['date_from'], parsed['date_to'], added, skipped, user['name']))
        _log(cur, user, 'Выписка банка', f"{body.get('file_name')}: добавлено {added}, пропущено {skipped}")
        return _resp(200, {'ok': True, 'added': added, 'skipped': skipped})
    return _resp(200, {'account': parsed['account'], 'date_from': parsed['date_from'], 'date_to': parsed['date_to'], 'rows': rows,
                       'income': round(sum(r['amount'] for r in rows if r['kind'] == 'income' and not r['duplicate']), 2),
                       'expense': round(sum(r['amount'] for r in rows if r['kind'] == 'expense' and not r['duplicate']), 2)})


def _guard_period(cur, d: str) -> Optional[Dict[str, Any]]:
    if _is_closed(cur, _period_of(d)):
        return _err(f'Месяц {d[5:7]}.{d[:4]} закрыт — изменения запрещены. Откройте месяц, если нужно поправить.')
    return None


def _edit(cur, user: Dict[str, Any], action: str, body: Dict[str, Any]) -> Dict[str, Any]:
    can = user['actions']

    if action in ('entry_save', 'entry_delete'):
        need = 'accounting.edit_entries' if action == 'entry_save' else 'accounting.delete_entries'
        if need not in can:
            return _err('Нет права на это действие', 403)
        ex = None
        if body.get('id'):
            cur.execute(f'SELECT payment_id, source, entry_date, kind, amount FROM {SCHEMA}.acc_entries WHERE id = %s', (body['id'],))
            ex = cur.fetchone()
            if not ex:
                return _err('Операция не найдена', 404)
            if ex[1] and ex[1] != 'bank':
                return _err('Эта строка приходит из раздела «Зарплата» или «Инкассация» — исправьте её там')
            if ex[0]:
                return _err('Эта операция создана выплатой зарплаты — измените выплату во вкладке «Зарплата»')
            g = _guard_period(cur, str(ex[2]))
            if g:
                return g
        if action == 'entry_delete':
            if not ex:
                return _err('Операция не найдена', 404)
            if ex[1] == 'bank':
                cur.execute(f'UPDATE {SCHEMA}.acc_entries SET void = true WHERE id = %s', (body['id'],))
            else:
                cur.execute(f'DELETE FROM {SCHEMA}.acc_entries WHERE id = %s', (body['id'],))
            _log(cur, user, 'Удалена операция', f'#{body["id"]}: {ex[3]} {ex[4]} от {ex[2]}')
            return _resp(200, {'ok': True})
        kind = body.get('kind')
        d, amount = _date(body.get('date')), _money(body.get('amount'))
        if kind not in KINDS:
            return _err('Выберите: доход или расход')
        if not d:
            return _err('Укажите дату')
        if amount is None:
            return _err('Укажите сумму больше нуля')
        g = _guard_period(cur, d)
        if g:
            return g
        cat = body.get('category_id') or None
        if cat:
            cur.execute(f'SELECT kind FROM {SCHEMA}.acc_categories WHERE id = %s', (cat,))
            c = cur.fetchone()
            if not c or c[0] != kind:
                return _err('Статья не подходит к типу операции')
        cp = body.get('counterparty_id') or None
        comment = str(body.get('comment') or '').strip()[:500] or None
        if body.get('id'):
            cur.execute(f'UPDATE {SCHEMA}.acc_entries SET kind = %s, entry_date = %s, amount = %s, category_id = %s, comment = %s, '
                        f'counterparty_id = %s, period = %s, updated_at = now() WHERE id = %s',
                        (kind, d, amount, cat, comment, cp, _period_of(d), body['id']))
            _log(cur, user, 'Изменена операция', f'#{body["id"]}: {kind} {amount} от {d}')
        else:
            cur.execute(f'INSERT INTO {SCHEMA}.acc_entries (kind, entry_date, amount, category_id, comment, counterparty_id, period, created_by) '
                        f'VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id',
                        (kind, d, amount, cat, comment, cp, _period_of(d), user['name']))
            _log(cur, user, 'Добавлена операция', f'#{cur.fetchone()[0]}: {kind} {amount} от {d}')
        return _resp(200, {'ok': True})

    if action == 'category_save':
        if 'accounting.edit_entries' not in can:
            return _err('Нет права на это действие', 403)
        kind, name = body.get('kind'), str(body.get('name') or '').strip()[:80]
        if kind not in KINDS or not name:
            return _err('Укажите название статьи')
        cur.execute(f'SELECT id FROM {SCHEMA}.acc_categories WHERE kind = %s AND lower(name) = lower(%s)', (kind, name))
        if cur.fetchone():
            return _err('Такая статья уже есть')
        cur.execute(f'INSERT INTO {SCHEMA}.acc_categories (kind, name) VALUES (%s, %s)', (kind, name))
        _log(cur, user, 'Статья', name)
        return _resp(200, {'ok': True, 'categories': _categories(cur)})

    if action in ('period_close', 'period_open', 'period_sync'):
        if action != 'period_sync' and 'accounting.close_month' not in can:
            return _err('Нет права закрывать месяц', 403)
        if action == 'period_sync' and not ({'accounting.edit_entries', 'accounting.close_month'} & can):
            return _err('Нет права на это действие', 403)
        period = str(body.get('period') or '')
        if not PERIOD_RE.match(period):
            return _err('Укажите месяц')
        if action == 'period_open':
            cur.execute(f'UPDATE {SCHEMA}.acc_periods SET closed = false, closed_at = NULL, closed_by = NULL WHERE period = %s', (period,))
            _log(cur, user, 'Месяц открыт', period)
            return _resp(200, {'ok': True})
        res = sync_period(cur, period, force=True)
        if action == 'period_close':
            cur.execute(f'INSERT INTO {SCHEMA}.acc_periods (period, closed, closed_at, closed_by) VALUES (%s, true, now(), %s) '
                        f'ON CONFLICT (period) DO UPDATE SET closed = true, closed_at = now(), closed_by = EXCLUDED.closed_by',
                        (period, user['name']))
            _log(cur, user, 'Месяц закрыт', f'{period}: {json.dumps(res, ensure_ascii=False)}')
        return _resp(200, {'ok': True, 'result': res})

    if action in ('bank_preview', 'bank_import'):
        if 'accounting.edit_entries' not in can:
            return _err('Нет права на это действие', 403)
        try:
            parsed = parse_file(str(body.get('file_name') or ''), str(body.get('file') or ''))
        except ValueError as e:
            return _err(str(e))
        except Exception:
            return _err('Не удалось прочитать файл. Выгрузите выписку из СберБизнес в формате 1С (.txt) или Excel (.xlsx).')
        return _bank(cur, user, parsed, action == 'bank_import', body)

    if action == 'budget_save':
        if 'accounting.edit_budget' not in can:
            return _err('Нет права на это действие', 403)
        period = str(body.get('period') or '')
        if not PERIOD_RE.match(period):
            return _err('Укажите месяц')
        if body.get('copy_from') and PERIOD_RE.match(str(body['copy_from'])):
            cur.execute(f'INSERT INTO {SCHEMA}.acc_budget (period, category_id, amount) SELECT %s, category_id, amount '
                        f'FROM {SCHEMA}.acc_budget WHERE period = %s '
                        f'ON CONFLICT (period, category_id) DO UPDATE SET amount = EXCLUDED.amount', (period, body['copy_from']))
        for item in (body.get('items') or [])[:200]:
            amount = _money(item.get('plan') or 0, allow_zero=True)
            if amount is None:
                return _err('Проверьте суммы плана')
            cur.execute(f'INSERT INTO {SCHEMA}.acc_budget (period, category_id, amount) VALUES (%s, %s, %s) '
                        f'ON CONFLICT (period, category_id) DO UPDATE SET amount = EXCLUDED.amount',
                        (period, item.get('category_id'), amount))
        _log(cur, user, 'План бюджета', period)
        return _resp(200, {'ok': True, **_budget(cur, period)})

    if action in ('counterparty_save', 'cp_doc_save', 'cp_doc_delete'):
        if 'accounting.edit_counterparties' not in can:
            return _err('Нет права на это действие', 403)
        if action == 'counterparty_save':
            name = str(body.get('name') or '').strip()[:150]
            kind = body.get('kind') if body.get('kind') in CP_KINDS else 'supplier'
            if not name:
                return _err('Укажите название контрагента')
            vals = (name, kind, re.sub(r'\D', '', str(body.get('inn') or ''))[:12] or None,
                    str(body.get('phone') or '').strip()[:40] or None, str(body.get('comment') or '').strip()[:300] or None,
                    bool(body.get('archived')))
            if body.get('id'):
                cur.execute(f'SELECT name, inn, account FROM {SCHEMA}.acc_counterparties WHERE id = %s', (body['id'],))
                old = cur.fetchone()
                if old and old[2] and (old[0] != vals[0] or (old[1] or None) != vals[2]) and 'sber.edit_requisites' not in can:
                    return _err('Название и ИНН контрагента с банковскими реквизитами меняет только замдиректора (раздел СБЕР)', 403)
                cur.execute(f'UPDATE {SCHEMA}.acc_counterparties SET name = %s, kind = %s, inn = %s, phone = %s, comment = %s, '
                            f'archived = %s WHERE id = %s', (*vals, body['id']))
            else:
                cur.execute(f'INSERT INTO {SCHEMA}.acc_counterparties (name, kind, inn, phone, comment, archived) '
                            f'VALUES (%s, %s, %s, %s, %s, %s)', vals)
            _log(cur, user, 'Контрагент', name)
            return _resp(200, {'ok': True})
        if action == 'cp_doc_delete':
            cur.execute(f'DELETE FROM {SCHEMA}.acc_cp_docs WHERE id = %s', (body.get('id'),))
            _log(cur, user, 'Удалён документ контрагента', f'#{body.get("id")}')
            return _resp(200, {'ok': True})
        d, amount = _date(body.get('date')), _money(body.get('amount'))
        if body.get('direction') not in ('in', 'out'):
            return _err('Выберите тип документа')
        if not d or amount is None:
            return _err('Укажите дату и сумму')
        cur.execute(f'INSERT INTO {SCHEMA}.acc_cp_docs (counterparty_id, direction, doc_date, amount, comment, created_by) '
                    f'VALUES (%s, %s, %s, %s, %s, %s)',
                    (body.get('counterparty_id'), body['direction'], d, amount, str(body.get('comment') or '').strip()[:300] or None,
                     user['name']))
        _log(cur, user, 'Документ контрагента', f'#{body.get("counterparty_id")}: {body["direction"]} {amount} от {d}')
        return _resp(200, {'ok': True})

    if 'accounting.edit_salary' not in can:
        return _err('Нет права на это действие', 403)

    if action == 'staff_save':
        name = str(body.get('name') or '').strip()[:120]
        pay_type = body.get('pay_type')
        rate = _money(body.get('rate') or 0, allow_zero=True)
        if not name:
            return _err('Укажите ФИО сотрудника')
        if pay_type not in PAY_TYPES:
            return _err('Выберите способ оплаты')
        if pay_type == 'tabel':
            rate = Decimal(0)
            if not body.get('profile_id'):
                return _err('Для расчёта из раздела «Зарплата» выберите учётную запись сотрудника')
        if rate is None:
            return _err('Укажите ставку числом')
        if pay_type == 'percent' and rate > 100:
            return _err('Процент не может быть больше 100')
        vals = (name, body.get('profile_id') or None, str(body.get('position') or '').strip()[:120] or None, pay_type, rate,
                body.get('active', True) is not False)
        if body.get('id'):
            cur.execute(f'UPDATE {SCHEMA}.acc_staff SET name = %s, profile_id = %s, position = %s, pay_type = %s, rate = %s, '
                        f'active = %s WHERE id = %s', (*vals, body['id']))
        else:
            cur.execute(f'INSERT INTO {SCHEMA}.acc_staff (name, profile_id, position, pay_type, rate, active) '
                        f'VALUES (%s, %s, %s, %s, %s, %s)', vals)
        _log(cur, user, 'Сотрудник (зарплата)', f'{name}: {pay_type} {rate}')
        return _resp(200, {'ok': True})

    if action == 'accrual_save':
        cur.execute(f'SELECT name, pay_type, rate FROM {SCHEMA}.acc_staff WHERE id = %s', (body.get('staff_id'),))
        st = cur.fetchone()
        period = str(body.get('period') or '')
        if not st:
            return _err('Сотрудник не найден', 404)
        if not PERIOD_RE.match(period):
            return _err('Укажите месяц')
        if _is_closed(cur, period):
            return _err('Месяц закрыт')
        pay_type = body.get('pay_type') or st[1]
        if pay_type == 'tabel':
            pay_type, body = 'salary', {**body, 'rate': 0}
        if pay_type not in PAY_TYPES:
            return _err('Неизвестный способ оплаты')
        rate = _money(body.get('rate') if body.get('rate') not in (None, '') else st[2], allow_zero=True)
        base, bonus = _money(body.get('base') or 0, allow_zero=True), _money(body.get('bonus') or 0, allow_zero=True)
        if rate is None or base is None or bonus is None:
            return _err('Проверьте числа')
        if pay_type != 'salary' and base == 0:
            return _err('Укажите выручку' if pay_type == 'percent' else 'Укажите количество часов')
        amount = _calc_accrual(pay_type, rate, base, bonus)
        if amount <= 0:
            return _err('Сумма начисления получилась нулевой')
        cur.execute(f'INSERT INTO {SCHEMA}.acc_accruals (staff_id, period, pay_type, rate, base, bonus, amount, comment, created_by) '
                    f'VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)',
                    (body['staff_id'], period, pay_type, rate, base, bonus, amount,
                     str(body.get('comment') or '').strip()[:300] or None, user['name']))
        _log(cur, user, 'Начисление', f'{st[0]} за {period}: {amount}')
        return _resp(200, {'ok': True, 'amount': float(amount)})

    if action == 'accrual_delete':
        cur.execute(f'SELECT period, source_key FROM {SCHEMA}.acc_accruals WHERE id = %s', (body.get('id'),))
        r = cur.fetchone()
        if not r:
            return _err('Начисление не найдено', 404)
        if r[1]:
            return _err('Это начисление приходит из раздела «Зарплата» — исправьте его там')
        if _is_closed(cur, r[0]):
            return _err('Месяц закрыт')
        cur.execute(f'DELETE FROM {SCHEMA}.acc_accruals WHERE id = %s', (body['id'],))
        _log(cur, user, 'Удалено начисление', f'#{body["id"]}')
        return _resp(200, {'ok': True})

    if action == 'payment_save':
        cur.execute(f'SELECT name, pay_type FROM {SCHEMA}.acc_staff WHERE id = %s', (body.get('staff_id'),))
        st = cur.fetchone()
        if not st:
            return _err('Сотрудник не найден', 404)
        d, amount, period = _date(body.get('date')), _money(body.get('amount')), str(body.get('period') or '')
        if not d:
            return _err('Укажите дату выплаты')
        if amount is None:
            return _err('Укажите сумму больше нуля')
        if not PERIOD_RE.match(period):
            return _err('Укажите, за какой месяц выплата')
        g = _guard_period(cur, d)
        if g:
            return g
        comment = str(body.get('comment') or '').strip()[:300] or None
        cur.execute(f'INSERT INTO {SCHEMA}.acc_payments (staff_id, pay_date, amount, period, comment, created_by) '
                    f'VALUES (%s, %s, %s, %s, %s, %s) RETURNING id', (body['staff_id'], d, amount, period, comment, user['name']))
        pid = cur.fetchone()[0]
        if body.get('to_expenses', True) and st[1] != 'tabel':
            cur.execute(f"INSERT INTO {SCHEMA}.acc_entries (kind, entry_date, amount, category_id, comment, payment_id, period, created_by) "
                        f"VALUES ('expense', %s, %s, %s, %s, %s, %s, %s)",
                        (d, amount, _cat_id(cur, 'expense', CAT_EMP),
                         f'Зарплата: {st[0]} за {period}' + (f' — {comment}' if comment else ''), pid, _period_of(d), user['name']))
        _log(cur, user, 'Выплата', f'{st[0]} {amount} от {d} за {period}')
        return _resp(200, {'ok': True})

    if action == 'payment_delete':
        cur.execute(f'SELECT pay_date FROM {SCHEMA}.acc_payments WHERE id = %s', (body.get('id'),))
        r = cur.fetchone()
        if not r:
            return _err('Выплата не найдена', 404)
        g = _guard_period(cur, str(r[0]))
        if g:
            return g
        cur.execute(f'DELETE FROM {SCHEMA}.acc_payments WHERE id = %s', (body['id'],))
        cur.execute(f'DELETE FROM {SCHEMA}.acc_entries WHERE payment_id = %s', (body['id'],))
        _log(cur, user, 'Удалена выплата', f'#{body["id"]}')
        return _resp(200, {'ok': True})

    return _err('Неизвестное действие')


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Бухгалтерия (как в 1С): доходы/расходы по статьям, автоматический перенос по месяцам
    ИТОГО к выдаче из «Зарплаты» и фактической инкассации, закрытие месяца, прибыль, отчёт ДДС,
    план-факт бюджет, контрагенты и взаиморасчёты, зарплата с долгами и расчётными листками.
    Права — по должностям из админ-панели заместителя директора.'''
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}
    if event.get('httpMethod') != 'POST':
        return _err('Метод не поддерживается', 405)
    body = json.loads(event.get('body') or '{}')
    action = body.get('action') or ''

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.autocommit = True
    cur = conn.cursor()
    try:
        user = current_user(cur, SCHEMA, event)
        if not user:
            return _err('Нужно войти в систему', 401)
        can = user['actions']
        if '/accounting' not in user['sections']:
            return _err('Нет доступа к бухгалтерии', 403)
        d_from, d_to = _range(body)
        raw_period = str(body.get('period') or '')
        period = raw_period if PERIOD_RE.match(raw_period) else date.today().strftime('%Y-%m')

        if action == 'me':
            cur.execute(f'SELECT id, name, kind FROM {SCHEMA}.acc_counterparties WHERE NOT archived ORDER BY name')
            cps = [{'id': r[0], 'name': r[1], 'kind': r[2]} for r in cur.fetchall()]
            return _resp(200, {'actions': sorted(can), 'role': user['role'], 'is_deputy': user['is_deputy'],
                               'categories': _categories(cur), 'counterparties': cps, 'start_period': _start(cur)})
        if action == 'settings_save':
            if not user['is_deputy']:
                return _err('Только заместитель директора', 403)
            sp = str(body.get('start_period') or '')
            if not PERIOD_RE.match(sp):
                return _err('Укажите месяц начала учёта')
            cur.execute(f"INSERT INTO {SCHEMA}.app_settings (key, value, updated_by) VALUES ('accounting', %s, %s) "
                        f"ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()",
                        (json.dumps({'start_period': sp}), user['name']))
            cur.execute(f'UPDATE {SCHEMA}.acc_accruals SET void = (period < %s) WHERE source_key IS NOT NULL', (sp,))
            cur.execute(f'UPDATE {SCHEMA}.acc_entries SET void = (period < %s) WHERE source IN (%s, %s)', (sp, 'salary', 'collection'))
            cur.execute(f'UPDATE {SCHEMA}.acc_periods SET fingerprint = NULL')
            _log(cur, user, 'Начало учёта', sp)
            return _resp(200, {'ok': True})
        if action == 'periods':
            sync_range(cur, '2000-01-01', date.today().isoformat())
            closed = _closed(cur)
            periods = sorted(set(_data_periods(cur)) | set(closed.keys()) | {date.today().strftime('%Y-%m')}, reverse=True)
            return _resp(200, {'periods': [{'period': p, **closed.get(p, {'closed': False})} for p in periods]})
        if action == 'entries':
            if 'accounting.view_entries' not in can:
                return _err('Нет доступа к доходам и расходам', 403)
            sync_range(cur, d_from, d_to)
            return _resp(200, {'entries': _entries(cur, d_from, d_to),
                               'closed': [p for p, v in _closed(cur).items() if v['closed']]})
        if action in ('profit', 'dds'):
            if 'accounting.view_reports' not in can:
                return _err('Нет доступа к отчётам', 403)
            sync_range(cur, d_from, d_to)
            return _resp(200, _profit(cur, d_from, d_to) if action == 'profit' else _dds(cur, d_from, d_to))
        if action == 'budget':
            if 'accounting.view_budget' not in can:
                return _err('Нет доступа к бюджету', 403)
            sync_range(cur, f'{period}-01', _last_day(period))
            return _resp(200, _budget(cur, period))
        if action in ('counterparties', 'cp_history'):
            if 'accounting.view_counterparties' not in can:
                return _err('Нет доступа к контрагентам', 403)
            if action == 'cp_history':
                return _resp(200, {'history': _cp_history(cur, int(body.get('id') or 0))})
            return _resp(200, {'counterparties': _counterparties(cur), 'kinds': CP_KINDS})
        if action in ('salary', 'payslip'):
            if 'accounting.view_salary' not in can:
                return _err('Нет доступа к зарплате', 403)
            sync_range(cur, f'{period}-01', _last_day(period))
            if action == 'payslip':
                return _resp(200, _payslip(cur, int(body.get('staff_id') or 0), period))
            return _resp(200, _salary(cur, period, 'accounting.edit_salary' in can))
        return _edit(cur, user, action, body)
    finally:
        cur.close()
        conn.close()
