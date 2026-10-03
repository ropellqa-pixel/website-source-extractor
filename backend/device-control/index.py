import base64
import json
import os
import uuid as uuidlib
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import boto3
import psycopg2

SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Authorization',
    'Access-Control-Max-Age': '86400',
}

# Удалённо управлять компьютерами может только заместитель директора — у него больше всех прав.
CONTROL_ROLES = {'deputy_director'}
# Эти команды кладёт в очередь сайт; ПК их забирает при heartbeat.
ALLOWED_COMMANDS = {'lock', 'unlock', 'message', 'screenshot', 'rudesktop', 'reload', 'logout'}
# Если ПК не присылал heartbeat дольше — считаем его выключенным (не в сети).
OFFLINE_SECONDS = 25


def _resp(status: int, payload: Any) -> Dict[str, Any]:
    return {
        'statusCode': status,
        'headers': {**CORS, 'Content-Type': 'application/json'},
        'body': json.dumps(payload, ensure_ascii=False, default=str),
    }


def _conn():
    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.autocommit = True
    return conn


def _site_user(cur, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Пользователь сайта (по сессии или постоянному токену) + его роль из профиля."""
    headers = event.get('headers') or {}
    token = (headers.get('X-Authorization') or headers.get('x-authorization') or '').replace('Bearer ', '').strip()
    if not token:
        return None
    cur.execute(f'SELECT u.id, u.email, u.is_admin FROM {SCHEMA}.auth_sessions s JOIN {SCHEMA}.auth_users u '
                f'ON u.id = s.user_id WHERE s.token = %s AND s.expires_at > now()', (token,))
    row = cur.fetchone()
    if not row:
        cur.execute(f'SELECT u.id, u.email, u.is_admin FROM {SCHEMA}.api_tokens t JOIN {SCHEMA}.auth_users u '
                    f'ON u.id = t.user_id WHERE t.token = %s AND t.revoked_at IS NULL', (token,))
        row = cur.fetchone()
    if not row:
        return None
    user = {'id': row[0], 'email': row[1], 'is_admin': bool(row[2])}
    cur.execute(f'SELECT id, role, full_name FROM {SCHEMA}.profiles WHERE user_id = %s OR lower(email) = lower(%s) '
                f'ORDER BY (user_id = %s) DESC LIMIT 1', (user['id'], user['email'] or '', user['id']))
    prof = cur.fetchone()
    user['profile_id'] = prof[0] if prof else None
    user['role'] = 'director' if user['is_admin'] else (prof[1] if prof else 'employee')
    user['full_name'] = prof[2] if prof else (user['email'] or '')
    user['can_control'] = user['role'] in CONTROL_ROLES
    return user


def _device_by_token(cur, event: Dict[str, Any], body: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Авторизация самого ПК: по токену устройства находим его device_code."""
    api_token = body.get('api_token') or ''
    if not api_token:
        headers = event.get('headers') or {}
        api_token = (headers.get('X-Authorization') or headers.get('x-authorization') or '').replace('Bearer ', '').strip()
    if not api_token:
        return None
    cur.execute(f'SELECT device_code FROM {SCHEMA}.api_tokens WHERE token = %s AND revoked_at IS NULL', (api_token,))
    row = cur.fetchone()
    if not row or not row[0]:
        return None
    cur.execute(f'SELECT id, device_code, hostname, profile_id, status FROM {SCHEMA}.devices WHERE device_code = %s', (row[0],))
    d = cur.fetchone()
    if not d:
        return None
    return {'id': d[0], 'device_code': d[1], 'hostname': d[2], 'profile_id': d[3], 'status': d[4]}


def _log(cur, device_code: str, kind: str, message: str, actor: str = None):
    cur.execute(
        f'INSERT INTO {SCHEMA}.device_logs (device_code, kind, message, actor_name) VALUES (%s, %s, %s, %s)',
        (device_code, kind, message[:500], actor),
    )


def _upload_screenshot(device_code: str, b64: str) -> Optional[str]:
    try:
        raw = base64.b64decode(b64.split(',')[-1])
    except Exception:
        return None
    if len(raw) > 6_000_000:
        return None
    s3 = boto3.client(
        's3', endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )
    key = f'screenshots/{device_code}/{uuidlib.uuid4().hex}.jpg'
    s3.put_object(Bucket='files', Key=key, Body=raw, ContentType='image/jpeg')
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"


def _presence_row(d) -> Dict[str, Any]:
    heartbeat = d[6]
    presence = d[5] or 'offline'
    if heartbeat is not None:
        age = (datetime.now(timezone.utc) - heartbeat).total_seconds()
        if age > OFFLINE_SECONDS:
            presence = 'offline'
    return {
        'id': d[0], 'device_code': d[1], 'hostname': d[2], 'status': d[3],
        'profile_id': d[4], 'presence': presence, 'heartbeat_at': heartbeat,
        'current_user_name': d[7], 'app_version': d[8], 'remote_lock': d[9],
        'profile_name': d[10], 'screenshot_url': d[11], 'screenshot_at': d[12],
    }


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Удалённое управление компьютерами с АБИЗ. Для сотрудника на ПК: heartbeat (сообщает, что
    он онлайн и где — на экране входа или в системе) и получение команд. Для зама директора на
    сайте: список ПК со статусом, отправка команд (заблокировать/разблокировать/сообщение на весь
    экран/скриншот/запустить RuDesktop), просмотр журнала активности. Управлять может только зам.'''
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}
    if method != 'POST':
        return _resp(405, {'error': 'Используйте POST'})

    try:
        body = json.loads(event.get('body') or '{}')
    except Exception:
        return _resp(400, {'error': 'Некорректный JSON'})

    action = body.get('action', '')
    conn = _conn()
    cur = conn.cursor()
    try:
        # ===== Действия самого ПК (АБИЗ) =====
        if action == 'heartbeat':
            device = _device_by_token(cur, event, body)
            if not device:
                return _resp(401, {'error': 'Устройство не авторизовано', 'revoked': True})
            code = device['device_code']
            presence = body.get('presence') or 'login'  # login | working
            if presence not in ('login', 'working'):
                presence = 'login'
            user_name = (body.get('user_name') or '')[:200]
            app_version = (body.get('app_version') or '')[:50]

            cur.execute(
                f'UPDATE {SCHEMA}.devices SET heartbeat_at = now(), presence = %s, '
                f'current_user_name = %s, app_version = %s, last_seen_at = now() WHERE device_code = %s',
                (presence, user_name, app_version, code),
            )
            # Забираем неотправленные команды
            cur.execute(
                f'SELECT id, command, payload FROM {SCHEMA}.device_commands '
                f'WHERE device_code = %s AND done_at IS NULL ORDER BY created_at LIMIT 10',
                (code,),
            )
            cmds = []
            ids = []
            for cid, command, payload in cur.fetchall():
                cmds.append({'id': cid, 'command': command, 'payload': payload or {}})
                ids.append(cid)
            if ids:
                cur.execute(
                    f'UPDATE {SCHEMA}.device_commands SET delivered_at = now() WHERE id = ANY(%s)', (ids,))
            cur.execute(f'SELECT remote_lock, lock_message FROM {SCHEMA}.devices WHERE device_code = %s', (code,))
            lk = cur.fetchone()
            return _resp(200, {
                'ok': True,
                'commands': cmds,
                'remote_lock': bool(lk[0]) if lk else False,
                'lock_message': (lk[1] if lk else None),
            })

        if action == 'command_result':
            device = _device_by_token(cur, event, body)
            if not device:
                return _resp(401, {'error': 'Устройство не авторизовано'})
            cmd_id = body.get('command_id') or ''
            result = (body.get('result') or '')[:500]
            screenshot = body.get('screenshot')
            extra = {}
            if screenshot:
                url = _upload_screenshot(device['device_code'], screenshot)
                if url:
                    cur.execute(
                        f'UPDATE {SCHEMA}.devices SET screenshot_url = %s, screenshot_at = now() WHERE device_code = %s',
                        (url, device['device_code']))
                    extra['screenshot_url'] = url
            cur.execute(
                f'UPDATE {SCHEMA}.device_commands SET done_at = now(), result = %s WHERE id = %s',
                (result, cmd_id))
            return _resp(200, {'ok': True, **extra})

        if action == 'device_log':
            device = _device_by_token(cur, event, body)
            if not device:
                return _resp(401, {'error': 'Устройство не авторизовано'})
            _log(cur, device['device_code'], (body.get('kind') or 'note')[:30],
                 body.get('message') or '', device.get('hostname'))
            return _resp(200, {'ok': True})

        # ===== Действия сайта (зам директора) =====
        user = _site_user(cur, event)
        if not user:
            return _resp(401, {'error': 'Требуется вход в систему'})

        if action == 'devices_status':
            # Список ПК со статусом видят зам и директор; команды — только зам (см. can_control).
            if user['role'] not in ('deputy_director', 'director'):
                return _resp(403, {'error': 'Недостаточно прав'})
            cur.execute(
                f'SELECT d.id, d.device_code, d.hostname, d.status, d.profile_id, d.presence, d.heartbeat_at, '
                f'd.current_user_name, d.app_version, d.remote_lock, p.full_name, d.screenshot_url, d.screenshot_at '
                f'FROM {SCHEMA}.devices d LEFT JOIN {SCHEMA}.profiles p ON p.id = d.profile_id '
                f'ORDER BY d.created_at DESC')
            devices = [_presence_row(r) for r in cur.fetchall()]
            return _resp(200, {'devices': devices, 'can_control': user['can_control']})

        # Остальные действия меняют ПК — только зам директора
        if not user['can_control']:
            return _resp(403, {'error': 'Удалённое управление доступно только заместителю директора'})

        if action == 'send_command':
            code = (body.get('device_code') or '').strip()
            command = (body.get('command') or '').strip()
            payload = body.get('payload') or {}
            if command not in ALLOWED_COMMANDS:
                return _resp(400, {'error': 'Неизвестная команда'})
            cur.execute(f'SELECT status FROM {SCHEMA}.devices WHERE device_code = %s', (code,))
            if not cur.fetchone():
                return _resp(404, {'error': 'Устройство не найдено'})

            # Блокировка/разблокировка — это стойкое состояние, храним в самой карточке ПК.
            if command == 'lock':
                cur.execute(
                    f'UPDATE {SCHEMA}.devices SET remote_lock = true, lock_message = %s WHERE device_code = %s',
                    ((payload.get('message') or 'Компьютер заблокирован заместителем директора')[:500], code))
            elif command == 'unlock':
                cur.execute(
                    f'UPDATE {SCHEMA}.devices SET remote_lock = false, lock_message = NULL WHERE device_code = %s',
                    (code,))

            cur.execute(
                f'INSERT INTO {SCHEMA}.device_commands (id, device_code, command, payload, created_by, created_by_name) '
                f'VALUES (%s, %s, %s, %s, %s, %s)',
                (str(uuidlib.uuid4()), code, command, json.dumps(payload, ensure_ascii=False),
                 user['profile_id'], user['full_name']))
            labels = {'lock': 'заблокировал ПК', 'unlock': 'разблокировал ПК',
                      'message': 'отправил сообщение на экран', 'screenshot': 'запросил снимок экрана',
                      'rudesktop': 'запустил удалённый доступ', 'reload': 'обновил программу',
                      'logout': 'вышел из системы на ПК'}
            _log(cur, code, 'remote', f"{user['full_name']}: {labels.get(command, command)}", user['full_name'])
            return _resp(200, {'ok': True})

        if action == 'device_logs':
            code = (body.get('device_code') or '').strip()
            limit = min(int(body.get('limit') or 100), 300)
            cur.execute(
                f'SELECT kind, message, actor_name, created_at FROM {SCHEMA}.device_logs '
                f'WHERE device_code = %s ORDER BY created_at DESC LIMIT %s', (code, limit))
            logs = [{'kind': r[0], 'message': r[1], 'actor_name': r[2], 'created_at': r[3]} for r in cur.fetchall()]
            return _resp(200, {'logs': logs})

        return _resp(400, {'error': f'Неизвестное действие: {action}'})
    finally:
        conn.close()
