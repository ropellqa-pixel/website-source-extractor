import base64
import json
import os
import random
import psycopg2
import requests
from typing import Any, Dict, List, Optional

VK_API = 'https://api.vk.com/method/'
VK_VERSION = '5.199'
SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
    'Access-Control-Max-Age': '86400',
}


def _resp(status: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        'statusCode': status,
        'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
        'body': json.dumps(payload, ensure_ascii=False),
    }


def _db_conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])


def vk_call(method: str, params: Dict[str, Any]) -> Any:
    payload = dict(params)
    payload['access_token'] = os.environ['VK_GROUP_TOKEN']
    payload['v'] = VK_VERSION
    r = requests.post(VK_API + method, data=payload, timeout=15)
    data = r.json()
    if 'error' in data:
        raise RuntimeError(data['error'].get('error_msg', 'Ошибка VK API'))
    return data.get('response')


def generate_code(profile_id: str) -> str:
    conn = _db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"DELETE FROM {SCHEMA}.vk_bind_codes WHERE profile_id = %s AND status = 'pending'",
                (profile_id,),
            )
            code = None
            for _ in range(50):
                candidate = f'{random.randint(0, 999999):06d}'
                cur.execute(f"SELECT 1 FROM {SCHEMA}.vk_bind_codes WHERE code = %s", (candidate,))
                if not cur.fetchone():
                    code = candidate
                    break
            if not code:
                raise RuntimeError('Не удалось сгенерировать код привязки')
            cur.execute(
                f"INSERT INTO {SCHEMA}.vk_bind_codes (profile_id, code, status) VALUES (%s, %s, 'pending')",
                (profile_id, code),
            )
            conn.commit()
        return code
    finally:
        conn.close()


def get_status(profile_id: str) -> Dict[str, Any]:
    conn = _db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT code FROM {SCHEMA}.vk_bind_codes WHERE profile_id = %s AND status = 'pending' "
                "ORDER BY created_at DESC LIMIT 1",
                (profile_id,),
            )
            code_row = cur.fetchone()
            cur.execute(
                f"SELECT vk_user_id, vk_link, status, message FROM {SCHEMA}.vk_bindings WHERE profile_id = %s",
                (profile_id,),
            )
            binding_row = cur.fetchone()
        return {
            'code': code_row[0] if code_row else None,
            'binding': {
                'vk_user_id': binding_row[0],
                'vk_link': binding_row[1],
                'status': binding_row[2],
                'message': binding_row[3],
            } if binding_row else None,
        }
    finally:
        conn.close()


def get_all_bindings() -> List[Dict[str, Any]]:
    conn = _db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT profile_id, vk_user_id FROM {SCHEMA}.vk_bindings "
                "WHERE status = 'confirmed' AND vk_user_id IS NOT NULL"
            )
            rows = cur.fetchall()
        return [{'profile_id': r[0], 'vk_user_id': r[1]} for r in rows]
    finally:
        conn.close()


def get_all_statuses() -> List[Dict[str, Any]]:
    conn = _db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT profile_id, vk_user_id, vk_link, status, message FROM {SCHEMA}.vk_bindings")
            rows = cur.fetchall()
        return [{'profile_id': r[0], 'vk_user_id': r[1], 'vk_link': r[2], 'status': r[3], 'message': r[4]} for r in rows]
    finally:
        conn.close()


def unbind(profile_id: str) -> None:
    conn = _db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"DELETE FROM {SCHEMA}.vk_bindings WHERE profile_id = %s", (profile_id,))
            cur.execute(f"DELETE FROM {SCHEMA}.vk_bind_codes WHERE profile_id = %s", (profile_id,))
            conn.commit()
    finally:
        conn.close()


def upload_photo_attachment(photo_base64: str, peer_id: Optional[int] = None) -> Optional[str]:
    server = vk_call('photos.getMessagesUploadServer', {'peer_id': peer_id} if peer_id else {})
    upload_url = server['upload_url']
    img_bytes = base64.b64decode(photo_base64.split(',')[-1])
    r = requests.post(upload_url, files={'photo': ('tabel.png', img_bytes, 'image/png')}, timeout=20)
    uploaded = r.json()
    saved = vk_call('photos.saveMessagesPhoto', {
        'photo': uploaded['photo'],
        'server': uploaded['server'],
        'hash': uploaded['hash'],
    })
    photo = saved[0]
    return f"photo{photo['owner_id']}_{photo['id']}"


def send_broadcast(items: List[Dict[str, Any]], photo_base64: Optional[str]) -> Dict[str, Any]:
    attachment = None
    photo_error = None
    if photo_base64:
        try:
            first = next((int(i['vk_user_id']) for i in items if i.get('vk_user_id')), None)
            attachment = upload_photo_attachment(photo_base64, first)
        except Exception as e:
            attachment = None
            photo_error = str(e)[:200]

    sent = 0
    failed = 0
    for item in items:
        try:
            params: Dict[str, Any] = {
                'user_id': int(item['vk_user_id']),
                'message': item.get('message', ''),
                'random_id': random.randint(1, 2_147_483_647),
            }
            if attachment:
                params['attachment'] = attachment
            vk_call('messages.send', params)
            sent += 1
        except Exception:
            failed += 1
    return {'sent': sent, 'failed': failed, 'photo_error': photo_error}


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Backend для интеграции с VK: генерация/проверка кода привязки сотрудника,
    отвязка VK и отправка рассылок табеля/зарплаты сообщением ВКонтакте.'''
    method = event.get('httpMethod', 'GET')

    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    try:
        if method == 'GET':
            params = event.get('queryStringParameters') or {}
            action = params.get('action')
            profile_id = params.get('profile_id')

            if action == 'status':
                if not profile_id:
                    return _resp(400, {'error': 'profile_id обязателен'})
                return _resp(200, get_status(profile_id))

            if action == 'bindings_list':
                return _resp(200, {'bindings': get_all_bindings()})

            if action == 'statuses_all':
                return _resp(200, {'bindings': get_all_statuses()})

            return _resp(400, {'error': 'Неизвестное действие'})

        if method == 'POST':
            body = json.loads(event.get('body') or '{}')
            action = body.get('action')

            if action == 'generate_code':
                profile_id = body.get('profile_id')
                if not profile_id:
                    return _resp(400, {'error': 'profile_id обязателен'})
                code = generate_code(profile_id)
                return _resp(200, {'code': code})

            if action == 'unbind':
                profile_id = body.get('profile_id')
                if not profile_id:
                    return _resp(400, {'error': 'profile_id обязателен'})
                unbind(profile_id)
                return _resp(200, {'ok': True})

            if action == 'broadcast':
                items = body.get('items') or []
                if not isinstance(items, list) or not items:
                    return _resp(400, {'error': 'items обязателен и не должен быть пустым'})
                result = send_broadcast(items, body.get('photo_base64'))
                return _resp(200, result)

            return _resp(400, {'error': 'Неизвестное действие'})

        return _resp(405, {'error': 'Метод не поддерживается'})
    except Exception as e:
        return _resp(500, {'error': str(e)})