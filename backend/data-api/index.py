import json
import os
import re
import uuid as uuidlib
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

import psycopg2
import psycopg2.extras

SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')

# Разрешённые таблицы (белый список — защита от SQL-инъекций через имя таблицы)
ALLOWED_TABLES = {
    'companies', 'profiles', 'pin_codes', 'schedule_config', 'employee_schedule_settings',
    'schedule_data', 'schedule_settings', 'salary_data', 'salary_settings', 'manager_data',
    'manager_settings', 'employee_rotation', 'collection_data', 'documents', 'folders',
    'base_files', 'dto_categories', 'dto_templates', 'chat_rooms', 'chat_messages', 'devices',
    'kiosk_buttons', 'plan_events', 'schedule_configurators',
}

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Authorization, X-Session-Id',
    'Access-Control-Max-Age': '86400',
}

IDENT_RE = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')


def _json_default(value: Any) -> Any:
    # Decimal (numeric-колонки Postgres) должны стать настоящими числами в JSON,
    # иначе фронтенд складывает их как строки ("0"+"0"+"5" = "005" вместо 5)
    if isinstance(value, Decimal):
        as_float = float(value)
        return int(as_float) if as_float.is_integer() else as_float
    return str(value)


def _resp(status: int, payload: Any) -> Dict[str, Any]:
    return {
        'statusCode': status,
        'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
        'body': json.dumps(payload, ensure_ascii=False, default=_json_default),
    }


def _conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])


def _check_ident(name: str) -> str:
    if not IDENT_RE.match(name):
        raise ValueError(f'Недопустимое имя: {name}')
    return name


def _build_where(filters: List[Dict[str, Any]]) -> tuple:
    """Собирает WHERE из списка фильтров вида {col, op, value}."""
    clauses = []
    params: List[Any] = []
    for f in filters:
        col = _check_ident(f['col'])
        op = f['op']
        val = f.get('value')
        if op == 'eq':
            if val is None:
                clauses.append(f'"{col}" IS NULL')
            else:
                clauses.append(f'"{col}" = %s')
                params.append(val)
        elif op == 'neq':
            if val is None:
                clauses.append(f'"{col}" IS NOT NULL')
            else:
                clauses.append(f'"{col}" != %s')
                params.append(val)
        elif op == 'is':
            if val is None:
                clauses.append(f'"{col}" IS NULL')
            else:
                clauses.append(f'"{col}" IS %s')
                params.append(val)
        elif op == 'in':
            vals = val if isinstance(val, list) else [val]
            if not vals:
                clauses.append('FALSE')
            else:
                placeholders = ','.join(['%s'] * len(vals))
                clauses.append(f'"{col}" IN ({placeholders})')
                params.extend(vals)
        elif op == 'not_eq':
            # not('col', 'eq', val) -> исключить строки где col = val (NULL считается не равным)
            clauses.append(f'("{col}" IS NULL OR "{col}" != %s)')
            params.append(val)
        elif op == 'not_is':
            if val is None:
                clauses.append(f'"{col}" IS NOT NULL')
            else:
                clauses.append(f'"{col}" IS NOT %s')
                params.append(val)
        elif op == 'gt':
            clauses.append(f'"{col}" > %s'); params.append(val)
        elif op == 'gte':
            clauses.append(f'"{col}" >= %s'); params.append(val)
        elif op == 'lt':
            clauses.append(f'"{col}" < %s'); params.append(val)
        elif op == 'lte':
            clauses.append(f'"{col}" <= %s'); params.append(val)
        elif op == 'ilike':
            clauses.append(f'"{col}" ILIKE %s'); params.append(val)
        else:
            raise ValueError(f'Неизвестный оператор: {op}')
    return clauses, params


def _row_to_dict(row, colnames):
    return dict(zip(colnames, row))


def _extract_token(event: Dict[str, Any], body: Dict[str, Any]) -> str:
    headers = event.get('headers') or {}
    # Заголовки у прокси иногда приходят в разном регистре — проверяем оба варианта
    token = headers.get('X-Authorization') or headers.get('x-authorization') or body.get('token') or ''
    if token.startswith('Bearer '):
        token = token[7:]
    return token.strip()


LIC_SQL = 'true'


_CURRENT: Dict[str, str] = {'uid': ''}


def _authenticate(cur, token: str) -> Optional[Dict[str, Any]]:
    """Проверяет токен запроса: либо обычная сессия сайта (30 дней), либо постоянный
    API-токен десктоп-приложения. Возвращает пользователя или None, если токен невалиден."""
    if not token:
        return None
    cur.execute(
        f'SELECT u.id, u.email, u.is_admin, {LIC_SQL} FROM {SCHEMA}.auth_sessions s '
        f'JOIN {SCHEMA}.auth_users u ON u.id = s.user_id '
        f'LEFT JOIN {SCHEMA}.biz_organizations o ON o.id = u.org_id '
        f'WHERE s.token = %s AND s.expires_at > now()',
        (token,),
    )
    row = cur.fetchone()
    if row:
        return {'id': row[0], 'email': row[1], 'is_admin': row[2], 'licensed': bool(row[3])}

    cur.execute(
        f'SELECT u.id, u.email, u.is_admin, {LIC_SQL} FROM {SCHEMA}.api_tokens t '
        f'JOIN {SCHEMA}.auth_users u ON u.id = t.user_id '
        f'LEFT JOIN {SCHEMA}.biz_organizations o ON o.id = u.org_id '
        f'WHERE t.token = %s AND t.revoked_at IS NULL',
        (token,),
    )
    row = cur.fetchone()
    if row:
        cur.execute(f'UPDATE {SCHEMA}.api_tokens SET last_used_at = now() WHERE token = %s', (token,))
        return {'id': row[0], 'email': row[1], 'is_admin': row[2], 'licensed': bool(row[3])}
    return None


def _run(cur, conn, body: Dict[str, Any]) -> tuple:
    """Выполняет одну операцию {table, op, ...}. Возвращает (status, payload)."""
    table = body.get('table')
    if not table or table not in ALLOWED_TABLES:
        return 200, {'data': None, 'error': {'message': f'Недопустимая или отсутствующая таблица: {table}'}}

    op = body.get('op', 'select')
    filters = body.get('filters', [])
    order = body.get('order')
    limit = body.get('limit')
    single_mode = body.get('single_mode')
    payload = body.get('payload')
    full_table = f'"{SCHEMA}"."{table}"'

    if op == 'select':
        where_sql = ''
        params: List[Any] = []
        clauses: List[str] = []
        if filters:
            clauses, params = _build_where(filters)
        if table == 'profiles':
            clauses = list(clauses) + ["id <> 'demo-director-profile'",
                                       f"(user_id IS NULL OR user_id NOT IN (SELECT id FROM \"{SCHEMA}\".auth_users "
                                       f"WHERE org_id IS DISTINCT FROM (SELECT org_id FROM \"{SCHEMA}\".auth_users WHERE id = '{_CURRENT['uid']}')))"]
        elif table in ('schedule_config', 'employee_schedule_settings', 'salary_data'):
            clauses = list(clauses) + ["profile_id IS DISTINCT FROM 'demo-director-profile'"]
        if clauses:
            where_sql = ' WHERE ' + ' AND '.join(clauses)
        order_sql = ''
        if order:
            col = _check_ident(order['col'])
            direction = 'ASC' if order.get('ascending', True) else 'DESC'
            order_sql = f' ORDER BY "{col}" {direction}'
        limit_sql = f' LIMIT {int(limit)}' if limit else ''
        cur.execute(f'SELECT * FROM {full_table}{where_sql}{order_sql}{limit_sql}', params)
        colnames = [d[0] for d in cur.description]
        rows = [_row_to_dict(r, colnames) for r in cur.fetchall()]
        conn.commit()
        if single_mode:
            if not rows:
                if single_mode == 'maybe':
                    return 200, {'data': None, 'error': None}
                return 200, {'data': None, 'error': {'message': 'Запись не найдена', 'code': 'PGRST116'}}
            return 200, {'data': rows[0], 'error': None}
        return 200, {'data': rows, 'error': None}

    if op == 'insert':
        items = payload if isinstance(payload, list) else [payload]
        inserted_rows = []
        for item in items:
            item = dict(item or {})
            if 'id' not in item or not item['id']:
                item['id'] = str(uuidlib.uuid4())
            cols = list(item.keys())
            for c in cols:
                _check_ident(c)
            placeholders = ','.join(['%s'] * len(cols))
            col_sql = ','.join(f'"{c}"' for c in cols)
            vals = [json.dumps(v) if isinstance(v, (dict, list)) else v for v in item.values()]
            cur.execute(f'INSERT INTO {full_table} ({col_sql}) VALUES ({placeholders}) RETURNING *', vals)
            colnames = [d[0] for d in cur.description]
            inserted_rows.append(_row_to_dict(cur.fetchone(), colnames))
        conn.commit()
        if single_mode == 'single' and inserted_rows:
            return 200, {'data': inserted_rows[0], 'error': None}
        return 200, {'data': inserted_rows, 'error': None}

    if op in ('update', 'delete'):
        if not filters:
            return 400, {'error': f'{op} требует хотя бы один фильтр'}
        clauses, params = _build_where(filters)
        where_sql = ' WHERE ' + ' AND '.join(clauses)
        if op == 'update':
            item = dict(payload or {})
            for c in item.keys():
                _check_ident(c)
            set_sql = ','.join(f'"{c}" = %s' for c in item.keys())
            set_vals = [json.dumps(v) if isinstance(v, (dict, list)) else v for v in item.values()]
            cur.execute(f'UPDATE {full_table} SET {set_sql}{where_sql} RETURNING *', set_vals + params)
        else:
            cur.execute(f'DELETE FROM {full_table}{where_sql} RETURNING *', params)
        colnames = [d[0] for d in cur.description] if cur.description else []
        rows = [_row_to_dict(r, colnames) for r in cur.fetchall()] if colnames else []
        conn.commit()
        return 200, {'data': rows, 'error': None}

    return 400, {'error': f'Неизвестная операция: {op}'}


def _handler_impl(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Универсальный REST-бэкенд для CRUD-операций над таблицами компании: сотрудники,
    табель, зарплата, документы, чат, шаблоны ДТО и т.д. Поддерживает пакетный режим
    {batch: [...]} — много операций одним запросом. Доступ только по сессии сайта
    или API-токену десктоп-приложения (X-Authorization).'''
    method = event.get('httpMethod', 'GET')

    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    if method != 'POST':
        return _resp(405, {'error': 'Используйте POST с телом {table, op, ...}'})

    try:
        body = json.loads(event.get('body') or '{}')
    except Exception:
        return _resp(400, {'error': 'Некорректный JSON'})

    batch = body.get('batch')
    if batch is None and (not body.get('table') or body.get('table') not in ALLOWED_TABLES):
        return _resp(200, {'data': None, 'error': {'message': f"Недопустимая или отсутствующая таблица: {body.get('table')}"}})

    token = _extract_token(event, body)
    conn = None
    try:
        conn = _conn()
        conn.autocommit = False
        with conn.cursor() as cur:
            user = _authenticate(cur, token)
            _CURRENT['uid'] = str(user['id']).replace("'", '') if user else ''

            conn.commit()
            if not user:
                return _resp(401, {'data': None, 'error': {'message': 'Не авторизован: нужен действующий токен входа'}})
            if not user.get('licensed'):
                return _resp(402, {'data': None, 'license_blocked': True, 'error': {'message': 'Заключите лицензионный договор на подписку БИЗ (BIZ). Напишите на do@bizwor.ru'}})

            if batch is not None:
                results = []
                for q in batch if isinstance(batch, list) else []:
                    try:
                        _, payload = _run(cur, conn, q or {})
                    except Exception as e:
                        conn.rollback()
                        payload = {'data': None, 'error': {'message': str(e)}}
                    results.append(payload)
                return _resp(200, {'results': results})

            status, payload = _run(cur, conn, body)
            return _resp(status, payload)
    except Exception as e:
        return _resp(200, {'data': None, 'error': {'message': str(e)}})
    finally:
        if conn is not None:
            conn.close()


import tenant as _tenant  # noqa: E402


def _finders(body, event, qs):
    return []


_wrapped = _tenant.wrap(globals(), _handler_impl, _finders, ())


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Универсальный REST-бэкенд для CRUD-операций над таблицами компании: сотрудники,
    табель, зарплата, документы, чат, шаблоны ДТО и т.д. Поддерживает пакетный режим
    {batch: [...]} — много операций одним запросом. Доступ только по сессии сайта
    или API-токену десктоп-приложения (X-Authorization).
    Данные каждой организации хранятся отдельно: схема выбирается по токену.'''
    return _wrapped(event, context)
