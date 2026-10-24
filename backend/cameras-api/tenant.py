"""Раздельное хранение данных организаций БИЗ.

Каждая организация (кроме основной org-main) получает собственную схему PostgreSQL
вида <MAIN>__o<лицевой счёт> с полной копией структуры рабочих таблиц. Общими
остаются только учётные записи, сессии, токены и реестр лицензий — в схеме
организации они доступны как представления (VIEW) на основную схему.

Файл одинаковый во всех функциях: при правке копируйте его во все папки backend.
"""
import os
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

MAIN = os.environ.get('MAIN_DB_SCHEMA', 'public')
MAIN_ORG = 'org-main'

GLOBAL_TABLES = [
    'auth_users', 'auth_sessions', 'api_tokens', 'login_links', 'login_cards',
    'biz_organizations', 'biz_documents', 'biz_settings', 'biz_audit', 'app_releases',
]
SKIP_TABLES = set(GLOBAL_TABLES) | {'flyway_schema_history', 'schema_migrations'}

DENIED = 'denied'


def _q(name: str) -> str:
    return '"' + name.replace('"', '') + '"'


def token_from(event: Dict[str, Any], body: Optional[Dict[str, Any]] = None) -> str:
    h = event.get('headers') or {}
    t = h.get('X-Authorization') or h.get('x-authorization') or ''
    if not t and body:
        t = body.get('token') or body.get('api_token') or ''
    if not t:
        t = ((event.get('queryStringParameters') or {}).get('token')) or ''
    t = str(t).strip()
    return t[7:].strip() if t.startswith('Bearer ') else t


def org_schema(cur, org_id: str, is_biz_admin: bool = False) -> Optional[str]:
    """Схема данных организации, если её лицензия действует; иначе None (доступ закрыт)."""
    if not org_id or org_id == MAIN_ORG:
        cur.execute(f'SELECT status, license_until FROM {_q(MAIN)}.biz_organizations WHERE id = %s', (MAIN_ORG,))
        r = cur.fetchone()
        if is_biz_admin or not r:
            return MAIN
        ok = r[0] == 'active' and (r[1] is None or r[1] >= date.today())
        return MAIN if ok else None
    cur.execute(f'SELECT status, license_until, data_schema FROM {_q(MAIN)}.biz_organizations WHERE id = %s', (org_id,))
    r = cur.fetchone()
    if not r or not r[2]:
        return None
    if r[0] != 'active' or (r[1] is not None and r[1] < date.today()):
        return None
    return r[2]


def user_by_token(cur, token: str) -> Optional[Tuple[str, str, bool]]:
    if not token:
        return None
    cur.execute(f'SELECT u.id, u.org_id, u.is_biz_admin FROM {_q(MAIN)}.auth_sessions s '
                f'JOIN {_q(MAIN)}.auth_users u ON u.id = s.user_id WHERE s.token = %s AND s.expires_at > now()', (token,))
    r = cur.fetchone()
    if not r:
        cur.execute(f'SELECT u.id, u.org_id, u.is_biz_admin FROM {_q(MAIN)}.api_tokens t '
                    f'JOIN {_q(MAIN)}.auth_users u ON u.id = t.user_id WHERE t.token = %s AND t.revoked_at IS NULL', (token,))
        r = cur.fetchone()
    return (str(r[0]), r[1] or MAIN_ORG, bool(r[2])) if r else None


def resolve(cur, token: str) -> Optional[str]:
    """Схема для запроса с токеном пользователя.
    Возвращает имя схемы; DENIED — пользователь есть, но лицензии нет; None — токен не пользователя."""
    u = user_by_token(cur, token)
    if not u:
        return None
    s = org_schema(cur, u[1], u[2])
    return s if s else DENIED


def user_schema(cur, user_id: str) -> Optional[str]:
    cur.execute(f'SELECT org_id, is_biz_admin FROM {_q(MAIN)}.auth_users WHERE id = %s', (str(user_id),))
    r = cur.fetchone()
    if not r:
        return None
    return org_schema(cur, r[0] or MAIN_ORG, bool(r[1]))


def all_schemas(cur) -> List[str]:
    cur.execute(f"SELECT data_schema FROM {_q(MAIN)}.biz_organizations WHERE data_schema IS NOT NULL "
                f"AND data_schema <> %s AND status = 'active' AND (license_until IS NULL OR license_until >= CURRENT_DATE) "
                f"ORDER BY created_at", (MAIN,))
    return [MAIN] + [r[0] for r in cur.fetchall()]


def find_schema(cur, table: str, column: str, value: Any, extra: str = '') -> Optional[str]:
    """Ищет, в какой схеме (основной или организации) лежит запись — для входов
    без токена пользователя: ключ контроллера, код ПК, PIN, код привязки VK и т.п."""
    for s in all_schemas(cur):
        try:
            cur.execute(f'SELECT 1 FROM {_q(s)}.{_q(table)} WHERE {_q(column)} = %s {extra} LIMIT 1', (value,))
            if cur.fetchone():
                return s
        except Exception:
            cur.connection.rollback() if not cur.connection.autocommit else None
    return None


def schema_name_for(account_no: str) -> str:
    return f'{MAIN}__o{account_no}'[:63]


def _tables(cur, schema: str, kind: str = 'BASE TABLE') -> List[str]:
    cur.execute('SELECT table_name FROM information_schema.tables WHERE table_schema = %s AND table_type = %s', (schema, kind))
    return [r[0] for r in cur.fetchall()]


def sync_schema(cur, schema: str) -> Dict[str, int]:
    """Создаёт/обновляет схему организации по образцу основной: недостающие таблицы
    (LIKE ... INCLUDING ALL), недостающие колонки и представления общих таблиц."""
    if schema == MAIN:
        return {'tables': 0, 'columns': 0, 'views': 0}
    cur.execute('SELECT 1 FROM information_schema.schemata WHERE schema_name = %s', (schema,))
    if not cur.fetchone():
        cur.execute(f'CREATE SCHEMA IF NOT EXISTS {_q(schema)}')
    main_tables = [t for t in _tables(cur, MAIN) if t not in SKIP_TABLES]
    have = set(_tables(cur, schema))
    stats = {'tables': 0, 'columns': 0, 'views': 0}
    for t in main_tables:
        if t not in have:
            cur.execute(f'CREATE TABLE {_q(schema)}.{_q(t)} (LIKE {_q(MAIN)}.{_q(t)} INCLUDING ALL)')
            stats['tables'] += 1
            continue
        cur.execute(
            "SELECT a.attname, format_type(a.atttypid, a.atttypmod), pg_get_expr(d.adbin, d.adrelid), a.attnotnull "
            "FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace "
            "LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum "
            "WHERE n.nspname = %s AND c.relname = %s AND a.attnum > 0 AND NOT a.attisdropped "
            "AND a.attname NOT IN (SELECT column_name FROM information_schema.columns WHERE table_schema = %s AND table_name = %s)",
            (MAIN, t, schema, t))
        for name, typ, default, notnull in cur.fetchall():
            sql = f'ALTER TABLE {_q(schema)}.{_q(t)} ADD COLUMN IF NOT EXISTS {_q(name)} {typ}'
            if default is not None:
                sql += f' DEFAULT {default}'
                if notnull:
                    sql += ' NOT NULL'
            cur.execute(sql)
            stats['columns'] += 1
    views = set(_tables(cur, schema, 'VIEW'))
    main_all = set(_tables(cur, MAIN))
    for t in GLOBAL_TABLES:
        if t in have or t in views or t not in main_all:
            continue
        cur.execute(f'CREATE VIEW {_q(schema)}.{_q(t)} AS SELECT * FROM {_q(MAIN)}.{_q(t)}')
        stats['views'] += 1
    return stats


SEED_COPY = {
    'app_settings': "key IN ('fields', 'shift_hours')",
    'acc_categories': 'NOT archived',
}


def provision(cur, org: Dict[str, Any]) -> str:
    """Готовит отдельное рабочее пространство организации: схема, структура, карточка
    компании, профили её пользователей, базовые справочники."""
    schema = org.get('data_schema') or schema_name_for(org['account_no'])
    sync_schema(cur, schema)
    s = _q(schema)
    cur.execute(f'SELECT 1 FROM {s}.companies WHERE id = %s', ('main',))
    if not cur.fetchone():
        cur.execute(f'INSERT INTO {s}.companies (id, name, inn, ogrn, type) VALUES (%s, %s, %s, %s, %s)',
                    ('main', org.get('name') or '', org.get('inn') or '', org.get('ogrn') or '',
                     'ИП' if org.get('org_type') == 'ИП' else 'ООО'))
    for table, where in SEED_COPY.items():
        cur.execute(f'SELECT count(*) FROM {s}.{_q(table)}')
        if cur.fetchone()[0] == 0:
            cur.execute(f'INSERT INTO {s}.{_q(table)} SELECT * FROM {_q(MAIN)}.{_q(table)} WHERE {where}')
    cur.execute(f'SELECT id, email FROM {_q(MAIN)}.auth_users WHERE org_id = %s', (org['id'],))
    users = cur.fetchall()
    for uid, email in users:
        cur.execute(f'SELECT 1 FROM {s}.profiles WHERE user_id = %s', (uid,))
        if cur.fetchone():
            continue
        cur.execute(f'SELECT * FROM {_q(MAIN)}.profiles WHERE user_id = %s', (uid,))
        row = cur.fetchone()
        if row:
            cols = [d[0] for d in cur.description]
            cur.execute(f'INSERT INTO {s}.profiles ({", ".join(_q(c) for c in cols)}) VALUES ({", ".join(["%s"] * len(cols))})', row)
            cur.execute(f'DELETE FROM {_q(MAIN)}.profiles WHERE user_id = %s', (uid,))
        else:
            import uuid
            cur.execute(f"INSERT INTO {s}.profiles (id, user_id, full_name, email, role, department, status, has_system_access) "
                        f"VALUES (%s, %s, %s, %s, 'director', 'Руководство', 'active', true)",
                        (str(uuid.uuid4()), uid, org.get('owner_name') or org.get('director_name') or '', email))
    cur.execute(f'UPDATE {_q(MAIN)}.biz_organizations SET data_schema = %s, provisioned_at = COALESCE(provisioned_at, now()) WHERE id = %s',
                (schema, org['id']))
    return schema


def sync_all(cur) -> Dict[str, Any]:
    cur.execute(f'SELECT data_schema FROM {_q(MAIN)}.biz_organizations WHERE data_schema IS NOT NULL AND data_schema <> %s', (MAIN,))
    out = {}
    for (schema,) in cur.fetchall():
        out[schema] = sync_schema(cur, schema)
    return out


def find_schema_sql(cur, where_sql: str, table: str, params: tuple) -> Optional[str]:
    for s in all_schemas(cur):
        try:
            cur.execute(f'SELECT 1 FROM {_q(s)}.{_q(table)} WHERE {where_sql} LIMIT 1', params)
            if cur.fetchone():
                return s
        except Exception:
            pass
    return None


def _parse_body(event: Dict[str, Any]) -> Dict[str, Any]:
    import base64
    import json
    raw = event.get('body') or ''
    try:
        if event.get('isBase64Encoded'):
            raw = base64.b64decode(raw).decode('utf-8', 'ignore')
        b = json.loads(raw or '{}')
        return b if isinstance(b, dict) else {}
    except Exception:
        return {}


def _deny(cors: Dict[str, str]) -> Dict[str, Any]:
    import json
    return {'statusCode': 402, 'headers': {**cors, 'Content-Type': 'application/json'},
            'body': json.dumps({'data': None, 'license_blocked': True,
                                'error': 'Заключите лицензионный договор на подписку БИЗ (BIZ). Напишите на do@bizwor.ru',
                                }, ensure_ascii=False)}


_CHECKED: set = set()


def ensure_fresh(cur, schema: str) -> None:
    """Если в основной схеме появились новые таблицы/колонки (после обновления),
    догоняем структуру схемы организации. Проверка — один запрос на процесс."""
    if schema == MAIN or schema in _CHECKED:
        return
    cur.execute("SELECT count(*) FILTER (WHERE c.table_schema = %s), count(*) FILTER (WHERE c.table_schema = %s) "
                "FROM information_schema.columns c JOIN information_schema.tables t "
                "ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE' "
                "WHERE c.table_schema IN (%s, %s) AND c.table_name <> ALL(%s)",
                (MAIN, schema, MAIN, schema, list(SKIP_TABLES)))
    a, b = cur.fetchone()
    if a != b:
        sync_schema(cur, schema)
    _CHECKED.add(schema)


def choose(event: Dict[str, Any], finders=None, soft_actions=(), cors=None, require_user=False):
    """Определяет схему данных для запроса.
    finders(body, event, qs) -> список (table, where_sql, params) для запросов без токена пользователя.
    soft_actions — действия, которые пользователю без лицензии разрешены (проверка сессии, выход).
    Возвращает (schema, None) или (None, ответ_отказа)."""
    import psycopg2
    cors = cors or {'Access-Control-Allow-Origin': '*'}
    if event.get('httpMethod') == 'OPTIONS':
        return MAIN, None
    body = _parse_body(event)
    qs = event.get('queryStringParameters') or {}
    action = body.get('action') or qs.get('action') or ''
    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            token = token_from(event, body)
            u = user_by_token(cur, token) if token else None
            if u:
                s = org_schema(cur, u[1], u[2])
                if s:
                    ensure_fresh(cur, s)
                    return s, None
                if action in soft_actions:
                    cur.execute(f'SELECT data_schema FROM {_q(MAIN)}.biz_organizations WHERE id = %s', (u[1],))
                    r = cur.fetchone()
                    return (r[0] if r and r[0] else MAIN), None
                return None, _deny(cors)
            if require_user:
                import json
                return None, {'statusCode': 401, 'headers': {**cors, 'Content-Type': 'application/json'},
                              'body': json.dumps({'error': 'Нужно войти в систему'}, ensure_ascii=False)}
            for table, where_sql, params in (finders(body, event, qs) if finders else []):
                if params and all(p not in (None, '') for p in params):
                    s = find_schema_sql(cur, where_sql, table, tuple(params))
                    if s:
                        if s != MAIN:
                            cur.execute(f'SELECT 1 FROM {_q(MAIN)}.biz_organizations WHERE data_schema = %s '
                                        f"AND status = 'active' AND (license_until IS NULL OR license_until >= CURRENT_DATE)", (s,))
                            if not cur.fetchone():
                                return None, _deny(cors)
                            ensure_fresh(cur, s)
                        return s, None
            return MAIN, None
    finally:
        conn.close()


def wrap(module_globals: Dict[str, Any], impl, finders=None, soft_actions=(), cors=None, require_user=False):
    """Оборачивает handler функции: перед выполнением подставляет SCHEMA организации."""
    def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
        schema, deny = choose(event, finders, soft_actions, cors, require_user)
        if deny:
            return deny
        module_globals['SCHEMA'] = schema
        try:
            return impl(event, context)
        finally:
            module_globals['SCHEMA'] = MAIN
    handler.__doc__ = impl.__doc__
    return handler


def claim_device(cur, schema: str, device_code: str) -> None:
    """ПК регистрируется до входа (в основной схеме). При привязке директором
    организации переносим запись ПК в схему этой организации."""
    if schema == MAIN or not device_code:
        return
    cur.execute(f'SELECT 1 FROM {_q(schema)}.devices WHERE device_code = %s', (device_code,))
    if cur.fetchone():
        return
    cur.execute(f"SELECT * FROM {_q(MAIN)}.devices WHERE device_code = %s AND status = 'pending'", (device_code,))
    row = cur.fetchone()
    if not row:
        return
    cols = [d[0] for d in cur.description]
    cur.execute(f'INSERT INTO {_q(schema)}.devices ({", ".join(_q(c) for c in cols)}) VALUES ({", ".join(["%s"] * len(cols))})', row)
    cur.execute(f'DELETE FROM {_q(MAIN)}.devices WHERE device_code = %s', (device_code,))
