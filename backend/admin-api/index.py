import json
import os
import re
from typing import Any, Dict

import psycopg2

from access import ACTIONS, ALL_ACTIONS, DEPUTY, SECTIONS, current_user
from formulas import (DEFAULT_FIELDS, DEFAULT_FORMULAS, FORMULA_ORDER, GLOBAL_VARS, VAR_RE, FormulaError,
                      evaluate, global_params, load_config)

SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')
CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Authorization',
    'Access-Control-Max-Age': '86400',
}
SECTION_PATHS = {s['path'] for s in SECTIONS}
ROLES = {'director', DEPUTY, 'senior_employee', 'employee'}
FORMULA_LABELS = {
    'rate': 'Ставка сотрудника, ₽/час (D)', 'total': 'ИТОГ сотрудника (I)', 'week': 'Неделя сотрудника (J)',
    'manager_rate': 'Ставка руководителя, ₽/час', 'manager_total': 'ИТОГ руководителя', 'manager_week': 'Неделя руководителя',
}


def _resp(status: int, payload: Any) -> Dict[str, Any]:
    return {'statusCode': status, 'headers': {**CORS, 'Content-Type': 'application/json'},
            'body': json.dumps(payload, ensure_ascii=False, default=str)}


def _err(text: str, status: int = 400) -> Dict[str, Any]:
    return _resp(status, {'error': text})


def _log(cur, user: Dict[str, Any], action: str, details: str) -> None:
    cur.execute(f'INSERT INTO {SCHEMA}.acc_log (user_name, action, details) VALUES (%s, %s, %s)',
                (user['name'], 'Админ: ' + action, details[:500]))


def _set(cur, key: str, value: Any, user: Dict[str, Any]) -> None:
    cur.execute(f'INSERT INTO {SCHEMA}.app_settings (key, value, updated_by, updated_at) VALUES (%s, %s, %s, now()) '
                f'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()',
                (key, json.dumps(value, ensure_ascii=False), user['name']))


def _general(cur) -> Dict[str, Any]:
    cur.execute(f"SELECT key, value FROM {SCHEMA}.app_settings WHERE key IN ('accounting', 'shift_hours')")
    raw = {k: (v if isinstance(v, (dict, list)) else json.loads(v)) for k, v in cur.fetchall()}
    return {'start_period': (raw.get('accounting') or {}).get('start_period') or '2026-09',
            'shift_hours': {**{'Д': 12, 'Н': 12, 'Дп': 12, 'Нп': 12}, **(raw.get('shift_hours') or {})}}


def _positions(cur):
    cur.execute(f'SELECT pos.id, pos.name, pos.sections, pos.actions, '
                f'(SELECT count(*) FROM {SCHEMA}.profiles p WHERE p.position_id = pos.id) FROM {SCHEMA}.positions pos ORDER BY pos.name')
    out = []
    for r in cur.fetchall():
        out.append({'id': r[0], 'name': r[1], 'sections': r[2] if isinstance(r[2], list) else json.loads(r[2] or '[]'),
                    'actions': r[3] if isinstance(r[3], list) else json.loads(r[3] or '[]'), 'people': r[4]})
    return out


def _variables(fields: Dict[str, Any]) -> Dict[str, Any]:
    return {
        'global': [{'var': 'revenue', 'label': 'Выручка месяца (C3)'}, {'var': 'days', 'label': 'Дней в месяце (C9)'},
                   {'var': 'percent', 'label': 'Процент сотрудникам'}, {'var': 'manager_percent', 'label': 'Надбавка руководителям, %'}],
        'salary': [{'var': f['var'], 'label': f['label']} for f in fields['salary']],
        'manager': [{'var': f['var'], 'label': f['label']} for f in fields['manager']],
    }


def _validate_formulas(formulas: Dict[str, str], fields: Dict[str, Any]) -> None:
    g = {v: 1.0 for v in GLOBAL_VARS}
    g['revenue'], g['days'] = 1000000.0, 30.0
    emp = {**g, **{f['var']: 1.0 for f in fields['salary']}}
    mgr = {**g, **{f['var']: 1.0 for f in fields['manager']}}
    for k in FORMULA_ORDER:
        if k in ('rate', 'manager_rate'):
            env = dict(g)
            if k == 'manager_rate':
                env['rate'] = 1.0
        elif k.startswith('manager'):
            env = {**mgr, 'rate': 1.0, 'manager_rate': 1.0, 'manager_total': 1.0}
        else:
            env = {**emp, 'rate': 1.0, 'total': 1.0}
        try:
            evaluate(formulas[k], env)
        except FormulaError as e:
            raise FormulaError(f'{FORMULA_LABELS[k]}: {e}')


def _handler_impl(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Админ-панель заместителя директора: должности, доступ к разделам и кнопкам по должностям,
    формулы зарплаты, поля форм (Зарплата, Инкассация), справочники. Также отдаёт права
    текущего пользователя (action=my_access) для меню и кнопок на сайте.'''
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

        if action == 'my_access':
            cfg = load_config(cur, SCHEMA)
            return _resp(200, {'general': _general(cur),'role': user['role'], 'position': user['position'], 'sections': user['sections'],
                               'actions': sorted(user['actions']), 'is_deputy': user['is_deputy'],
                               'formulas': cfg['formulas'], 'fields': cfg['fields']})

        if not user['is_deputy']:
            return _err('Админ-панель доступна только заместителю директора', 403)

        if action == 'overview':
            cfg = load_config(cur, SCHEMA)
            cur.execute(f"SELECT p.id, p.full_name, p.role, p.department, p.position_id, p.status FROM {SCHEMA}.profiles p "
                        f"ORDER BY p.status, p.full_name")
            people = [{'id': r[0], 'name': (r[1] or '').strip(), 'role': r[2], 'department': r[3], 'position_id': r[4],
                       'active': r[5] == 'active'} for r in cur.fetchall()]
            cur.execute(f'SELECT id, kind, name, archived FROM {SCHEMA}.acc_categories ORDER BY kind, archived, name')
            cats = [{'id': r[0], 'kind': r[1], 'name': r[2], 'archived': r[3]} for r in cur.fetchall()]
            cur.execute(f'SELECT id, name, kind, inn, phone, comment, archived FROM {SCHEMA}.acc_counterparties ORDER BY archived, name')
            cps = [{'id': r[0], 'name': r[1], 'kind': r[2], 'inn': r[3], 'phone': r[4], 'comment': r[5], 'archived': r[6]}
                   for r in cur.fetchall()]
            return _resp(200, {
                'sections': SECTIONS, 'actions': ACTIONS, 'positions': _positions(cur), 'people': people,
                'formulas': cfg['formulas'], 'default_formulas': DEFAULT_FORMULAS, 'formula_labels': FORMULA_LABELS,
                'formula_order': FORMULA_ORDER, 'fields': cfg['fields'], 'default_fields': DEFAULT_FIELDS,
                'variables': _variables(cfg['fields']), 'params': global_params(cur, SCHEMA),
                'categories': cats, 'counterparties': cps, 'general': _general(cur),
            })

        if action == 'general_save':
            sp = str(body.get('start_period') or '')
            if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', sp):
                return _err('Укажите месяц начала учёта')
            hours = {}
            for k in ('Д', 'Н', 'Дп', 'Нп'):
                try:
                    v = float(str((body.get('shift_hours') or {}).get(k, 12)).replace(',', '.'))
                except ValueError:
                    return _err('Часы смены — числом')
                if not 0 <= v <= 24:
                    return _err('Смена — от 0 до 24 часов')
                hours[k] = v
            _set(cur, 'accounting', {'start_period': sp}, user)
            _set(cur, 'shift_hours', hours, user)
            cur.execute(f'UPDATE {SCHEMA}.acc_accruals SET void = (period < %s) WHERE source_key IS NOT NULL', (sp,))
            cur.execute(f"UPDATE {SCHEMA}.acc_entries SET void = (period < %s) WHERE source IN ('salary', 'collection')", (sp,))
            cur.execute(f'UPDATE {SCHEMA}.acc_periods SET fingerprint = NULL')
            _log(cur, user, 'Общие настройки', f'учёт с {sp}; часы смен {hours}')
            return _resp(200, {'ok': True})

        if action == 'position_save':
            name = str(body.get('name') or '').strip()[:80]
            if not name:
                return _err('Укажите название должности')
            sections = [s for s in (body.get('sections') or []) if s in SECTION_PATHS]
            actions = [a for a in (body.get('actions') or []) if a in ALL_ACTIONS]
            cur.execute(f'SELECT id FROM {SCHEMA}.positions WHERE lower(name) = lower(%s) AND id <> %s', (name, body.get('id') or 0))
            if cur.fetchone():
                return _err('Такая должность уже есть')
            if body.get('id'):
                cur.execute(f'UPDATE {SCHEMA}.positions SET name = %s, sections = %s, actions = %s WHERE id = %s',
                            (name, json.dumps(sections), json.dumps(actions), body['id']))
            else:
                cur.execute(f'INSERT INTO {SCHEMA}.positions (name, sections, actions) VALUES (%s, %s, %s)',
                            (name, json.dumps(sections), json.dumps(actions)))
            _log(cur, user, 'Должность', f'{name}: разделов {len(sections)}, прав {len(actions)}')
            return _resp(200, {'ok': True, 'positions': _positions(cur)})

        if action == 'position_delete':
            cur.execute(f'UPDATE {SCHEMA}.profiles SET position_id = NULL WHERE position_id = %s', (body.get('id'),))
            cur.execute(f'DELETE FROM {SCHEMA}.positions WHERE id = %s RETURNING name', (body.get('id'),))
            r = cur.fetchone()
            if r:
                _log(cur, user, 'Удалена должность', r[0])
            return _resp(200, {'ok': True, 'positions': _positions(cur)})

        if action == 'person_save':
            pid = body.get('profile_id')
            cur.execute(f'SELECT full_name, role FROM {SCHEMA}.profiles WHERE id = %s', (pid,))
            p = cur.fetchone()
            if not p:
                return _err('Сотрудник не найден', 404)
            role = body.get('role') or p[1]
            if role not in ROLES:
                return _err('Неизвестная роль')
            if p[1] == DEPUTY and role != DEPUTY:
                cur.execute(f"SELECT count(*) FROM {SCHEMA}.profiles WHERE role = %s AND status = 'active'", (DEPUTY,))
                if cur.fetchone()[0] <= 1:
                    return _err('Нельзя снять последнего заместителя директора')
            pos = body.get('position_id') or None
            cur.execute(f'UPDATE {SCHEMA}.profiles SET position_id = %s, role = %s WHERE id = %s', (pos, role, pid))
            _log(cur, user, 'Сотрудник', f'{p[0]}: роль {role}, должность #{pos or "—"}')
            return _resp(200, {'ok': True})

        if action == 'formulas_save':
            cfg = load_config(cur, SCHEMA)
            formulas = {k: str((body.get('formulas') or {}).get(k) or DEFAULT_FORMULAS[k]).strip()[:500] for k in DEFAULT_FORMULAS}
            try:
                _validate_formulas(formulas, cfg['fields'])
            except FormulaError as e:
                return _err(str(e))
            _set(cur, 'formulas', formulas, user)
            params = body.get('params') or {}
            if 'percent' in params:
                cur.execute(f'UPDATE {SCHEMA}.salary_settings SET percent = %s WHERE month_year IS NULL', (float(params['percent'] or 0),))
            if 'manager_percent' in params:
                cur.execute(f'UPDATE {SCHEMA}.manager_settings SET manager_percent = %s WHERE month_year IS NULL',
                            (float(params['manager_percent'] or 0),))
            cur.execute(f'UPDATE {SCHEMA}.acc_periods SET fingerprint = NULL')
            _log(cur, user, 'Формулы зарплаты', '; '.join(f'{k}={v}' for k, v in formulas.items()))
            return _resp(200, {'ok': True})

        if action == 'formula_test':
            env = {k: float(v or 0) for k, v in (body.get('env') or {}).items() if VAR_RE.match(k)}
            try:
                return _resp(200, {'value': round(evaluate(str(body.get('expr') or ''), env), 4)})
            except FormulaError as e:
                return _err(str(e))

        if action == 'fields_save':
            form = body.get('form')
            if form not in DEFAULT_FIELDS:
                return _err('Неизвестная форма')
            cfg = load_config(cur, SCHEMA)
            builtin = {f['key']: f for f in DEFAULT_FIELDS[form]}
            out, seen_vars = [], set(GLOBAL_VARS) | {'rate', 'total', 'manager_rate', 'manager_total'}
            for f in (body.get('fields') or [])[:30]:
                key = str(f.get('key') or '').strip()
                label = str(f.get('label') or '').strip()[:40]
                if not label:
                    return _err('У каждого поля должно быть название')
                if key in builtin:
                    item = {**builtin[key], 'label': label, 'visible': bool(f.get('visible', True)),
                            'kind': f.get('kind') or builtin[key]['kind']}
                else:
                    var = str(f.get('var') or '').strip().lower()
                    if not VAR_RE.match(var):
                        return _err(f'Поле «{label}»: имя для формулы — только латиница, цифры и _')
                    item = {'key': key if key.startswith('x_') else 'x_' + var, 'var': var, 'label': label,
                            'visible': bool(f.get('visible', True)), 'builtin': False,
                            'kind': f.get('kind') if f.get('kind') in ('accrual', 'deduction', 'number', 'text') else 'number'}
                if item['var'] in seen_vars:
                    return _err(f'Имя «{item["var"]}» уже занято')
                seen_vars.add(item['var'])
                out.append(item)
            for k, b in builtin.items():
                if not any(o['key'] == k for o in out):
                    out.append({**b, 'visible': False})
            fields = {**cfg['fields'], form: out}
            if form in ('salary', 'manager'):
                try:
                    _validate_formulas(cfg['formulas'], fields)
                except FormulaError as e:
                    return _err(f'Сначала поправьте формулу — {e}')
            _set(cur, 'fields', fields, user)
            _log(cur, user, 'Поля формы', f'{form}: ' + ', '.join(o['label'] for o in out if o['visible']))
            return _resp(200, {'ok': True, 'fields': fields})

        if action == 'reset':
            what = body.get('what')
            if what not in ('formulas', 'fields'):
                return _err('Неизвестная настройка')
            cur.execute(f'DELETE FROM {SCHEMA}.app_settings WHERE key = %s', (what,))
            _log(cur, user, 'Сброс', what)
            return _resp(200, {'ok': True})

        if action == 'category_save':
            kind, name = body.get('kind'), str(body.get('name') or '').strip()[:80]
            if kind not in ('income', 'expense') or not name:
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
            return _resp(200, {'ok': True})

        if action == 'counterparty_save':
            name = str(body.get('name') or '').strip()[:150]
            kind = body.get('kind') if body.get('kind') in ('supplier', 'customer', 'landlord', 'other') else 'supplier'
            if not name:
                return _err('Укажите название контрагента')
            inn = re.sub(r'\D', '', str(body.get('inn') or ''))[:12] or None
            vals = (name, kind, inn, (str(body.get('phone') or '').strip()[:40] or None),
                    (str(body.get('comment') or '').strip()[:300] or None), bool(body.get('archived')))
            if body.get('id'):
                cur.execute(f'UPDATE {SCHEMA}.acc_counterparties SET name = %s, kind = %s, inn = %s, phone = %s, comment = %s, '
                            f'archived = %s WHERE id = %s', (*vals, body['id']))
            else:
                cur.execute(f'INSERT INTO {SCHEMA}.acc_counterparties (name, kind, inn, phone, comment, archived) '
                            f'VALUES (%s, %s, %s, %s, %s, %s)', vals)
            _log(cur, user, 'Контрагент', name)
            return _resp(200, {'ok': True})

        return _err('Неизвестное действие')
    finally:
        cur.close()
        conn.close()


import tenant as _tenant  # noqa: E402


def _finders(body, event, qs):
    return []


_wrapped = _tenant.wrap(globals(), _handler_impl, _finders, ('my_access',))


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Админ-панель заместителя директора: должности, доступ к разделам и кнопкам по должностям,
    формулы зарплаты, поля форм (Зарплата, Инкассация), справочники. Также отдаёт права
    текущего пользователя (action=my_access) для меню и кнопок на сайте.
    Данные каждой организации хранятся отдельно: схема выбирается по токену.'''
    return _wrapped(event, context)
