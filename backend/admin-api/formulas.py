"""Настройки форм и формул зарплаты/инкассации + безопасный калькулятор формул.
Файл одинаковый в accounting-api и admin-api."""
import ast
import json
import math
import re
from typing import Any, Dict, List, Optional

DEFAULT_FORMULAS: Dict[str, str] = {
    'rate': 'revenue / (days * 24) * percent / 100',
    'total': '(rate * hours + vacation) - non_cash - overtime - tax + underpayment',
    'week': 'total / 4',
    'manager_rate': 'rate * (1 + manager_percent / 100)',
    'manager_total': '((osn_hours * manager_rate) + vacation) - non_cash + doplaty + dop_hours * rate + underpayment',
    'manager_week': 'manager_total / 4',
}
FORMULA_ORDER = ['rate', 'total', 'week', 'manager_rate', 'manager_total', 'manager_week']

DEFAULT_FIELDS: Dict[str, List[Dict[str, Any]]] = {
    'salary': [
        {'key': 'hours_worked', 'var': 'hours', 'label': 'ЧАСЫ', 'visible': True, 'builtin': True, 'kind': 'accrual'},
        {'key': 'vacation_pay', 'var': 'vacation', 'label': 'ОТПУСК', 'visible': True, 'builtin': True, 'kind': 'accrual'},
        {'key': 'non_cash', 'var': 'non_cash', 'label': 'БЕЗНАЛ', 'visible': True, 'builtin': True, 'kind': 'deduction'},
        {'key': 'overtime', 'var': 'overtime', 'label': 'ПЕРЕБОР', 'visible': True, 'builtin': True, 'kind': 'deduction'},
        {'key': 'tax', 'var': 'tax', 'label': 'НАЛОГ', 'visible': True, 'builtin': True, 'kind': 'deduction'},
        {'key': 'underpayment', 'var': 'underpayment', 'label': 'НЕДОПЛАТА', 'visible': True, 'builtin': True, 'kind': 'accrual'},
    ],
    'manager': [
        {'key': 'osn_hours', 'var': 'osn_hours', 'label': 'ОСН. ЧАСЫ', 'visible': True, 'builtin': True, 'kind': 'accrual'},
        {'key': 'dop_hours', 'var': 'dop_hours', 'label': 'ДОП. ЧАСЫ', 'visible': True, 'builtin': True, 'kind': 'accrual'},
        {'key': 'doplaty', 'var': 'doplaty', 'label': 'ДОПЛАТЫ', 'visible': True, 'builtin': True, 'kind': 'accrual'},
        {'key': 'vacation_pay', 'var': 'vacation', 'label': 'ОТПУСК', 'visible': True, 'builtin': True, 'kind': 'accrual'},
        {'key': 'non_cash', 'var': 'non_cash', 'label': 'БЕЗНАЛ', 'visible': True, 'builtin': True, 'kind': 'deduction'},
        {'key': 'underpayment', 'var': 'underpayment', 'label': 'НЕДОПЛАТА', 'visible': True, 'builtin': True, 'kind': 'accrual'},
    ],
    'collection': [
        {'key': 'sbis_value', 'var': 'sbis', 'label': 'Сбис ₽', 'visible': True, 'builtin': True, 'kind': 'number'},
        {'key': 'fact_value', 'var': 'fact', 'label': 'Факт ₽', 'visible': True, 'builtin': True, 'kind': 'number'},
    ],
}

GLOBAL_VARS = ['revenue', 'days', 'percent', 'manager_percent']
FUNCS = {'round': lambda x, n=0: round(x, int(n)), 'min': min, 'max': max, 'abs': abs,
         'floor': math.floor, 'ceil': math.ceil}
VAR_RE = re.compile(r'^[a-z_][a-z0-9_]{0,40}$')


class FormulaError(ValueError):
    pass


def _eval_node(node: ast.AST, env: Dict[str, float]) -> float:
    if isinstance(node, ast.Expression):
        return _eval_node(node.body, env)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.Name):
        if node.id not in env:
            raise FormulaError(f'Неизвестная переменная «{node.id}»')
        return float(env[node.id] or 0)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        v = _eval_node(node.operand, env)
        return -v if isinstance(node.op, ast.USub) else v
    if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
        a, b = _eval_node(node.left, env), _eval_node(node.right, env)
        if isinstance(node.op, ast.Add):
            return a + b
        if isinstance(node.op, ast.Sub):
            return a - b
        if isinstance(node.op, ast.Mult):
            return a * b
        return a / b if b else 0.0
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FUNCS and not node.keywords:
        return float(FUNCS[node.func.id](*[_eval_node(a, env) for a in node.args]))
    raise FormulaError('Разрешены только числа, переменные, + − × ÷, скобки и round/min/max/abs/floor/ceil')


def evaluate(expr: str, env: Dict[str, float]) -> float:
    try:
        tree = ast.parse((expr or '0').replace(',', '.').replace(';', ','), mode='eval')
    except SyntaxError:
        raise FormulaError('Ошибка в записи формулы')
    return _eval_node(tree, env)


def safe_eval(expr: str, env: Dict[str, float]) -> float:
    try:
        return evaluate(expr, env)
    except (FormulaError, TypeError, ValueError, OverflowError):
        return 0.0


def load_config(cur, schema: str) -> Dict[str, Any]:
    cur.execute(f"SELECT key, value FROM {schema}.app_settings WHERE key IN ('formulas', 'fields')")
    raw = {k: (v if isinstance(v, (dict, list)) else json.loads(v)) for k, v in cur.fetchall()}
    formulas = {**DEFAULT_FORMULAS, **{k: v for k, v in (raw.get('formulas') or {}).items() if k in DEFAULT_FORMULAS}}
    fields = {k: (raw.get('fields') or {}).get(k) or v for k, v in DEFAULT_FIELDS.items()}
    return {'formulas': formulas, 'fields': fields}


def global_params(cur, schema: str) -> Dict[str, float]:
    cur.execute(f'SELECT percent FROM {schema}.salary_settings WHERE month_year IS NULL LIMIT 1')
    r = cur.fetchone()
    pct = float(r[0]) if r and r[0] is not None else 2.5
    cur.execute(f'SELECT manager_percent FROM {schema}.manager_settings WHERE month_year IS NULL LIMIT 1')
    r = cur.fetchone()
    mpct = float(r[0]) if r and r[0] is not None else 5.0
    return {'percent': pct, 'manager_percent': mpct}


def _row_env(row: Dict[str, Any], fields: List[Dict[str, Any]]) -> Dict[str, float]:
    env: Dict[str, float] = {}
    extra = row.get('extra') or {}
    if isinstance(extra, str):
        extra = json.loads(extra or '{}')
    for f in fields:
        v = row.get(f['key']) if f.get('builtin') else extra.get(f['key'])
        try:
            env[f['var']] = float(v or 0)
        except (TypeError, ValueError):
            env[f['var']] = 0.0
    return env


def compute_period(cur, schema: str, my: str, cfg: Dict[str, Any], params: Dict[str, float]) -> Dict[str, Any]:
    """Расчёт зарплаты за месяц (формат месяца ММ.ГГГГ) по тем же формулам, что на странице «Зарплата»."""
    fx = cfg['formulas']
    cur.execute(f'SELECT revenue, days_in_month FROM {schema}.salary_settings WHERE month_year = %s', (my,))
    r = cur.fetchone()
    base = {'revenue': float(r[0] or 0) if r else 0.0, 'days': float(r[1] or 30) if r else 30.0, **params}
    base['rate'] = safe_eval(fx['rate'], base)
    base['manager_rate'] = safe_eval(fx['manager_rate'], base)
    people: List[Dict[str, Any]] = []
    for table, kind, fields, tkey in (('salary_data', 'emp', cfg['fields']['salary'], 'total'),
                                       ('manager_data', 'mgr', cfg['fields']['manager'], 'manager_total')):
        cols = sorted({f['key'] for f in fields if f.get('builtin')})
        cur.execute(f"SELECT d.profile_id, COALESCE(p.full_name, ''), d.extra, {', '.join('d.' + c for c in cols)} "
                    f'FROM {schema}.{table} d LEFT JOIN {schema}.profiles p ON p.id = d.profile_id '
                    f'WHERE d.month_year = %s', (my,))
        for rec in cur.fetchall():
            row = {'profile_id': rec[0], 'name': rec[1].strip(), 'extra': rec[2], **dict(zip(cols, rec[3:]))}
            env = {**base, **_row_env(row, fields)}
            raw = safe_eval(fx[tkey], env)
            wkey = 'manager_week' if kind == 'mgr' else 'week'
            try:
                week = safe_eval(fx.get(wkey) or f'{tkey} / 4', {**env, tkey: raw})
            except Exception:
                week = raw / 4
            people.append({'profile_id': rec[0], 'name': row['name'], 'kind': kind, 'total': round(raw, 2), 'raw': raw,
                           'week': round(week, 2),
                           'rate': round(base['manager_rate' if kind == 'mgr' else 'rate'], 4),
                           'values': {f['key']: env.get(f['var'], 0.0) for f in fields}})
    return {'base': base, 'people': people}
