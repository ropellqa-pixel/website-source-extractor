import hashlib
import json
import os
import secrets
import uuid as uuidlib
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import psycopg2

SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')
SESSION_TTL_DAYS = 30
PBKDF2_ITERATIONS = 150000

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Authorization',
    'Access-Control-Max-Age': '86400',
}


def _resp(status: int, payload: Any) -> Dict[str, Any]:
    return {
        'statusCode': status,
        'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
        'body': json.dumps(payload, ensure_ascii=False, default=str),
    }


def _conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), bytes.fromhex(salt), PBKDF2_ITERATIONS)
    return f'{salt}${dk.hex()}'


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, hex_hash = stored.split('$')
        dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), bytes.fromhex(salt), PBKDF2_ITERATIONS)
        return secrets.compare_digest(dk.hex(), hex_hash)
    except Exception:
        return False


def create_session(cur, user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)
    cur.execute(
        f'INSERT INTO {SCHEMA}.auth_sessions (id, user_id, token, expires_at) VALUES (%s, %s, %s, %s)',
        (str(uuidlib.uuid4()), user_id, token, expires),
    )
    return token


def get_user_by_token(cur, token: str) -> Optional[Dict[str, Any]]:
    cur.execute(
        f'SELECT u.id, u.email, u.is_admin FROM {SCHEMA}.auth_sessions s '
        f'JOIN {SCHEMA}.auth_users u ON u.id = s.user_id '
        f'WHERE s.token = %s AND s.expires_at > now()',
        (token,),
    )
    row = cur.fetchone()
    if not row:
        return None
    return {'id': row[0], 'email': row[1], 'is_admin': row[2]}


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Сервер аутентификации компании: регистрация с хешированием пароля (PBKDF2-SHA256),
    вход по email+паролю, вход по PIN-коду (двухшаговый), проверка сессии по токену, выход.
    Заменяет прежнее хранение паролей открытым текстом в браузере.'''
    method = event.get('httpMethod', 'GET')

    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    try:
        body = json.loads(event.get('body') or '{}') if method == 'POST' else {}
    except Exception:
        return _resp(400, {'error': 'Некорректный JSON'})

    action = body.get('action') or (event.get('queryStringParameters') or {}).get('action')

    conn = _conn()
    try:
        with conn.cursor() as cur:
            if action == 'signup':
                email = (body.get('email') or '').strip().lower()
                password = body.get('password') or ''
                if not email or '@' not in email:
                    return _resp(400, {'error': 'Введите корректный email'})
                if len(password) < 6:
                    return _resp(400, {'error': 'Пароль должен содержать не менее 6 символов'})

                cur.execute(f'SELECT id FROM {SCHEMA}.auth_users WHERE email = %s', (email,))
                if cur.fetchone():
                    return _resp(409, {'error': 'Пользователь с таким email уже существует'})

                cur.execute(f'SELECT count(*) FROM {SCHEMA}.auth_users')
                is_first = cur.fetchone()[0] == 0

                user_id = str(uuidlib.uuid4())
                cur.execute(
                    f'INSERT INTO {SCHEMA}.auth_users (id, email, password_hash, is_admin) VALUES (%s, %s, %s, %s)',
                    (user_id, email, hash_password(password), is_first),
                )
                token = create_session(cur, user_id)
                conn.commit()
                return _resp(200, {'user': {'id': user_id, 'email': email}, 'token': token, 'is_admin': is_first})

            elif action == 'signin':
                email = (body.get('email') or '').strip().lower()
                password = body.get('password') or ''
                cur.execute(f'SELECT id, password_hash, is_admin FROM {SCHEMA}.auth_users WHERE email = %s', (email,))
                row = cur.fetchone()
                if not row or not verify_password(password, row[1]):
                    return _resp(401, {'error': 'Неверный email или пароль'})
                token = create_session(cur, row[0])
                conn.commit()
                return _resp(200, {'user': {'id': row[0], 'email': email}, 'token': token, 'is_admin': row[2]})

            elif action == 'pin_lookup':
                pin = (body.get('pin') or '').strip()
                adpod_slug = (body.get('adpod_slug') or '').strip()
                if len(pin) != 4 or not pin.isdigit():
                    return _resp(400, {'error': 'Пин-код должен содержать 4 цифры'})
                cur.execute(f'SELECT email, adpod_slug FROM {SCHEMA}.pin_codes WHERE pin = %s LIMIT 1', (pin,))
                row = cur.fetchone()
                if not row:
                    return _resp(404, {'error': 'Неверный пин-код'})
                email, pin_adpod_slug = row[0], row[1]
                # Если запрос пришёл с конкретного АдПода — пин-код должен быть привязан именно к нему
                if adpod_slug and pin_adpod_slug and adpod_slug != pin_adpod_slug:
                    return _resp(403, {'error': 'Этот пин-код привязан к другому адресу входа'})
                cur.execute(f'SELECT full_name FROM {SCHEMA}.profiles WHERE email = %s LIMIT 1', (email,))
                prof = cur.fetchone()
                return _resp(200, {'email': email, 'full_name': prof[0] if prof else 'Сотрудник'})

            elif action == 'pin_signin':
                # Прямой вход только по пин-коду (без пароля) — работает СТРОГО на адресных
                # поддоменах (АдПод): пин-код должен быть привязан именно к переданному адресу.
                pin = (body.get('pin') or '').strip()
                adpod_slug = (body.get('adpod_slug') or '').strip()
                if len(pin) != 4 or not pin.isdigit():
                    return _resp(400, {'error': 'Пин-код должен содержать 4 цифры'})
                if not adpod_slug:
                    return _resp(400, {'error': 'Не указан адресный поддомен'})
                cur.execute(f'SELECT email, adpod_slug FROM {SCHEMA}.pin_codes WHERE pin = %s LIMIT 1', (pin,))
                row = cur.fetchone()
                if not row:
                    return _resp(404, {'error': 'Неверный пин-код'})
                email, pin_adpod_slug = row[0], row[1]
                if pin_adpod_slug != adpod_slug:
                    return _resp(403, {'error': 'Этот пин-код привязан к другому адресу входа'})
                cur.execute(f'SELECT id, is_admin FROM {SCHEMA}.auth_users WHERE email = %s LIMIT 1', (email,))
                user_row = cur.fetchone()
                if not user_row:
                    return _resp(404, {'error': 'У сотрудника нет учётной записи для входа. Обратитесь к руководителю.'})
                token = create_session(cur, user_row[0])
                conn.commit()
                return _resp(200, {'user': {'id': user_row[0], 'email': email}, 'token': token, 'is_admin': user_row[1]})

            elif action == 'session':
                token = body.get('token') or (event.get('headers') or {}).get('X-Authorization', '')
                if token.startswith('Bearer '):
                    token = token[7:]
                if not token:
                    return _resp(200, {'user': None})
                user = get_user_by_token(cur, token)
                return _resp(200, {'user': user})

            elif action == 'signout':
                token = body.get('token') or ''
                if token:
                    cur.execute(f'DELETE FROM {SCHEMA}.auth_sessions WHERE token = %s', (token,))
                    conn.commit()
                return _resp(200, {'ok': True})

            elif action == 'get_roles':
                token = body.get('token') or ''
                user = get_user_by_token(cur, token) if token else None
                if not user:
                    return _resp(200, {'roles': []})
                return _resp(200, {'roles': ['admin'] if user['is_admin'] else []})

            else:
                return _resp(400, {'error': f'Неизвестное действие: {action}'})
    finally:
        conn.close()