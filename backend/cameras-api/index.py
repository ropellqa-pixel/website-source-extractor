import hashlib
import json
import os
import time
import uuid as uuidlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import psycopg2
import requests

SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')

# Ключи открытой платформы JFTech (облако камер XMeye / iCSee, режим RPS).
# По умолчанию — публичные ключи из официального демо производителя; свои можно задать секретами.
JF_UUID = os.environ.get('JF_APP_UUID') or 'e0534f3240274897821a126be19b6d46'
JF_KEY = os.environ.get('JF_APP_KEY') or '0621ef206a1d4cafbe0c5545c3882ea8'
JF_SECRET = os.environ.get('JF_APP_SECRET') or '90f8bc17be2a425db6068c749dee4f5d'
JF_MOVED = int(os.environ.get('JF_MOVED_CARD') or '2')

TKS_URL = 'https://tks-iot.xmeye.net'
RDS_URL = 'https://rds-viot.bcloud365.net/v2/rtc/device'

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Authorization, X-Session-Id',
    'Access-Control-Max-Age': '86400',
}

MANAGER_ROLES = {'director', 'deputy_director'}


def _resp(status: int, payload: Any) -> Dict[str, Any]:
    return {'statusCode': status, 'headers': {**CORS, 'Content-Type': 'application/json'},
            'body': json.dumps(payload, ensure_ascii=False, default=str)}


def _signature(tm: str) -> str:
    raw = list((JF_UUID + JF_KEY + JF_SECRET + tm).encode())
    swapped = list(raw)
    n = len(swapped)
    for o in range(n):
        keep = swapped[o] if o % JF_MOVED > (n - o) % JF_MOVED else swapped[n - (o + 1)]
        swapped[o] = swapped[n - (o + 1)]
        swapped[n - (o + 1)] = keep
    merged = [0] * (2 * n)
    for o in range(n):
        merged[o] = raw[o]
        merged[2 * n - 1 - o] = swapped[o]
    return hashlib.md5(bytes(merged)).hexdigest()


def _cloud_token(serial: str) -> Optional[str]:
    tm = '000002' + str(int(time.time() * 1000))
    try:
        r = requests.post(f'{TKS_URL}/v2/device/token/{tm}/{_signature(tm)}.rs', json={'sns': [serial]},
                          headers={'uuid': JF_UUID, 'appKey': JF_KEY}, timeout=min(4.0, _budget(1.5)))
        data = r.json()
    except Exception:
        return None
    if data.get('code') != 2000 or not data.get('data'):
        return None
    return data['data'][0].get('token')


def _rds(token: str, path: str, body: Dict[str, Any], timeout: float = 3.5) -> Dict[str, Any]:
    try:
        r = requests.post(f'{RDS_URL}/{path}/{token}', json=body, timeout=timeout,
                          headers={'appKey': JF_KEY, 'uuid': JF_UUID, 'Content-Type': 'application/json; charset=UTF-8'})
        return r.json()
    except Exception:
        return {'code': 2000, 'data': {'Ret': -1, 'RetMsg': 'Камера не ответила вовремя, попробуйте ещё раз'}}


def _camera_token(cur, cam: Dict[str, Any], force: bool = False) -> Optional[str]:
    now = datetime.now(timezone.utc)
    if not force and cam.get('cloud_token') and cam.get('cloud_token_expires') and cam['cloud_token_expires'] > now:
        return cam['cloud_token']
    token = _cloud_token(cam['serial'])
    if token and cam.get('id'):
        cur.execute(f'UPDATE {SCHEMA}.cameras SET cloud_token = %s, cloud_token_expires = %s WHERE id = %s',
                    (token, now + timedelta(hours=12), cam['id']))
    return token


def _expire_ms() -> str:
    return str(int(time.time() * 1000) + 3 * 3600 * 1000)


def _ret_error(data: Dict[str, Any]) -> Optional[str]:
    if data.get('code') != 2000:
        return data.get('msg') or 'Облако камер вернуло ошибку'
    inner = data.get('data') or {}
    ret = inner.get('Ret')
    if ret is not None and ret != 100:
        if ret == 106:
            return 'Неверное имя или пароль камеры'
        if ret == 119:
            return 'За этот период записей нет'
        return inner.get('RetMsg') or f'Камера вернула код {ret}'
    return None


def _with_token(cur, cam: Dict[str, Any], path: str, body: Dict[str, Any]) -> Dict[str, Any]:
    token = _camera_token(cur, cam)
    if not token:
        return {'code': -1, 'msg': 'Камера не найдена в облаке. Проверьте серийный номер и что камера в сети'}
    data = _rds(token, path, body)
    if data.get('code') not in (2000, 4000):
        token = _camera_token(cur, cam, force=True)
        if token:
            data = _rds(token, path, body)
    return data


LIVE_CACHE_MINUTES = 60


_DEADLINE = [0.0]


def _budget(reserve: float = 0.4) -> float:
    """Сколько секунд ещё можно ждать облако, чтобы функция успела ответить до своего лимита."""
    left = _DEADLINE[0] - time.time() - reserve
    return max(1.0, left)


def _fetch_live(cam: Dict[str, Any], token: str, stream: str) -> Dict[str, Any]:
    """Один запрос ссылки к облаку. Ждём столько, сколько позволяет лимит функции."""
    return _rds(token, 'livestream', {
        'mediaType': 'hls', 'protocol': 'ts', 'channel': '0', 'stream': stream,
        'username': cam['username'], 'password': cam['password'], 'expireTime': _expire_ms(),
    }, timeout=_budget())


def _live_url(cur, cam: Dict[str, Any], quality: str, fresh: bool = False) -> Dict[str, Any]:
    """Ссылка на живое видео. Готовая ссылка облака живёт долго, поэтому кэшируем её на 20 минут —
    повторные открытия камеры мгновенные. fresh=True — принудительно новая (если старая перестала играть)."""
    q = 'hd' if quality == 'hd' else 'sd'
    stream = '0' if q == 'hd' else '1'
    cur.execute(f'SELECT live_url_{q}, live_url_{q}_at FROM {SCHEMA}.cameras WHERE id = %s', (cam['id'],))
    row = cur.fetchone()
    now = datetime.now(timezone.utc)
    if not fresh and row and row[0] and row[1] and now - row[1] < timedelta(minutes=LIVE_CACHE_MINUTES):
        return {'url': row[0], 'cached': True}

    token = _camera_token(cur, cam)
    if not token:
        return {'error': 'Камера не найдена в облаке. Проверьте, что камера в сети'}
    data = _fetch_live(cam, token, stream)
    err = _ret_error(data)
    if err:
        # Старая ссылка всё равно лучше, чем ничего: облако часто держит её дольше кэша.
        if row and row[0]:
            return {'url': row[0], 'cached': True}
        return {'error': err}
    url = data['data']['url']
    cur.execute(f'UPDATE {SCHEMA}.cameras SET live_url_{q} = %s, live_url_{q}_at = now() WHERE id = %s', (url, cam['id']))
    return {'url': url}


def _live_all(cur, quality: str) -> Dict[str, Any]:
    """Ссылки сразу для всех камер: из кэша мгновенно, недостающие — параллельно из облака."""
    q = 'hd' if quality == 'hd' else 'sd'
    stream = '0' if q == 'hd' else '1'
    cur.execute(f'SELECT {", ".join(COLS)}, live_url_{q}, live_url_{q}_at FROM {SCHEMA}.cameras ORDER BY order_index, created_at')
    now = datetime.now(timezone.utc)
    result: Dict[str, Any] = {}
    need = []
    for r in cur.fetchall():
        cam = dict(zip(COLS, r[:len(COLS)]))
        url, at = r[len(COLS)], r[len(COLS) + 1]
        if url and at and now - at < timedelta(minutes=LIVE_CACHE_MINUTES):
            result[cam['id']] = {'url': url}
        else:
            need.append((cam, url))

    if need:
        nowt = datetime.now(timezone.utc)
        tokens: Dict[str, Optional[str]] = {}
        for cam, _ in need:
            if cam.get('cloud_token') and cam.get('cloud_token_expires') and cam['cloud_token_expires'] > nowt:
                tokens[cam['id']] = cam['cloud_token']

        def work(item):
            cam, old = item
            cached_tok = tokens.get(cam['id'])
            tok = cached_tok or _cloud_token(cam['serial'])
            new_tok = tok if tok and not cached_tok else None
            if not tok:
                return cam['id'], ({'url': old} if old else {'error': 'Камера не в сети'}), None, None
            data = _fetch_live(cam, tok, stream)
            err = _ret_error(data)
            if err:
                return cam['id'], ({'url': old} if old else {'error': err}), None, new_tok
            return cam['id'], {'url': data['data']['url']}, data['data']['url'], new_tok

        with ThreadPoolExecutor(max_workers=len(need)) as ex:
            for cam_id, res, new_url, new_tok in ex.map(work, need):
                result[cam_id] = res
                if new_url:
                    cur.execute(f'UPDATE {SCHEMA}.cameras SET live_url_{q} = %s, live_url_{q}_at = now() WHERE id = %s',
                                (new_url, cam_id))
                if new_tok:
                    cur.execute(f'UPDATE {SCHEMA}.cameras SET cloud_token = %s, cloud_token_expires = %s WHERE id = %s',
                                (new_tok, datetime.now(timezone.utc) + timedelta(hours=12), cam_id))
    return {'streams': result}


def _login(cur, cam: Dict[str, Any]) -> Optional[str]:
    data = _with_token(cur, cam, 'login', {
        'EncryptType': 'DISABLE', 'LoginType': 'DVRIP-Web', 'UserName': cam['username'],
        'PassWord': cam['password'], 'Name': 'generalinfo',
    })
    return _ret_error(data)


def _query_hour(token: str, day: str, hour: int) -> list:
    """Камера отдаёт максимум 64 файла за запрос, поэтому спрашиваем по одному часу."""
    begin, end = f'{day} {hour:02d}:00:00', f'{day} {hour:02d}:59:59'
    try:
        data = _rds(token, 'opdev', {'Name': 'OPFileQuery', 'OPFileQuery': {
            'BeginTime': begin, 'EndTime': end, 'Channel': 0,
            'DriverTypeMask': '0x0000FFFF', 'Event': '*', 'Type': 'h264', 'StreamType': '0x00000000',
        }})
    except Exception:
        return []
    files = (data.get('data') or {}).get('OPFileQuery') or []
    items = [{'start': max(f['BeginTime'], begin), 'end': min(f['EndTime'], end)} for f in files]
    if len(files) >= 64 and items:
        items[-1]['end'] = end
    return items


def _records(cur, cam: Dict[str, Any], day: str, from_hour: int, to_hour: int) -> Dict[str, Any]:
    err = _login(cur, cam)
    if err:
        return {'error': err}
    token = _camera_token(cur, cam)
    hours = list(range(max(0, from_hour), min(23, to_hour) + 1))
    with ThreadPoolExecutor(max_workers=len(hours) or 1) as ex:
        chunks = list(ex.map(lambda h: _query_hour(token, day, h), hours))
    items = sorted((it for ch in chunks for it in ch), key=lambda x: x['start'])
    merged = []
    for it in items:
        if merged and _secs(it['start']) - _secs(merged[-1]['end']) <= 5:
            merged[-1]['end'] = max(merged[-1]['end'], it['end'])
        else:
            merged.append(dict(it))
    return {'records': merged}


def _secs(s: str) -> float:
    return datetime.strptime(s, '%Y-%m-%d %H:%M:%S').timestamp()


def _playback_url(cur, cam: Dict[str, Any], start: str, end: str) -> Dict[str, Any]:
    err = _login(cur, cam)
    if err:
        return {'error': err}
    data = _with_token(cur, cam, 'playbackUrl', {
        'mediaType': 'hls', 'protocol': 'hls', 'channel': 0, 'stream': '0',
        'username': cam['username'], 'password': cam['password'], 'expireTime': _expire_ms(),
        'startTime': start, 'endTime': end,
    })
    err = _ret_error(data)
    if err:
        return {'error': err}
    return {'url': data['data']['url']}


def _auth(cur, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
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
    cur.execute(f'SELECT role FROM {SCHEMA}.profiles WHERE user_id = %s OR lower(email) = lower(%s) '
                f'ORDER BY (user_id = %s) DESC LIMIT 1', (user['id'], user['email'] or '', user['id']))
    prof = cur.fetchone()
    role = 'director' if user['is_admin'] else (prof[0] if prof else 'employee')
    user['can_manage'] = role in MANAGER_ROLES
    return user


COLS = ['id', 'name', 'serial', 'username', 'password', 'network_mode', 'order_index', 'is_default',
        'cloud_token', 'cloud_token_expires']


def _get_camera(cur, cam_id: str) -> Optional[Dict[str, Any]]:
    cur.execute(f'SELECT {", ".join(COLS)} FROM {SCHEMA}.cameras WHERE id = %s', (cam_id,))
    row = cur.fetchone()
    return dict(zip(COLS, row)) if row else None


def _list(cur, can_manage: bool):
    cur.execute(f'SELECT {", ".join(COLS)} FROM {SCHEMA}.cameras ORDER BY order_index, created_at')
    out = []
    for row in cur.fetchall():
        c = dict(zip(COLS, row))
        item = {'id': c['id'], 'name': c['name'], 'order_index': c['order_index'], 'is_default': c['is_default'],
                'network_mode': c['network_mode']}
        if can_manage:
            item['serial'] = c['serial']
            item['username'] = c['username']
        out.append(item)
    return out


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Раздел «Камеры»: список камер компании, живое видео и архив с карты памяти через облако
    производителя (режим RPS, по серийному номеру). Смотреть могут все сотрудники; добавлять,
    удалять, менять порядок и камеру по умолчанию — директор и зам. директора.
    Логины и пароли камер на сайт не отдаются — ссылки на видео выдаёт только сервер.'''
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}
    if event.get('httpMethod') != 'POST':
        return _resp(405, {'error': 'Используйте POST'})

    body = json.loads(event.get('body') or '{}')
    action = body.get('action', 'list')
    try:
        remaining_ms = context.get_remaining_time_in_millis()
    except Exception:
        remaining_ms = 5000
    # Не дольше 4.3 с от начала: даже на «холодном» старте функция успеет ответить.
    _DEADLINE[0] = time.time() + min(remaining_ms or 5000, 4300) / 1000.0

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.autocommit = True
    cur = conn.cursor()
    try:
        user = _auth(cur, event)
        if not user:
            return _resp(401, {'error': 'Требуется вход в систему'})

        if action == 'list':
            return _resp(200, {'cameras': _list(cur, user['can_manage']), 'can_manage': user['can_manage']})

        if action == 'live_all':
            return _resp(200, _live_all(cur, body.get('quality') or 'sd'))

        if action == 'snapshot':
            cam = _get_camera(cur, body.get('id') or '')
            if not cam:
                return _resp(404, {'error': 'Камера не найдена'})
            _login(cur, cam)
            data = _with_token(cur, cam, 'capture', {'Name': 'OPSNAP', 'OPSNAP': {'Channel': 0}})
            err = _ret_error(data)
            return _resp(200, {'error': err} if err else {'url': data['data'].get('image')})

        if action in ('live', 'records', 'playback'):
            cam = _get_camera(cur, body.get('id') or '')
            if not cam:
                return _resp(404, {'error': 'Камера не найдена'})
            if action == 'live':
                return _resp(200, _live_url(cur, cam, body.get('quality') or 'sd', bool(body.get('fresh'))))
            if action == 'records':
                day = body.get('day') or datetime.now().strftime('%Y-%m-%d')
                return _resp(200, _records(cur, cam, day, int(body.get('from_hour', 0)), int(body.get('to_hour', 5))))
            return _resp(200, _playback_url(cur, cam, body.get('start') or '', body.get('end') or ''))

        if not user['can_manage']:
            return _resp(403, {'error': 'Управлять камерами может только директор или зам. директора'})

        if action in ('add', 'update'):
            name = (body.get('name') or '').strip()
            serial = (body.get('serial') or '').strip()
            username = (body.get('username') or '').strip() or 'admin'
            password = body.get('password')
            existing = _get_camera(cur, body.get('id') or '') if action == 'update' else None
            if action == 'update' and not existing:
                return _resp(404, {'error': 'Камера не найдена'})
            if password is None or (action == 'update' and password == ''):
                password = existing['password'] if existing else ''
            if not name or not serial:
                return _resp(400, {'error': 'Укажите название и серийный номер'})

            cur.execute(f'SELECT id FROM {SCHEMA}.cameras WHERE serial = %s AND id <> %s',
                        (serial, existing['id'] if existing else ''))
            if cur.fetchone():
                return _resp(400, {'error': 'Камера с таким серийным номером уже добавлена'})

            if existing and existing['serial'] == serial and existing['username'] == username \
                    and existing['password'] == password:
                cur.execute(f'UPDATE {SCHEMA}.cameras SET name=%s, updated_at=now() WHERE id=%s', (name, existing['id']))
                return _resp(200, {'ok': True, 'id': existing['id'], 'cameras': _list(cur, True)})

            probe = {'id': None, 'serial': serial, 'username': username, 'password': password}
            token = _camera_token(cur, probe)
            if not token:
                return _resp(400, {'error': 'Камера с таким серийным номером не найдена в облаке. Проверьте номер и что камера включена'})
            probe['cloud_token'] = token
            probe['cloud_token_expires'] = datetime.now(timezone.utc) + timedelta(hours=12)
            check = _live_url(cur, probe, 'sd')
            if check.get('error'):
                return _resp(400, {'error': check['error']})

            if existing:
                cur.execute(f'UPDATE {SCHEMA}.cameras SET name=%s, serial=%s, username=%s, password=%s, '
                            f'cloud_token=%s, cloud_token_expires=%s, updated_at=now() WHERE id=%s',
                            (name, serial, username, password, token, probe['cloud_token_expires'], existing['id']))
                cam_id = existing['id']
            else:
                cam_id = str(uuidlib.uuid4())
                cur.execute(f'SELECT COALESCE(MAX(order_index), -1) + 1, COUNT(*) FROM {SCHEMA}.cameras')
                next_order, count = cur.fetchone()
                cur.execute(f'INSERT INTO {SCHEMA}.cameras (id, name, serial, username, password, network_mode, '
                            f'order_index, is_default, cloud_token, cloud_token_expires) '
                            f'VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                            (cam_id, name, serial, username, password, 'RPS', next_order, count == 0, token,
                             probe['cloud_token_expires']))
            return _resp(200, {'ok': True, 'id': cam_id, 'cameras': _list(cur, True)})

        if action == 'delete':
            cur.execute(f'DELETE FROM {SCHEMA}.cameras WHERE id = %s', (body.get('id') or '',))
            cur.execute(f'SELECT COUNT(*) FROM {SCHEMA}.cameras WHERE is_default')
            if cur.fetchone()[0] == 0:
                cur.execute(f'UPDATE {SCHEMA}.cameras SET is_default = TRUE WHERE id = '
                            f'(SELECT id FROM {SCHEMA}.cameras ORDER BY order_index, created_at LIMIT 1)')
            return _resp(200, {'ok': True, 'cameras': _list(cur, True)})

        if action == 'set_default':
            cur.execute(f'UPDATE {SCHEMA}.cameras SET is_default = (id = %s)', (body.get('id') or '',))
            return _resp(200, {'ok': True, 'cameras': _list(cur, True)})

        if action == 'reorder':
            for idx, cam_id in enumerate(body.get('ids') or []):
                cur.execute(f'UPDATE {SCHEMA}.cameras SET order_index = %s WHERE id = %s', (idx, cam_id))
            return _resp(200, {'ok': True, 'cameras': _list(cur, True)})

        return _resp(400, {'error': f'Неизвестное действие: {action}'})
    finally:
        cur.close()
        conn.close()