import json
import os
import random
import re
import urllib.request
import urllib.parse
import psycopg2
from typing import Any, Dict

VK_API = 'https://api.vk.com/method/'
VK_VERSION = '5.199'
CODE_RE = re.compile(r'^\d{6}$')
SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')


def _db_conn():
    return psycopg2.connect(os.environ['DATABASE_URL'])


def vk_call(method: str, params: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(params)
    payload['access_token'] = os.environ['VK_GROUP_TOKEN']
    payload['v'] = VK_VERSION
    data = urllib.parse.urlencode(payload).encode('utf-8')
    req = urllib.request.Request(VK_API + method, data=data, method='POST')
    with urllib.request.urlopen(req, timeout=10) as resp:
        result = json.loads(resp.read().decode('utf-8'))
    return result.get('response')


def reply(user_id: int, text: str) -> None:
    try:
        vk_call('messages.send', {
            'user_id': user_id,
            'message': text,
            'random_id': random.randint(1, 2_147_483_647),
        })
    except Exception:
        pass


def _handler_impl(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Принимает Callback API сообщества VK: подтверждает адрес сервера и обрабатывает
    входящие сообщения с 6-значным кодом привязки сотрудника к личному кабинету АнодБИЗ.'''
    plain_headers = {'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*'}

    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': '86400',
            },
            'body': '',
        }

    try:
        body = json.loads(event.get('body') or '{}')
    except Exception:
        body = {}

    event_type = body.get('type')

    if event_type == 'confirmation':
        return {'statusCode': 200, 'headers': plain_headers, 'body': os.environ.get('VK_CALLBACK_CONFIRMATION', '')}

    if event_type == 'message_new':
        message = (body.get('object') or {}).get('message') or {}
        text = (message.get('text') or '').strip()
        from_id = message.get('from_id')

        if from_id and CODE_RE.match(text):
            conn = _db_conn()
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        f"SELECT profile_id FROM {SCHEMA}.vk_bind_codes "
                        "WHERE code = %s AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
                        (text,),
                    )
                    row = cur.fetchone()
                    if row:
                        profile_id = row[0]
                        cur.execute(f"UPDATE {SCHEMA}.vk_bind_codes SET status = 'confirmed' WHERE code = %s", (text,))
                        cur.execute(
                            f"INSERT INTO {SCHEMA}.vk_bindings (profile_id, vk_user_id, status, message) "
                            "VALUES (%s, %s, 'confirmed', 'Подтверждено ботом VK') "
                            "ON CONFLICT (profile_id) DO UPDATE SET "
                            "vk_user_id = EXCLUDED.vk_user_id, status = 'confirmed', "
                            "message = EXCLUDED.message, updated_at = now()",
                            (profile_id, from_id),
                        )
                        conn.commit()
                        reply(from_id, '✅ Готово! Ваш профиль в АнодБИЗ привязан к VK. Сюда будут приходить табель и расчёт зарплаты.')
                    else:
                        reply(from_id, '⚠️ Код не найден или уже использован. Получите новый код в личном кабинете и отправьте его сюда ещё раз.')
            finally:
                conn.close()
        elif from_id:
            reply(from_id, 'Здравствуйте! Чтобы привязать аккаунт, отправьте сюда 6-значный код из личного кабинета АнодБИЗ (раздел «Сотрудники» → «Привязка VK»).')

    return {'statusCode': 200, 'headers': plain_headers, 'body': 'ok'}


import tenant as _tenant  # noqa: E402


def _finders(body, event, qs):
    msg = ((body.get('object') or {}).get('message') or {})
    text = str(msg.get('text') or '').strip()
    return [('vk_bind_codes', "code = %s AND status = 'pending'", [text])] if text else []


_wrapped = _tenant.wrap(globals(), _handler_impl, _finders, ())


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Принимает Callback API сообщества VK: подтверждает адрес сервера и обрабатывает
    входящие сообщения с 6-значным кодом привязки сотрудника к личному кабинету АнодБИЗ.
    Данные каждой организации хранятся отдельно: схема выбирается по токену.'''
    return _wrapped(event, context)
