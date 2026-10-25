import json
import os
import random
import re
import urllib.request
import urllib.parse
import psycopg2
from datetime import timedelta, timezone
from typing import Any, Dict

MSK = timezone(timedelta(hours=3))

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


def _block_card(tok: str, vk_user_id: Any) -> str:
    """Кнопка «Это был не я»: блокирует карту и сообщает руководству в ВК."""
    conn = _db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f'SELECT t.card_number, t.profile_id, t.door, t.event_time, t.used_at, b.vk_user_id '
                        f'FROM {SCHEMA}.skud_block_tokens t LEFT JOIN {SCHEMA}.vk_bindings b ON b.profile_id = t.profile_id '
                        f"AND b.status = 'confirmed' WHERE t.token = %s", (tok,))
            r = cur.fetchone()
            if not r or (r[5] and vk_user_id and int(r[5]) != int(vk_user_id)):
                return 'Кнопка устарела или не ваша. Сообщите руководству.'
            if r[4]:
                return 'Карта уже заблокирована. Руководство уведомлено.'
            cur.execute(f"UPDATE {SCHEMA}.skud_cards SET status = 'blocked', synced = false, updated_at = now() WHERE card_number = %s", (r[0],))
            cur.execute(f'UPDATE {SCHEMA}.skud_block_tokens SET used_at = now() WHERE token = %s', (tok,))
            cur.execute(f'SELECT full_name FROM {SCHEMA}.profiles WHERE id = %s', (r[1],))
            p = cur.fetchone()
            name = p[0] if p else 'сотрудник'
            when = r[3].astimezone(MSK).strftime('%d.%m.%Y %H:%M') if r[3] else ''
            cur.execute(f"SELECT DISTINCT b.vk_user_id FROM {SCHEMA}.vk_bindings b JOIN {SCHEMA}.profiles p ON p.id = b.profile_id "
                        f"WHERE b.status = 'confirmed' AND b.vk_user_id IS NOT NULL AND p.status = 'active' "
                        f"AND p.role IN ('director', 'deputy_director', 'senior_employee')")
            bosses = [x[0] for x in cur.fetchall()]
            conn.commit()
        for vid in bosses:
            reply(vid, f'🚨 СКУД «{r[2]}»: {name} сообщает, что вход {when} по его карте {r[0]} совершил НЕ ОН.\n'
                       f'Карта автоматически заблокирована. Проверьте записи камер и свяжитесь с сотрудником.')
        return 'Карта заблокирована. Руководство уведомлено — свяжитесь с ним немедленно.'
    finally:
        conn.close()


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

    if event_type == 'message_event':
        obj = body.get('object') or {}
        pl = obj.get('payload') or {}
        if isinstance(pl, str):
            try:
                pl = json.loads(pl)
            except Exception:
                pl = {}
        tok = str(pl.get('block') or '') if isinstance(pl, dict) else ''
        if tok:
            answer = _block_card(tok, obj.get('user_id'))
            try:
                vk_call('messages.sendMessageEventAnswer', {
                    'event_id': obj.get('event_id'), 'user_id': obj.get('user_id'), 'peer_id': obj.get('peer_id'),
                    'event_data': json.dumps({'type': 'show_snackbar', 'text': answer[:90]}, ensure_ascii=False)})
            except Exception:
                pass
            if obj.get('user_id'):
                reply(obj['user_id'], answer)
        return {'statusCode': 200, 'headers': plain_headers, 'body': 'ok'}

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
    if body.get('type') == 'message_event':
        pl = (body.get('object') or {}).get('payload') or {}
        if isinstance(pl, str):
            try:
                pl = json.loads(pl)
            except Exception:
                pl = {}
        tok = str(pl.get('block') or '') if isinstance(pl, dict) else ''
        return [('skud_block_tokens', 'token = %s', [tok])] if tok else []
    msg = ((body.get('object') or {}).get('message') or {})
    text = str(msg.get('text') or '').strip()
    return [('vk_bind_codes', "code = %s AND status = 'pending'", [text])] if text else []


_wrapped = _tenant.wrap(globals(), _handler_impl, _finders, ())


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Принимает Callback API сообщества VK: подтверждает адрес сервера и обрабатывает
    входящие сообщения с 6-значным кодом привязки сотрудника к личному кабинету АнодБИЗ.
    Данные каждой организации хранятся отдельно: схема выбирается по токену.'''
    return _wrapped(event, context)
