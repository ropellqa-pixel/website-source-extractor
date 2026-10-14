import json
import os
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional

import psycopg2

SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')
CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Authorization',
    'Access-Control-Max-Age': '86400',
}
EDITOR = 'deputy_director'
KINDS = {'income', 'expense'}
PAY_TYPES = {'salary', 'percent', 'hourly', 'tabel'}
SECTIONS = ('entries', 'profit', 'salary')
PERIOD_RE = re.compile(r'^\d{4}-(0[1-9]|1[0-2])$')
SALARY_CATEGORY = 'Зарплата'


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


def _user(cur, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    headers = event.get('headers') or {}
    token = (headers.get('X-Authorization') or headers.get('x-authorization') or '').replace('Bearer ', '').strip()
    if not token:
        return None
    cur.execute(f'SELECT u.id, u.email, u.is_admin FROM {SCHEMA}.auth_sessions s JOIN {SCHEMA}.auth_users u '
                f'ON u.id = s.user_id WHERE s.token = %s AND s.expires_at > now()', (token,))
    row = cur.fetchone()
    if not row:
        return None
    cur.execute(f'SELECT id, role, full_name FROM {SCHEMA}.profiles WHERE user_id = %s OR lower(email) = lower(%s) '
                f'ORDER BY (user_id = %s) DESC LIMIT 1', (row[0], row[1] or '', row[0]))
    prof = cur.fetchone()
    role = prof[1] if prof else ('director' if row[2] else 'employee')
    if row[2] and role not in ('director', EDITOR):
        role = 'director'
    profile_id = prof[0] if prof else None
    perms = {s: False for s in SECTIONS}
    if role in ('director', EDITOR):
        perms = {s: True for s in SECTIONS}
    elif profile_id:
        cur.execute(f'SELECT can_entries, can_profit, can_salary FROM {SCHEMA}.acc_access WHERE profile_id = %s',
                    (profile_id,))
        a = cur.fetchone()
        if a:
            perms = dict(zip(SECTIONS, a))
    return {'id': row[0], 'profile_id': profile_id, 'role': role, 'name': (prof[2] if prof else '') or row[1] or '',
            'can_edit': role == EDITOR, 'perms': perms}


def _log(cur, user: Dict[str, Any], action: str, details: str) -> None:
    cur.execute(f'INSERT INTO {SCHEMA}.acc_log (user_name, action, details) VALUES (%s, %s, %s)',
                (user['name'], action, details[:500]))


def _categories(cur) -> List[Dict[str, Any]]:
    cur.execute(f'SELECT id, kind, name, archived FROM {SCHEMA}.acc_categories ORDER BY kind, name')
    return [{'id': r[0], 'kind': r[1], 'name': r[2], 'archived': r[3]} for r in cur.fetchall()]


def _salary_category(cur) -> int:
    cur.execute(f"SELECT id FROM {SCHEMA}.acc_categories WHERE kind = 'expense' AND lower(name) = lower(%s)",
                (SALARY_CATEGORY,))
    r = cur.fetchone()
    if r:
        return r[0]
    cur.execute(f"INSERT INTO {SCHEMA}.acc_categories (kind, name) VALUES ('expense', %s) RETURNING id", (SALARY_CATEGORY,))
    return cur.fetchone()[0]


def _month_last_day(period: str) -> str:
    y, m = int(period[:4]), int(period[5:7])
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return date.fromordinal(nxt.toordinal() - 1).isoformat()


def _sheet_payroll(cur) -> Dict[str, Dict[str, float]]:
    """Итоги из раздела «Зарплата» по месяцам: {'2026-09': {profile_id: сумма}}.
    Формулы те же, что на странице «Зарплата»: ставка = выручка / (дней × 24) × процент."""
    cur.execute(f'SELECT percent FROM {SCHEMA}.salary_settings WHERE month_year IS NULL LIMIT 1')
    r = cur.fetchone()
    pct = _num(r[0]) if r and r[0] is not None else 2.5
    cur.execute(f'SELECT manager_percent FROM {SCHEMA}.manager_settings WHERE month_year IS NULL LIMIT 1')
    r = cur.fetchone()
    mpct = _num(r[0]) if r and r[0] is not None else 5.0
    cur.execute(f'SELECT month_year, revenue, days_in_month FROM {SCHEMA}.salary_settings WHERE month_year IS NOT NULL')
    rates: Dict[str, float] = {}
    for my, rev, days in cur.fetchall():
        k2 = (days or 30) * 24
        rates[my] = (_num(rev) / k2) * (pct / 100) if k2 else 0.0
    out: Dict[str, Dict[str, float]] = {}

    def add(my: str, pid: str, v: float) -> None:
        if not re.fullmatch(r'\d{2}\.\d{4}', my or '') or not pid:
            return
        key = f'{my[3:]}-{my[:2]}'
        out.setdefault(key, {})
        out[key][pid] = round(out[key].get(pid, 0.0) + v, 2)

    cur.execute(f'SELECT month_year, profile_id, hours_worked, vacation_pay, non_cash, overtime, tax, underpayment '
                f'FROM {SCHEMA}.salary_data')
    for my, pid, b, e, f, g, h, u in cur.fetchall():
        d = rates.get(my, 0.0)
        add(my, pid, (d * _num(b) + _num(e)) - _num(f) - _num(g) - _num(h) + _num(u))
    cur.execute(f'SELECT month_year, profile_id, osn_hours, dop_hours, doplaty, vacation_pay, non_cash, underpayment '
                f'FROM {SCHEMA}.manager_data')
    for my, pid, osn, dop, dopl, vac, nc, u in cur.fetchall():
        er = rates.get(my, 0.0)
        hr = er * (1 + mpct / 100)
        add(my, pid, (((_num(osn) * hr) + _num(vac)) - _num(nc)) + _num(dopl) + (_num(dop) * er) + _num(u))
    return out


def _linked(cur, d_from: str, d_to: str) -> List[Dict[str, Any]]:
    """Операции, которые берутся из других разделов автоматически (только чтение):
    инкассация — только фактические суммы по дням; зарплата — итог месяца из раздела «Зарплата»."""
    rows: List[Dict[str, Any]] = []
    cur.execute(f"SELECT to_date(shift_date, 'DD.MM.YYYY') d, SUM(fact_value), COUNT(*) FROM {SCHEMA}.collection_data "
                f"WHERE shift_date ~ '^\\d{{2}}\\.\\d{{2}}\\.\\d{{4}}$' AND COALESCE(fact_value, 0) > 0 "
                f"AND to_date(shift_date, 'DD.MM.YYYY') BETWEEN %s AND %s GROUP BY 1 ORDER BY 1", (d_from, d_to))
    for d, total, n in cur.fetchall():
        rows.append({'id': f'col-{d}', 'kind': 'income', 'date': d.isoformat(), 'amount': round(_num(total), 2),
                     'category_id': None, 'category': 'Инкассация', 'comment': f'Инкассация (факт), смен: {n}',
                     'from_salary': False, 'linked': 'collection', 'created_by': None})
    for period, people in _sheet_payroll(cur).items():
        last = _month_last_day(period)
        total = round(sum(people.values()), 2)
        if total <= 0 or not (d_from <= last <= d_to):
            continue
        rows.append({'id': f'sal-{period}', 'kind': 'expense', 'date': last, 'amount': total, 'category_id': None,
                     'category': SALARY_CATEGORY, 'comment': f'Зарплата за месяц из раздела «Зарплата», сотрудников: '
                     f'{sum(1 for v in people.values() if v)}', 'from_salary': False, 'linked': 'salary', 'created_by': None})
    return rows


def _entries(cur, body: Dict[str, Any]) -> List[Dict[str, Any]]:
    d_from = _date(body.get('date_from')) or '1900-01-01'
    d_to = _date(body.get('date_to')) or '2999-12-31'
    cur.execute(f'SELECT e.id, e.kind, e.entry_date, e.amount, e.category_id, c.name, e.comment, e.payment_id, e.created_by '
                f'FROM {SCHEMA}.acc_entries e LEFT JOIN {SCHEMA}.acc_categories c ON c.id = e.category_id '
                f'WHERE e.entry_date BETWEEN %s AND %s ORDER BY e.entry_date DESC, e.id DESC LIMIT 2000', (d_from, d_to))
    own = [{'id': r[0], 'kind': r[1], 'date': r[2], 'amount': _num(r[3]), 'category_id': r[4], 'category': r[5] or 'Без статьи',
             'comment': r[6], 'from_salary': r[7] is not None, 'linked': None, 'created_by': r[8]} for r in cur.fetchall()]
    return sorted(own + _linked(cur, d_from, d_to), key=lambda e: str(e['date']), reverse=True)


def _profit(cur, body: Dict[str, Any]) -> Dict[str, Any]:
    d_from = _date(body.get('date_from')) or '1900-01-01'
    d_to = _date(body.get('date_to')) or '2999-12-31'
    cats: Dict[tuple, Dict[str, Any]] = {}
    months: Dict[str, Dict[str, Any]] = {}
    for e in _entries(cur, {'date_from': d_from, 'date_to': d_to}):
        key = (e['kind'], e['category'])
        c = cats.setdefault(key, {'kind': e['kind'], 'category': e['category'], 'total': 0.0, 'count': 0,
                                  'linked': e.get('linked')})
        c['total'] = round(c['total'] + e['amount'], 2)
        c['count'] += 1
        m = months.setdefault(str(e['date'])[:7], {'month': str(e['date'])[:7], 'income': 0.0, 'expense': 0.0})
        m[e['kind']] = round(m[e['kind']] + e['amount'], 2)
    rows = sorted(cats.values(), key=lambda r: -r['total'])
    income = round(sum(r['total'] for r in rows if r['kind'] == 'income'), 2)
    expense = round(sum(r['total'] for r in rows if r['kind'] == 'expense'), 2)
    return {'income': income, 'expense': expense, 'profit': round(income - expense, 2),
            'by_category': rows, 'by_month': sorted(months.values(), key=lambda m: m['month'])}


def _salary(cur, body: Dict[str, Any]) -> Dict[str, Any]:
    period = body.get('period') if PERIOD_RE.match(str(body.get('period') or '')) else date.today().strftime('%Y-%m')
    cur.execute(f'SELECT id, name, profile_id, position, pay_type, rate, active FROM {SCHEMA}.acc_staff ORDER BY active DESC, name')
    staff = [{'id': r[0], 'name': r[1], 'profile_id': r[2], 'position': r[3], 'pay_type': r[4], 'rate': _num(r[5]),
              'active': r[6]} for r in cur.fetchall()]
    cur.execute(f'SELECT staff_id, SUM(amount) FROM {SCHEMA}.acc_accruals GROUP BY 1')
    acc_all = {r[0]: _num(r[1]) for r in cur.fetchall()}
    cur.execute(f'SELECT staff_id, SUM(amount) FROM {SCHEMA}.acc_payments GROUP BY 1')
    pay_all = {r[0]: _num(r[1]) for r in cur.fetchall()}
    cur.execute(f'SELECT staff_id, SUM(amount) FROM {SCHEMA}.acc_accruals WHERE period = %s GROUP BY 1', (period,))
    acc_p = {r[0]: _num(r[1]) for r in cur.fetchall()}
    cur.execute(f"SELECT staff_id, SUM(amount) FROM {SCHEMA}.acc_payments WHERE period = %s OR "
                f"(period IS NULL AND to_char(pay_date, 'YYYY-MM') = %s) GROUP BY 1", (period, period))
    pay_p = {r[0]: _num(r[1]) for r in cur.fetchall()}
    sheet = _sheet_payroll(cur)
    for s in staff:
        if s['pay_type'] == 'tabel' and s['profile_id']:
            s['sheet'] = sheet.get(period, {}).get(s['profile_id'], 0.0)
            acc_p[s['id']] = acc_p.get(s['id'], 0.0) + s['sheet']
            acc_all[s['id']] = acc_all.get(s['id'], 0.0) + sum(m.get(s['profile_id'], 0.0) for m in sheet.values())
        else:
            s['sheet'] = None
        s['accrued'] = acc_p.get(s['id'], 0.0)
        s['paid'] = pay_p.get(s['id'], 0.0)
        s['debt'] = round(acc_all.get(s['id'], 0.0) - pay_all.get(s['id'], 0.0), 2)
    cur.execute(f'SELECT a.id, a.staff_id, a.period, a.pay_type, a.rate, a.base, a.bonus, a.amount, a.comment, a.created_at '
                f'FROM {SCHEMA}.acc_accruals a WHERE a.period = %s ORDER BY a.created_at DESC', (period,))
    accruals = [{'id': r[0], 'staff_id': r[1], 'period': r[2], 'pay_type': r[3], 'rate': _num(r[4]), 'base': _num(r[5]),
                 'bonus': _num(r[6]), 'amount': _num(r[7]), 'comment': r[8], 'created_at': r[9]} for r in cur.fetchall()]
    cur.execute(f"SELECT id, staff_id, pay_date, amount, period, comment FROM {SCHEMA}.acc_payments "
                f"WHERE period = %s OR (period IS NULL AND to_char(pay_date, 'YYYY-MM') = %s) ORDER BY pay_date DESC, id DESC",
                (period, period))
    payments = [{'id': r[0], 'staff_id': r[1], 'date': r[2], 'amount': _num(r[3]), 'period': r[4], 'comment': r[5]}
                for r in cur.fetchall()]
    return {'period': period, 'staff': staff, 'accruals': accruals, 'payments': payments,
            'total_debt': round(sum(s['debt'] for s in staff), 2)}


def _calc_accrual(pay_type: str, rate: Decimal, base: Decimal, bonus: Decimal) -> Decimal:
    if pay_type == 'salary':
        main = rate
    elif pay_type == 'percent':
        main = base * rate / Decimal(100)
    else:
        main = base * rate
    return (main + bonus).quantize(Decimal('0.01'))


def _edit(cur, user: Dict[str, Any], action: str, body: Dict[str, Any]) -> Dict[str, Any]:
    if action == 'entry_save':
        kind = body.get('kind')
        if kind not in KINDS:
            return _err('Выберите: доход или расход')
        d = _date(body.get('date'))
        amount = _money(body.get('amount'))
        if not d:
            return _err('Укажите дату')
        if amount is None:
            return _err('Укажите сумму больше нуля')
        cat = body.get('category_id')
        if cat:
            cur.execute(f'SELECT kind FROM {SCHEMA}.acc_categories WHERE id = %s', (cat,))
            c = cur.fetchone()
            if not c or c[0] != kind:
                return _err('Статья не подходит к типу операции')
        comment = (str(body.get('comment') or '').strip() or None)
        if comment:
            comment = comment[:500]
        if body.get('id'):
            cur.execute(f'SELECT payment_id FROM {SCHEMA}.acc_entries WHERE id = %s', (body['id'],))
            ex = cur.fetchone()
            if not ex:
                return _err('Операция не найдена', 404)
            if ex[0]:
                return _err('Эта операция создана выплатой зарплаты — измените её в разделе «Зарплата»')
            cur.execute(f'UPDATE {SCHEMA}.acc_entries SET kind = %s, entry_date = %s, amount = %s, category_id = %s, '
                        f'comment = %s, updated_at = now() WHERE id = %s', (kind, d, amount, cat or None, comment, body['id']))
            _log(cur, user, 'Изменена операция', f'#{body["id"]}: {kind} {amount} от {d}')
        else:
            cur.execute(f'INSERT INTO {SCHEMA}.acc_entries (kind, entry_date, amount, category_id, comment, created_by) '
                        f'VALUES (%s, %s, %s, %s, %s, %s) RETURNING id', (kind, d, amount, cat or None, comment, user['name']))
            _log(cur, user, 'Добавлена операция', f'#{cur.fetchone()[0]}: {kind} {amount} от {d}')
        return _resp(200, {'ok': True})

    if action == 'entry_delete':
        cur.execute(f'SELECT payment_id, kind, amount, entry_date FROM {SCHEMA}.acc_entries WHERE id = %s', (body.get('id'),))
        ex = cur.fetchone()
        if not ex:
            return _err('Операция не найдена', 404)
        if ex[0]:
            return _err('Эта операция создана выплатой зарплаты — удалите выплату в разделе «Зарплата»')
        cur.execute(f'DELETE FROM {SCHEMA}.acc_entries WHERE id = %s', (body['id'],))
        _log(cur, user, 'Удалена операция', f'#{body["id"]}: {ex[1]} {ex[2]} от {ex[3]}')
        return _resp(200, {'ok': True})

    if action == 'category_save':
        kind = body.get('kind')
        name = str(body.get('name') or '').strip()[:80]
        if kind not in KINDS or not name:
            return _err('Укажите название статьи')
        cur.execute(f'SELECT id FROM {SCHEMA}.acc_categories WHERE kind = %s AND lower(name) = lower(%s) AND id <> %s',
                    (kind, name, body.get('id') or 0))
        if cur.fetchone():
            return _err('Такая статья уже есть')
        if body.get('id'):
            cur.execute(f'UPDATE {SCHEMA}.acc_categories SET name = %s, archived = %s WHERE id = %s',
                        (name, bool(body.get('archived')), body['id']))
        else:
            cur.execute(f'INSERT INTO {SCHEMA}.acc_categories (kind, name) VALUES (%s, %s)', (kind, name))
        _log(cur, user, 'Статья', name)
        return _resp(200, {'ok': True, 'categories': _categories(cur)})

    if action == 'staff_save':
        name = str(body.get('name') or '').strip()[:120]
        pay_type = body.get('pay_type')
        rate = _money(body.get('rate'), allow_zero=True)
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
        vals = (name, body.get('profile_id') or None, (str(body.get('position') or '').strip()[:120] or None), pay_type, rate,
                body.get('active', True) is not False)
        if body.get('id'):
            cur.execute(f'UPDATE {SCHEMA}.acc_staff SET name = %s, profile_id = %s, position = %s, pay_type = %s, rate = %s, '
                        f'active = %s WHERE id = %s', (*vals, body['id']))
        else:
            cur.execute(f'INSERT INTO {SCHEMA}.acc_staff (name, profile_id, position, pay_type, rate, active) '
                        f'VALUES (%s, %s, %s, %s, %s, %s)', vals)
        _log(cur, user, 'Сотрудник (зарплата)', f'{name}: {pay_type} {rate}')
        return _resp(200, {'ok': True})

    if action == 'staff_import':
        cur.execute(f"SELECT p.id, p.full_name FROM {SCHEMA}.profiles p WHERE p.id IN "
                    f"(SELECT profile_id FROM {SCHEMA}.salary_data UNION SELECT profile_id FROM {SCHEMA}.manager_data) "
                    f"AND NOT EXISTS (SELECT 1 FROM {SCHEMA}.acc_staff s WHERE s.profile_id = p.id) ORDER BY p.full_name")
        added = 0
        for pid, name in cur.fetchall():
            cur.execute(f"INSERT INTO {SCHEMA}.acc_staff (name, profile_id, pay_type, rate) VALUES (%s, %s, 'tabel', 0)",
                        (name or 'Сотрудник', pid))
            added += 1
        _log(cur, user, 'Сотрудники из «Зарплаты»', f'добавлено: {added}')
        return _resp(200, {'ok': True, 'added': added})

    if action == 'accrual_save':
        cur.execute(f'SELECT name, pay_type, rate FROM {SCHEMA}.acc_staff WHERE id = %s', (body.get('staff_id'),))
        st = cur.fetchone()
        if not st:
            return _err('Сотрудник не найден', 404)
        period = str(body.get('period') or '')
        if not PERIOD_RE.match(period):
            return _err('Укажите месяц')
        pay_type = body.get('pay_type') or st[1]
        if pay_type == 'tabel':
            pay_type = 'salary'
            body = {**body, 'rate': 0}
        if pay_type not in PAY_TYPES:
            return _err('Неизвестный способ оплаты')
        rate = _money(body.get('rate') if body.get('rate') not in (None, '') else st[2], allow_zero=True)
        base = _money(body.get('base') or 0, allow_zero=True)
        bonus = _money(body.get('bonus') or 0, allow_zero=True)
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
                     (str(body.get('comment') or '').strip()[:300] or None), user['name']))
        _log(cur, user, 'Начисление', f'{st[0]} за {period}: {amount}')
        return _resp(200, {'ok': True, 'amount': float(amount)})

    if action == 'accrual_delete':
        cur.execute(f'DELETE FROM {SCHEMA}.acc_accruals WHERE id = %s RETURNING staff_id, period, amount', (body.get('id'),))
        r = cur.fetchone()
        if not r:
            return _err('Начисление не найдено', 404)
        _log(cur, user, 'Удалено начисление', f'сотрудник #{r[0]} за {r[1]}: {r[2]}')
        return _resp(200, {'ok': True})

    if action == 'payment_save':
        cur.execute(f'SELECT name, pay_type FROM {SCHEMA}.acc_staff WHERE id = %s', (body.get('staff_id'),))
        st = cur.fetchone()
        if not st:
            return _err('Сотрудник не найден', 404)
        d = _date(body.get('date'))
        amount = _money(body.get('amount'))
        period = str(body.get('period') or '')
        if not d:
            return _err('Укажите дату выплаты')
        if amount is None:
            return _err('Укажите сумму больше нуля')
        if not PERIOD_RE.match(period):
            return _err('Укажите, за какой месяц выплата')
        comment = str(body.get('comment') or '').strip()[:300] or None
        cur.execute(f'INSERT INTO {SCHEMA}.acc_payments (staff_id, pay_date, amount, period, comment, created_by) '
                    f'VALUES (%s, %s, %s, %s, %s, %s) RETURNING id', (body['staff_id'], d, amount, period, comment, user['name']))
        pid = cur.fetchone()[0]
        if body.get('to_expenses', True) and st[1] != 'tabel':
            cur.execute(f"INSERT INTO {SCHEMA}.acc_entries (kind, entry_date, amount, category_id, comment, payment_id, created_by) "
                        f"VALUES ('expense', %s, %s, %s, %s, %s, %s)",
                        (d, amount, _salary_category(cur), f'Зарплата: {st[0]} за {period}' + (f' — {comment}' if comment else ''),
                         pid, user['name']))
        _log(cur, user, 'Выплата', f'{st[0]} {amount} от {d} за {period}')
        return _resp(200, {'ok': True})

    if action == 'payment_delete':
        cur.execute(f'DELETE FROM {SCHEMA}.acc_payments WHERE id = %s RETURNING staff_id, amount, pay_date', (body.get('id'),))
        r = cur.fetchone()
        if not r:
            return _err('Выплата не найдена', 404)
        cur.execute(f'DELETE FROM {SCHEMA}.acc_entries WHERE payment_id = %s', (body['id'],))
        _log(cur, user, 'Удалена выплата', f'сотрудник #{r[0]}: {r[1]} от {r[2]}')
        return _resp(200, {'ok': True})

    if action == 'access_list':
        cur.execute(f"SELECT p.id, p.full_name, p.role, p.department, COALESCE(a.can_entries, false), "
                    f"COALESCE(a.can_profit, false), COALESCE(a.can_salary, false) FROM {SCHEMA}.profiles p "
                    f"LEFT JOIN {SCHEMA}.acc_access a ON a.profile_id = p.id WHERE p.status = 'active' ORDER BY p.full_name")
        people = [{'id': r[0], 'name': r[1], 'role': r[2], 'department': r[3],
                   'entries': r[4], 'profit': r[5], 'salary': r[6]} for r in cur.fetchall()]
        cur.execute(f'SELECT user_name, action, details, created_at FROM {SCHEMA}.acc_log ORDER BY created_at DESC LIMIT 100')
        log = [{'user': r[0], 'action': r[1], 'details': r[2], 'time': r[3]} for r in cur.fetchall()]
        return _resp(200, {'people': people, 'log': log})

    if action == 'access_save':
        pid = body.get('profile_id')
        cur.execute(f'SELECT full_name, role FROM {SCHEMA}.profiles WHERE id = %s', (pid,))
        p = cur.fetchone()
        if not p:
            return _err('Сотрудник не найден', 404)
        if p[1] in ('director', EDITOR):
            return _err('Директор и заместитель директора видят бухгалтерию всегда')
        vals = [bool(body.get(s)) for s in SECTIONS]
        cur.execute(f'INSERT INTO {SCHEMA}.acc_access (profile_id, can_entries, can_profit, can_salary, updated_at) '
                    f'VALUES (%s, %s, %s, %s, now()) ON CONFLICT (profile_id) DO UPDATE SET can_entries = EXCLUDED.can_entries, '
                    f'can_profit = EXCLUDED.can_profit, can_salary = EXCLUDED.can_salary, updated_at = now()', (pid, *vals))
        names = {'entries': 'доходы и расходы', 'profit': 'прибыль', 'salary': 'зарплата'}
        granted = ', '.join(names[s] for s, v in zip(SECTIONS, vals) if v) or 'нет доступа'
        _log(cur, user, 'Права доступа', f'{p[0]}: {granted}')
        return _resp(200, {'ok': True})

    return _err('Неизвестное действие')


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Бухгалтерия: доходы и расходы по статьям, прибыль за период, зарплата сотрудников
    (оклад / процент / по часам, начисления, выплаты, долг) и права доступа.
    Изменять данные может только заместитель директора; директор видит всё,
    остальные — только разделы, которые открыл заместитель директора (только просмотр).'''
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
        user = _user(cur, event)
        if not user:
            return _err('Нужно войти в систему', 401)
        perms = user['perms']
        if action == 'me':
            return _resp(200, {'can_edit': user['can_edit'], 'perms': perms, 'role': user['role'],
                               'categories': _categories(cur) if any(perms.values()) else []})
        if action == 'entries':
            if not perms['entries']:
                return _err('Нет доступа к доходам и расходам', 403)
            return _resp(200, {'entries': _entries(cur, body)})
        if action == 'profit':
            if not perms['profit']:
                return _err('Нет доступа к прибыли', 403)
            return _resp(200, _profit(cur, body))
        if action == 'salary':
            if not perms['salary']:
                return _err('Нет доступа к зарплате', 403)
            out = _salary(cur, body)
            if user['can_edit']:
                cur.execute(f"SELECT id, full_name FROM {SCHEMA}.profiles WHERE status = 'active' ORDER BY full_name")
                out['profiles'] = [{'id': r[0], 'name': r[1]} for r in cur.fetchall()]
            return _resp(200, out)
        if not user['can_edit']:
            return _err('Изменять бухгалтерию может только заместитель директора', 403)
        return _edit(cur, user, action, body)
    finally:
        cur.close()
        conn.close()
