import base64
import hashlib
import json
import os
from typing import Any, Dict, List

import psycopg2
from cryptography.fernet import Fernet, InvalidToken

KEY_HASH = '53785dc61a468496ff2396ceb33369115892bc964b31a787041951b49600690f'
SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')
CORS = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}
PAGE = 400


def _resp(status: int, payload: Any) -> Dict[str, Any]:
    return {'statusCode': status, 'headers': CORS, 'body': json.dumps(payload, ensure_ascii=False, default=str)}


def _fernet(seed: str) -> Fernet:
    key = hashlib.sha256(('sber-vault-v2:' + seed).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def _q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _schema_info(cur) -> Dict[str, Any]:
    cur.execute("SELECT table_name, column_name, data_type FROM information_schema.columns "
                "WHERE table_schema = %s ORDER BY table_name, ordinal_position", (SCHEMA,))
    cols = [list(r) for r in cur.fetchall()]
    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = %s AND table_type = 'BASE TABLE' ORDER BY 1", (SCHEMA,))
    return {'tables': [r[0] for r in cur.fetchall()], 'columns': cols}


def _table_rows(cur, table: str, offset: int, new_vault: str) -> Dict[str, Any]:
    cur.execute("SELECT column_name, CASE WHEN data_type = 'USER-DEFINED' THEN udt_name "
                "WHEN data_type = 'ARRAY' THEN 'text' ELSE data_type END FROM information_schema.columns "
                "WHERE table_schema = %s AND table_name = %s ORDER BY ordinal_position", (SCHEMA, table))
    cols = cur.fetchall()
    if not cols:
        return {'error': 'нет такой таблицы'}
    cur.execute("SELECT k.column_name FROM information_schema.table_constraints t "
                "JOIN information_schema.key_column_usage k ON k.constraint_name = t.constraint_name AND k.table_schema = t.table_schema "
                "WHERE t.table_schema = %s AND t.table_name = %s AND t.constraint_type = 'PRIMARY KEY' ORDER BY k.ordinal_position",
                (SCHEMA, table))
    pk = [r[0] for r in cur.fetchall()]
    order = ', '.join(_q(c) for c in (pk or [cols[0][0]]))
    select = ', '.join(f'{_q(c)}::text' for c, _ in cols)
    cur.execute(f'SELECT {select} FROM {SCHEMA}.{_q(table)} ORDER BY {order} LIMIT %s OFFSET %s', (PAGE, offset))
    rows = cur.fetchall()

    old_f = new_f = None
    if table == 'sber_vault':
        old_seed = os.environ.get('SBER_VAULT_KEY') or os.environ.get('AWS_SECRET_ACCESS_KEY') or ''
        old_f, new_f = _fernet(old_seed), _fernet(new_vault)
        vi = [c for c, _ in cols].index('value')

    col_list = ', '.join(_q(c) for c, _ in cols)
    out = []
    for r in rows:
        r = list(r)
        if old_f and r[vi] is not None:
            try:
                r[vi] = new_f.encrypt(old_f.decrypt(r[vi].encode())).decode()
            except InvalidToken:
                pass
        vals = []
        for v, (_, typ) in zip(r, cols):
            vals.append('NULL' if v is None else cur.mogrify('%s', (v,)).decode() + '::' + typ)
        out.append(f'INSERT INTO {_q(table)} ({col_list}) VALUES ({", ".join(vals)});')
    return {'sql': out, 'next': offset + PAGE if len(rows) == PAGE else None}


def handler(event: dict, context) -> dict:
    """Временная выгрузка базы АнодБИЗ для переезда на собственный хостинг (только по ключу)."""
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': {**CORS, 'Access-Control-Allow-Headers': 'Content-Type, X-Export-Key'}, 'body': ''}
    headers = {k.lower(): v for k, v in (event.get('headers') or {}).items()}
    if hashlib.sha256(headers.get('x-export-key', '').encode()).hexdigest() != KEY_HASH:
        return _resp(403, {'error': 'Нет доступа'})
    body = json.loads(event.get('body') or '{}')
    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor()
    try:
        action = body.get('action')
        if action == 'schema':
            return _resp(200, _schema_info(cur))
        if action == 'table':
            new_vault = str(body.get('new_vault_key') or '')
            if len(new_vault) < 16:
                return _resp(400, {'error': 'Нужен new_vault_key (SBER_VAULT_KEY из .env, не короче 16 символов)'})
            return _resp(200, _table_rows(cur, str(body.get('table') or ''), int(body.get('offset') or 0), new_vault))
        return _resp(400, {'error': 'action: schema | table'})
    finally:
        cur.close()
        conn.close()
