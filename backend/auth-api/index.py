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


def get_or_create_api_token(cur, user_id: str, label: str = 'Десктоп-приложение') -> str:
    """Постоянный токен для внешних приложений (например, десктоп-клиент на C#).
    В отличие от сессии — не истекает. Один активный токен на пользователя: повторный
    запрос просто возвращает уже выданный, чтобы приложение не теряло доступ при перевходе."""
    cur.execute(
        f'SELECT token FROM {SCHEMA}.api_tokens WHERE user_id = %s AND revoked_at IS NULL '
        f'ORDER BY created_at DESC LIMIT 1',
        (user_id,),
    )
    row = cur.fetchone()
    if row:
        return row[0]
    token = 'anod_' + secrets.token_urlsafe(40)
    cur.execute(
        f'INSERT INTO {SCHEMA}.api_tokens (id, user_id, token, label) VALUES (%s, %s, %s, %s)',
        (str(uuidlib.uuid4()), user_id, token, label),
    )
    return token


def create_device_token(cur, user_id: str, device_code: str) -> str:
    """Отдельный постоянный токен для конкретного устройства (ПК). В отличие от
    get_or_create_api_token — не переиспользуется: у каждого device_code свой токен,
    поэтому отозвать доступ можно ровно одному ПК, не трогая остальные."""
    token = 'anod_' + secrets.token_urlsafe(40)
    cur.execute(
        f'INSERT INTO {SCHEMA}.api_tokens (id, user_id, token, label, device_code) VALUES (%s, %s, %s, %s, %s)',
        (str(uuidlib.uuid4()), user_id, token, f'Устройство {device_code}', device_code),
    )
    return token


def require_session_user(cur, event: Dict[str, Any], body: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    token = body.get('token') or (event.get('headers') or {}).get('X-Authorization', '')
    if token.startswith('Bearer '):
        token = token[7:]
    return get_user_by_token(cur, token) if token else None


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Сервер аутентификации компании: регистрация с хешированием пароля (PBKDF2-SHA256),
    вход по email+паролю, вход по PIN-коду (двухшаговый), проверка сессии по токену, выход.
    Выдаёт и проверяет постоянные API-токены для внешних приложений (десктоп-клиент):
    get_api_token, revoke_api_token, api_verify. Управляет привязкой ПК по 9-значному коду:
    register_device, device_status, list_devices, link_device, revoke_device.'''
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
                # При каждом входе по паролю выдаём (или возвращаем уже выданный) постоянный
                # API-токен — им десктоп-приложение пользователя подключается к серверу напрямую.
                api_token = get_or_create_api_token(cur, row[0])
                conn.commit()
                return _resp(200, {'user': {'id': row[0], 'email': email}, 'token': token, 'is_admin': row[2], 'api_token': api_token})

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

            elif action == 'get_api_token':
                # Показать постоянный токен текущему вошедшему пользователю (для настройки
                # десктоп-приложения). Требует действующей сессии.
                token = body.get('token') or (event.get('headers') or {}).get('X-Authorization', '')
                if token.startswith('Bearer '):
                    token = token[7:]
                user = get_user_by_token(cur, token) if token else None
                if not user:
                    return _resp(401, {'error': 'Требуется вход в систему'})
                api_token = get_or_create_api_token(cur, user['id'])
                conn.commit()
                return _resp(200, {'api_token': api_token})

            elif action == 'revoke_api_token':
                # Отозвать текущий постоянный токен и сразу выдать новый — используется,
                # если старый токен скомпрометирован (утёк, программа украдена и т.п.).
                token = body.get('token') or (event.get('headers') or {}).get('X-Authorization', '')
                if token.startswith('Bearer '):
                    token = token[7:]
                user = get_user_by_token(cur, token) if token else None
                if not user:
                    return _resp(401, {'error': 'Требуется вход в систему'})
                cur.execute(
                    f'UPDATE {SCHEMA}.api_tokens SET revoked_at = now() WHERE user_id = %s AND revoked_at IS NULL',
                    (user['id'],),
                )
                new_api_token = get_or_create_api_token(cur, user['id'])
                conn.commit()
                return _resp(200, {'api_token': new_api_token})

            elif action == 'register_device':
                # Десктоп-приложение при первом запуске на новом ПК генерирует свой 9-значный
                # код и регистрирует его здесь. Код сразу возвращается программе — она должна
                # один раз показать его пользователю ("в углу экрана"), чтобы директор мог
                # ввести этот же код в личном кабинете и привязать ПК к сотруднику.
                # hostname — необязательная подсказка (имя компьютера) для удобства директора.
                hostname = (body.get('hostname') or '').strip()[:200]
                device_code = None
                for _ in range(50):
                    candidate = f'{secrets.randbelow(1_000_000_000):09d}'
                    cur.execute(f'SELECT 1 FROM {SCHEMA}.devices WHERE device_code = %s', (candidate,))
                    if not cur.fetchone():
                        device_code = candidate
                        break
                if not device_code:
                    return _resp(500, {'error': 'Не удалось сгенерировать код устройства'})
                device_id = str(uuidlib.uuid4())
                cur.execute(
                    f'INSERT INTO {SCHEMA}.devices (id, device_code, hostname, status) VALUES (%s, %s, %s, %s)',
                    (device_id, device_code, hostname, 'pending'),
                )
                conn.commit()
                return _resp(200, {'device_code': device_code})

            elif action == 'device_status':
                # Программа периодически опрашивает этим action-ом: пока код не привязан
                # директором в ЛК — приходит status=pending. После привязки — status=linked
                # и постоянный api_token для этого конкретного устройства.
                device_code = (body.get('device_code') or '').strip()
                if not device_code:
                    return _resp(400, {'error': 'device_code обязателен'})
                cur.execute(
                    f'SELECT status, profile_id FROM {SCHEMA}.devices WHERE device_code = %s',
                    (device_code,),
                )
                row = cur.fetchone()
                if not row:
                    return _resp(404, {'error': 'Устройство не найдено'})
                status, profile_id = row
                if status != 'linked':
                    return _resp(200, {'status': status})
                cur.execute(
                    f'SELECT token FROM {SCHEMA}.api_tokens WHERE device_code = %s AND revoked_at IS NULL '
                    f'ORDER BY created_at DESC LIMIT 1',
                    (device_code,),
                )
                token_row = cur.fetchone()
                cur.execute(f'UPDATE {SCHEMA}.devices SET last_seen_at = now() WHERE device_code = %s', (device_code,))
                conn.commit()
                return _resp(200, {'status': 'linked', 'api_token': token_row[0] if token_row else None})

            elif action == 'list_devices':
                # Список всех устройств компании для личного кабинета — привязанные и ожидающие.
                # Доступно только вошедшему пользователю (директор видит все ПК компании).
                user = require_session_user(cur, event, body)
                if not user:
                    return _resp(401, {'error': 'Требуется вход в систему'})
                cur.execute(
                    f'SELECT d.id, d.device_code, d.hostname, d.status, d.created_at, d.linked_at, '
                    f'd.last_seen_at, d.profile_id, p.full_name '
                    f'FROM {SCHEMA}.devices d LEFT JOIN {SCHEMA}.profiles p ON p.id = d.profile_id '
                    f'ORDER BY d.created_at DESC'
                )
                rows = cur.fetchall()
                devices = [{
                    'id': r[0], 'device_code': r[1], 'hostname': r[2], 'status': r[3],
                    'created_at': r[4], 'linked_at': r[5], 'last_seen_at': r[6],
                    'profile_id': r[7], 'profile_name': r[8],
                } for r in rows]
                return _resp(200, {'devices': devices})

            elif action == 'link_device':
                # Директор в личном кабинете вводит 9-значный код с экрана сотрудника,
                # выбирает, к какому профилю его привязать, и (опционально) сразу задаёт
                # пароль для входа, если у сотрудника ещё нет учётной записи. После привязки
                # устройство получает свой собственный постоянный токен.
                user = require_session_user(cur, event, body)
                if not user:
                    return _resp(401, {'error': 'Требуется вход в систему'})
                device_code = (body.get('device_code') or '').strip()
                profile_id = (body.get('profile_id') or '').strip()
                password = body.get('password') or ''
                if len(device_code) != 9 or not device_code.isdigit():
                    return _resp(400, {'error': 'Код устройства должен содержать 9 цифр'})
                if not profile_id:
                    return _resp(400, {'error': 'Не выбран сотрудник'})

                cur.execute(f'SELECT status FROM {SCHEMA}.devices WHERE device_code = %s', (device_code,))
                device_row = cur.fetchone()
                if not device_row:
                    return _resp(404, {'error': 'Устройство с таким кодом не найдено'})

                cur.execute(f'SELECT user_id, email, full_name FROM {SCHEMA}.profiles WHERE id = %s', (profile_id,))
                profile_row = cur.fetchone()
                if not profile_row:
                    return _resp(404, {'error': 'Сотрудник не найден'})
                target_user_id, profile_email, full_name = profile_row

                if not target_user_id:
                    # У сотрудника ещё нет учётной записи для входа — создаём её прямо тут.
                    if len(password) < 6:
                        return _resp(400, {'error': 'Укажите пароль (не менее 6 символов) для нового сотрудника'})
                    if not profile_email:
                        return _resp(400, {'error': 'У сотрудника не указан email — заполните его в профиле'})
                    cur.execute(f'SELECT id FROM {SCHEMA}.auth_users WHERE email = %s', (profile_email,))
                    existing = cur.fetchone()
                    if existing:
                        target_user_id = existing[0]
                    else:
                        target_user_id = str(uuidlib.uuid4())
                        cur.execute(
                            f'INSERT INTO {SCHEMA}.auth_users (id, email, password_hash, is_admin) VALUES (%s, %s, %s, %s)',
                            (target_user_id, profile_email, hash_password(password), False),
                        )
                    cur.execute(
                        f'UPDATE {SCHEMA}.profiles SET user_id = %s, has_system_access = true WHERE id = %s',
                        (target_user_id, profile_id),
                    )
                elif password:
                    # Учётная запись уже есть, но директор всё равно передал пароль — обновляем его.
                    cur.execute(
                        f'UPDATE {SCHEMA}.auth_users SET password_hash = %s WHERE id = %s',
                        (hash_password(password), target_user_id),
                    )

                device_token = create_device_token(cur, target_user_id, device_code)
                cur.execute(
                    f'UPDATE {SCHEMA}.devices SET status = %s, profile_id = %s, linked_at = now() '
                    f'WHERE device_code = %s',
                    ('linked', profile_id, device_code),
                )
                conn.commit()
                return _resp(200, {'ok': True, 'profile_name': full_name, 'api_token': device_token})

            elif action == 'revoke_device':
                # Отозвать доступ ровно одному ПК — остальные устройства и токены не трогает.
                user = require_session_user(cur, event, body)
                if not user:
                    return _resp(401, {'error': 'Требуется вход в систему'})
                device_code = (body.get('device_code') or '').strip()
                if not device_code:
                    return _resp(400, {'error': 'device_code обязателен'})
                cur.execute(
                    f'UPDATE {SCHEMA}.api_tokens SET revoked_at = now() WHERE device_code = %s AND revoked_at IS NULL',
                    (device_code,),
                )
                cur.execute(f'UPDATE {SCHEMA}.devices SET status = %s WHERE device_code = %s', ('revoked', device_code))
                conn.commit()
                return _resp(200, {'ok': True})

            elif action == 'api_verify':
                # Проверка постоянного API-токена — используется другими backend-функциями
                # (data-api, file-upload) для авторизации запросов от десктоп-приложения.
                api_token = body.get('api_token') or ''
                if not api_token:
                    return _resp(200, {'user': None})
                cur.execute(
                    f'SELECT u.id, u.email, u.is_admin FROM {SCHEMA}.api_tokens t '
                    f'JOIN {SCHEMA}.auth_users u ON u.id = t.user_id '
                    f'WHERE t.token = %s AND t.revoked_at IS NULL',
                    (api_token,),
                )
                row = cur.fetchone()
                if not row:
                    return _resp(200, {'user': None})
                cur.execute(f'UPDATE {SCHEMA}.api_tokens SET last_used_at = now() WHERE token = %s', (api_token,))
                conn.commit()
                return _resp(200, {'user': {'id': row[0], 'email': row[1], 'is_admin': row[2]}})

            else:
                return _resp(400, {'error': f'Неизвестное действие: {action}'})
    finally:
        conn.close()