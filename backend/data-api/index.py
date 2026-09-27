import json
import os
import re
import uuid as uuidlib
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import psycopg2
import psycopg2.extras

SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')

# Разрешённые таблицы (белый список — защита от SQL-инъекций через имя таблицы)
ALLOWED_TABLES = {
    'companies', 'profiles', 'pin_codes', 'schedule_config', 'employee_schedule_settings',
    'schedule_data', 'schedule_settings', 'salary_data', 'salary_settings', 'manager_data',
    'manager_settings', 'employee_rotation', 'collection_data', 'documents', 'folders',
    'base_files', 'dto_categories', 'dto_templates', 'chat_rooms', 'chat_messages',
}

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Authorization, X-Session-Id',
    'Access-Control-Max-Age': '86400',
}

IDENT_RE = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')


def _resp(status: int, payload: Any) -> Dict[str, Any]:
    return {
        'statusCode': status,
        'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
        'body': json.dumps(payload, ensure_ascii=False, default=str),
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


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Универсальный REST-бэкенд для CRUD-операций над таблицами компании: сотрудники,
    табель, зарплата, документы, чат, шаблоны ДТО и т.д. Заменяет прежнее хранение в
    localStorage — все данные реальной компании теперь в PostgreSQL, с доступом только
    для авторизованных пользователей (проверка сессии выполняется на фронтенде через auth-api).'''
    method = event.get('httpMethod', 'GET')

    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    if method != 'POST':
        return _resp(405, {'error': 'Используйте POST с телом {table, op, ...}'})

    try:
        body = json.loads(event.get('body') or '{}')
    except Exception:
        return _resp(400, {'error': 'Некорректный JSON'})

    table = body.get('table')
    if not table or table not in ALLOWED_TABLES:
        return _resp(200, {'data': None, 'error': {'message': f'Недопустимая или отсутствующая таблица: {table}'}})

    op = body.get('op', 'select')
    filters = body.get('filters', [])
    order = body.get('order')  # {col, ascending}
    limit = body.get('limit')
    single_mode = body.get('single_mode')  # 'single' | 'maybe' | None
    payload = body.get('payload')

    try:
        conn = _conn()
        conn.autocommit = False
        full_table = f'"{SCHEMA}"."{table}"'
        with conn.cursor() as cur:

            if op == 'select':
                where_sql = ''
                params: List[Any] = []
                if filters:
                    clauses, params = _build_where(filters)
                    where_sql = ' WHERE ' + ' AND '.join(clauses)
                order_sql = ''
                if order:
                    col = _check_ident(order['col'])
                    direction = 'ASC' if order.get('ascending', True) else 'DESC'
                    order_sql = f' ORDER BY "{col}" {direction}'
                limit_sql = f' LIMIT {int(limit)}' if limit else ''
                sql = f'SELECT * FROM {full_table}{where_sql}{order_sql}{limit_sql}'
                cur.execute(sql, params)
                colnames = [d[0] for d in cur.description]
                rows = [_row_to_dict(r, colnames) for r in cur.fetchall()]
                conn.commit()

                if single_mode:
                    if not rows:
                        if single_mode == 'maybe':
                            return _resp(200, {'data': None, 'error': None})
                        return _resp(200, {'data': None, 'error': {'message': 'Запись не найдена', 'code': 'PGRST116'}})
                    return _resp(200, {'data': rows[0], 'error': None})
                return _resp(200, {'data': rows, 'error': None})

            elif op == 'insert':
                items = payload if isinstance(payload, list) else [payload]
                now = datetime.now(timezone.utc).isoformat()
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
                    sql = f'INSERT INTO {full_table} ({col_sql}) VALUES ({placeholders}) RETURNING *'
                    cur.execute(sql, vals)
                    colnames = [d[0] for d in cur.description]
                    inserted_rows.append(_row_to_dict(cur.fetchone(), colnames))
                conn.commit()
                if single_mode == 'single' and inserted_rows:
                    return _resp(200, {'data': inserted_rows[0], 'error': None})
                return _resp(200, {'data': inserted_rows, 'error': None})

            elif op == 'update':
                if not filters:
                    return _resp(400, {'error': 'update требует хотя бы один фильтр'})
                clauses, params = _build_where(filters)
                where_sql = ' WHERE ' + ' AND '.join(clauses)
                item = dict(payload or {})
                for c in item.keys():
                    _check_ident(c)
                set_cols = list(item.keys())
                set_sql = ','.join(f'"{c}" = %s' for c in set_cols)
                set_vals = [json.dumps(v) if isinstance(v, (dict, list)) else v for v in item.values()]
                sql = f'UPDATE {full_table} SET {set_sql}{where_sql} RETURNING *'
                cur.execute(sql, set_vals + params)
                colnames = [d[0] for d in cur.description] if cur.description else []
                rows = [_row_to_dict(r, colnames) for r in cur.fetchall()] if colnames else []
                conn.commit()
                return _resp(200, {'data': rows, 'error': None})

            elif op == 'delete':
                if not filters:
                    return _resp(400, {'error': 'delete требует хотя бы один фильтр'})
                clauses, params = _build_where(filters)
                where_sql = ' WHERE ' + ' AND '.join(clauses)
                sql = f'DELETE FROM {full_table}{where_sql} RETURNING *'
                cur.execute(sql, params)
                colnames = [d[0] for d in cur.description] if cur.description else []
                rows = [_row_to_dict(r, colnames) for r in cur.fetchall()] if colnames else []
                conn.commit()
                return _resp(200, {'data': rows, 'error': None})

            else:
                return _resp(400, {'error': f'Неизвестная операция: {op}'})

    except Exception as e:
        return _resp(200, {'data': None, 'error': {'message': str(e)}})