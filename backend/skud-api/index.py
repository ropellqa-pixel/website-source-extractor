import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import boto3
import psycopg2

from visits import process as process_visits
import recorder
import alerts

SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')
CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Authorization, X-Skud-Key',
    'Access-Control-Max-Age': '86400',
}
MANAGER_ROLES = {'director', 'deputy_director'}
CARD_ROLES = {'director', 'deputy_director', 'senior_employee'}
CARD_ACTIONS = {'master_get', 'master_save', 'master_delete', 'overview', 'cards', 'card_save', 'card_rewrite', 'card_check', 'enroll_start', 'enroll_poll', 'events', 'visits'}
OUTPUTS_DEFAULT = [{'addr': 1, 'name': 'Реле 2'}, {'addr': 2, 'name': 'Выход SW2'}, {'addr': 3, 'name': 'Выход SW3'},
                   {'addr': 4, 'name': 'Выход SW0'}, {'addr': 5, 'name': 'Выход SW1'}]
KINDS = {
    'entry': 'Вход по карте', 'exit': 'Выход по карте', 'exit_button': 'Выход по кнопке',
    'denied': 'Отказ в доступе', 'denied_blocked': 'Заблокированная карта', 'remote_open': 'Открыта с сайта',
    'forced': 'Дверь взломана', 'held_open': 'Дверь не закрыта', 'door_closed': 'Дверь закрыта',
    'power': 'Питание / перезапуск', 'other': 'Событие контроллера',
}
CARD_STATUSES = {'active', 'blocked'}
ROLE_RANK = {'employee': 1, 'senior_employee': 2, 'deputy_director': 3, 'director': 4}
MASTER_ROLES = {'director', 'deputy_director'}


def _expires(ctype: str, role: Optional[str]) -> bool:
    """Ежемесячно продлевать нужно только карты простых сотрудников (и карты без владельца)."""
    return ctype == 'employee' and ROLE_RANK.get(role or 'employee', 1) <= 1


def _check_confirm(cur, user: Dict[str, Any], confirm: str, new_card: str, target_profile: Optional[str]) -> Optional[str]:
    """Каждую запись карты подтверждают своей картой старшего уровня или мастер-картой."""
    c = norm_card(confirm or '')
    if not re.fullmatch(r'\d{3},\d{5}', c):
        return 'Приложите свою карту для подтверждения записи'
    if c == new_card:
        return 'Нельзя подтвердить записью той же карты — приложите свою карту'
    cur.execute(f'SELECT c.card_type, c.status, c.profile_id, p.role, c.written_at FROM {SCHEMA}.skud_cards c '
                f'LEFT JOIN {SCHEMA}.profiles p ON p.id = c.profile_id WHERE c.card_number = %s', (c,))
    r = cur.fetchone()
    if not r or r[1] != 'active':
        return 'Карта подтверждения не найдена в СКУД или заблокирована'
    if r[0] == 'master':
        return None
    if r[0] != 'employee' or not r[2] or r[2] != user.get('profile_id'):
        return 'Подтвердить можно только своей картой или мастер-картой'
    if _expires(r[0], r[3]) and datetime.now(timezone.utc) >= alerts.card_dates(r[4])['expires']:
        return 'Срок вашей карты истёк — подтвердите мастер-картой'
    rank = ROLE_RANK.get(r[3] or 'employee', 1)
    trole = None
    if target_profile:
        cur.execute(f'SELECT role FROM {SCHEMA}.profiles WHERE id = %s', (target_profile,))
        t = cur.fetchone()
        trole = t[0] if t else None
    if rank < 2 or rank <= ROLE_RANK.get(trole or 'employee', 1):
        return 'Нужна карта сотрудника старше по должности или мастер-карта зам. директора'
    return None


def _resp(status: int, payload: Any) -> Dict[str, Any]:
    return {'statusCode': status, 'headers': {**CORS, 'Content-Type': 'application/json'},
            'body': json.dumps(payload, ensure_ascii=False, default=str)}


def norm_card(raw: str) -> str:
    """Номер Em-Marin в едином виде. Настольный USB-считыватель и контроллер могут показывать его
    по-разному: «012,34567», «0001234567» (10 цифр) или HEX. Приводим к «ггг,ннннн» — так
    напечатано на большинстве карт и так одинаково сравниваются карты с сайта и с двери."""
    s = (raw or '').strip().upper().replace(' ', '').replace('.', ',').replace('/', ',')
    m = re.fullmatch(r'(\d{1,3}),(\d{1,5})', s)
    if m:
        return f'{int(m.group(1)):03d},{int(m.group(2)):05d}'
    if re.fullmatch(r'\d{6,10}', s):
        v = int(s)
        return f'{(v >> 16) & 0xFF:03d},{v & 0xFFFF:05d}'
    if re.fullmatch(r'[0-9A-F]{6,12}', s):
        v = int(s, 16)
        return f'{(v >> 16) & 0xFF:03d},{v & 0xFFFF:05d}'
    return s


def _site_user(cur, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
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
    cur.execute(f'SELECT id, role, full_name FROM {SCHEMA}.profiles WHERE user_id = %s OR lower(email) = lower(%s) '
                f'ORDER BY (user_id = %s) DESC LIMIT 1', (row[0], row[1] or '', row[0]))
    prof = cur.fetchone()
    role = 'director' if row[2] else (prof[1] if prof else 'employee')
    return {'id': row[0], 'role': role, 'name': prof[2] if prof else (row[1] or ''), 'profile_id': prof[0] if prof else None,
            'email': row[1] or ''}


def _controller_by_key(cur, event: Dict[str, Any], body: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    headers = event.get('headers') or {}
    key = (headers.get('X-Skud-Key') or headers.get('x-skud-key') or body.get('key') or '').strip()
    if not key:
        return None
    cur.execute(f'SELECT id, name FROM {SCHEMA}.skud_controllers WHERE secret = %s AND active', (key,))
    r = cur.fetchone()
    return {'id': r[0], 'name': r[1]} if r else None


def _parse_time(v: Any) -> datetime:
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v / 1000 if v > 1e11 else v, tz=timezone.utc)
    s = str(v or '').strip().replace('T', ' ').replace('Z', '+00:00')
    for fmt in ('%Y-%m-%d %H:%M:%S%z', '%Y-%m-%d %H:%M:%S.%f%z', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M'):
        try:
            d = datetime.strptime(s, fmt)
            if d.tzinfo is None:
                d = d.replace(tzinfo=timezone(timedelta(hours=3)))
            return d
        except ValueError:
            continue
    return datetime.now(timezone.utc)


def _card_owner(cur, card: str):
    cur.execute(f'SELECT c.profile_id, c.status, COALESCE(p.full_name, c.label), c.card_type FROM {SCHEMA}.skud_cards c '
                f'LEFT JOIN {SCHEMA}.profiles p ON p.id = c.profile_id WHERE c.card_number = %s', (card,))
    return cur.fetchone()


def _save_event(cur, ctrl_id: str, e: Dict[str, Any], source: str = 'controller') -> bool:
    kind = e.get('kind') if e.get('kind') in KINDS else 'other'
    card = norm_card(str(e.get('card') or '')) if e.get('card') else None
    profile_id, name = None, None
    if card:
        owner = _card_owner(cur, card)
        if owner:
            profile_id, name = owner[0], owner[2]
            if owner[1] == 'blocked' and kind in ('denied', 'other'):
                kind = 'denied_blocked'
            if owner[3] == 'guest' and kind in ('entry', 'exit'):
                e = {**e, 'note': 'Гостевая карта' + (f" · {e['note']}" if e.get('note') and 'гост' not in str(e['note']).lower() else '')}
        else:
            cur.execute(f'UPDATE {SCHEMA}.skud_enroll SET card_number = %s, captured_at = now() '
                        f'WHERE id = 1 AND until_at > now()', (card,))
    if e.get('person'):
        name = str(e['person'])[:200]
    granted = e.get('granted')
    if granted is None:
        granted = kind in ('entry', 'exit', 'exit_button', 'remote_open')
    direction = e.get('direction') or ('in' if kind == 'entry' else 'out' if kind in ('exit', 'exit_button') else None)
    cur.execute(
        f'INSERT INTO {SCHEMA}.skud_events (controller_id, event_time, event_code, event_kind, direction, granted, '
        f'card_number, profile_id, person_name, note, source, raw) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) '
        f'ON CONFLICT (controller_id, event_time, event_code, card_number) DO NOTHING',
        (ctrl_id, _parse_time(e.get('time')), e.get('code'), kind, direction, bool(granted), card, profile_id, name,
         (str(e.get('note'))[:300] if e.get('note') else None), source,
         json.dumps(e.get('raw'), ensure_ascii=False)[:2000] if e.get('raw') is not None else None))
    saved = cur.rowcount > 0
    if saved and kind in alerts.ALERT_KINDS:
        cur.execute(f'SELECT name FROM {SCHEMA}.skud_controllers WHERE id = %s', (ctrl_id,))
        d = cur.fetchone()
        alerts.alarm(cur, SCHEMA, kind, d[0] if d else 'Склад', name or '', _parse_time(e.get('time')), card or '')
    return saved


def _schedules(cur) -> List[Dict[str, Any]]:
    cur.execute(f'SELECT id, name, days, time_from, time_to FROM {SCHEMA}.skud_schedules ORDER BY id LIMIT 7')
    return [{'id': r[0], 'name': r[1], 'days': r[2], 'from': r[3], 'to': r[4], 'zone': i} for i, r in enumerate(cur.fetchall())]


def _cards_for_controller(cur) -> List[Dict[str, Any]]:
    zone = {s['id']: s['zone'] for s in _schedules(cur)}
    cur.execute(f'SELECT c.card_number, c.pin_code, c.schedule_id, c.card_type, c.written_at, p.role FROM {SCHEMA}.skud_cards c '
                f'LEFT JOIN {SCHEMA}.profiles p ON p.id = c.profile_id WHERE c.status = %s '
                f'AND (c.valid_from IS NULL OR c.valid_from <= current_date) AND (c.valid_to IS NULL OR c.valid_to >= current_date) '
                f'ORDER BY c.card_number', ('active',))
    now = datetime.now(timezone.utc)
    out = []
    for num, pin, sch, ctype, written, role in cur.fetchall():
        if _expires(ctype, role) and now >= alerts.card_dates(written)['removed']:
            continue
        out.append({'card': num, 'pin': pin or '', 'mask': (1 << zone[sch]) if sch in zone else 0x80, 'guest': ctype == 'guest'})
    return out


def _bridge(cur, ctrl: Dict[str, Any], action: str, body: Dict[str, Any], event: Dict[str, Any]) -> Dict[str, Any]:
    ip = ((event.get('requestContext') or {}).get('identity') or {}).get('sourceIp')
    cur.execute(f'UPDATE {SCHEMA}.skud_controllers SET last_seen_at = now(), last_ip = %s, '
                f'serial = COALESCE(%s, serial), model = COALESCE(%s, model), fw_version = COALESCE(%s, fw_version), '
                f'door_open = COALESCE(%s, door_open) WHERE id = %s',
                (ip, body.get('serial'), body.get('model'), body.get('fw'), body.get('door_open'), ctrl['id']))
    if action == 'bridge_push':
        saved = sum(1 for e in (body.get('events') or [])[:500] if isinstance(e, dict) and _save_event(cur, ctrl['id'], e))
        process_visits(cur, SCHEMA, ctrl['id'])
        return _resp(200, {'ok': True, 'saved': saved})
    if action == 'bridge_poll':
        cur.execute(f"UPDATE {SCHEMA}.skud_commands SET sent_at = now(), done_at = now(), result = 'не выполнена: контроллер был не на связи' "
                    f"WHERE controller_id = %s AND sent_at IS NULL AND operation = 'open_door' AND created_at < now() - interval '60 seconds'",
                    (ctrl['id'],))
        cur.execute(f'SELECT id, operation, payload FROM {SCHEMA}.skud_commands WHERE controller_id = %s AND sent_at IS NULL '
                    f'ORDER BY id LIMIT 20', (ctrl['id'],))
        cmds = [{'id': r[0], 'operation': r[1], 'payload': json.loads(r[2]) if r[2] else None} for r in cur.fetchall()]
        if cmds:
            cur.execute(f'UPDATE {SCHEMA}.skud_commands SET sent_at = now() WHERE id = ANY(%s)', ([c['id'] for c in cmds],))
        cur.execute(f'SELECT count(*) FROM {SCHEMA}.skud_cards WHERE NOT synced')
        dirty = cur.fetchone()[0] > 0
        out = {'commands': cmds, 'cards_changed': dirty}
        if dirty or body.get('want_cards'):
            out['cards'] = _cards_for_controller(cur)
            out['zones'] = _schedules(cur)
        return _resp(200, out)
    if action == 'bridge_ack':
        for c in (body.get('done') or [])[:50]:
            cur.execute(f'UPDATE {SCHEMA}.skud_commands SET done_at = now(), result = %s WHERE id = %s AND controller_id = %s',
                        (str(c.get('result') or 'ok')[:300], c.get('id'), ctrl['id']))
        if body.get('cards_synced'):
            cur.execute(f'UPDATE {SCHEMA}.skud_cards SET synced = true WHERE NOT synced')
        return _resp(200, {'ok': True})
    return _resp(400, {'error': 'Неизвестное действие'})


GATE_FIELDS = 'id, name, gate_host, gate_port, gate_address, open_seconds, emergency_open, antipassback'


def _gate(cur, dev: Dict[str, Any], action: str, body: Dict[str, Any], event: Dict[str, Any]) -> Dict[str, Any]:
    """Программа АБИЗ на ПК склада работает «мостом» к контроллеру Gate по локальной сети (TCP)."""
    cur.execute(f'SELECT {GATE_FIELDS} FROM {SCHEMA}.skud_controllers WHERE active AND recorder_device = %s '
                f'ORDER BY created_at LIMIT 1', (dev['code'],))
    r = cur.fetchone()
    if not r:
        return _resp(200, {'gate': None})
    ctrl = {'id': r[0], 'name': r[1]}
    status = str(body.get('status') or '')[:300] or None
    found = str(body.get('found_host') or '').strip()
    if found and not r[2] and re.fullmatch(r'[0-9.]{7,15}', found):
        cur.execute(f'UPDATE {SCHEMA}.skud_controllers SET gate_host = %s, gate_port = %s WHERE id = %s',
                    (found, int(body.get('found_port') or r[3] or 5000), r[0]))
    cur.execute(f'UPDATE {SCHEMA}.skud_controllers SET gate_status = %s, gate_seen_at = now() WHERE id = %s', (status, r[0]))
    if not body.get('connected'):
        out: Dict[str, Any] = {'ok': True}
    else:
        out = json.loads(_bridge(cur, ctrl, 'bridge_' + action[len('rec_gate_'):], body, event)['body'])
    out['gate'] = {'controller_id': r[0], 'name': r[1], 'host': found if (found and not r[2]) else (r[2] or ''),
                   'port': r[3] or 5000, 'address': r[4] or 1, 'open_tenths': (r[5] or 3) * 10, 'emergency': bool(r[6]),
                   'antipassback': bool(r[7])}
    alerts.daily_once(cur, SCHEMA)
    return _resp(200, out)


def _controllers(cur) -> List[Dict[str, Any]]:
    cur.execute(f'SELECT c.id, c.name, c.serial, c.model, c.camera_id, cam.name, c.open_seconds, c.last_seen_at, '
                f'c.last_ip, c.fw_version, c.door_open, c.secret, c.inside_camera_id, c.pre_seconds, c.post_seconds, '
                f'c.recorder_device, c.recorder_quality, c.recorder_seen_at, c.recorder_status, d.hostname, '
                f'c.gate_host, c.gate_port, c.gate_address, c.gate_status, c.gate_seen_at, c.emergency_open, '
                f'c.antipassback, c.outputs '
                f'FROM {SCHEMA}.skud_controllers c LEFT JOIN {SCHEMA}.devices d ON d.device_code = c.recorder_device '
                f'LEFT JOIN {SCHEMA}.cameras cam ON cam.id = c.camera_id WHERE c.active ORDER BY c.created_at')
    now = datetime.now(timezone.utc)
    out = []
    for r in cur.fetchall():
        out.append({'id': r[0], 'name': r[1], 'serial': r[2], 'model': r[3], 'camera_id': r[4], 'camera_name': r[5],
                    'open_seconds': r[6], 'last_seen_at': r[7], 'online': bool(r[7] and now - r[7] < timedelta(seconds=90)),
                    'last_ip': r[8], 'fw': r[9], 'door_open': r[10], 'key': r[11], 'inside_camera_id': r[12],
                    'pre_seconds': r[13], 'post_seconds': r[14], 'recorder_device': r[15], 'recorder_quality': r[16],
                    'recorder_online': bool(r[17] and now - r[17] < timedelta(seconds=60)), 'recorder_status': r[18],
                    'recorder_host': r[19], 'gate_host': r[20], 'gate_port': r[21], 'gate_address': r[22],
                    'gate_status': r[23], 'gate_online': bool(r[24] and now - r[24] < timedelta(seconds=60)),
                    'emergency_open': r[25], 'antipassback': r[26],
                    'outputs': json.loads(r[27]) if r[27] else OUTPUTS_DEFAULT})
    return out


def _events(cur, body: Dict[str, Any]) -> Dict[str, Any]:
    where, args = ['true'], []
    where.append('(c.active OR c.id IS NULL)')
    msk = timezone(timedelta(hours=3))
    if body.get('date_from'):
        where.append('e.event_time >= %s')
        args.append(datetime.strptime(body['date_from'], '%Y-%m-%d').replace(tzinfo=msk))
    if body.get('date_to'):
        where.append('e.event_time < %s')
        args.append(datetime.strptime(body['date_to'], '%Y-%m-%d').replace(tzinfo=msk) + timedelta(days=1))
    if body.get('profile_id'):
        where.append('e.profile_id = %s')
        args.append(body['profile_id'])
    if body.get('kind') == 'pass':
        where.append("e.event_kind IN ('entry','exit','exit_button','remote_open')")
    elif body.get('kind') == 'alarm':
        where.append("e.event_kind IN ('denied','denied_blocked','forced','held_open')")
    limit = min(int(body.get('limit') or 500), 3000)
    cur.execute(
        f"SELECT e.id, e.event_time, e.event_kind, e.direction, e.granted, e.card_number, e.profile_id, "
        f"COALESCE(p.full_name, e.person_name), p.department, p.role, e.note, e.source, c.name, c.camera_id "
        f"FROM {SCHEMA}.skud_events e LEFT JOIN {SCHEMA}.profiles p ON p.id = e.profile_id "
        f"LEFT JOIN {SCHEMA}.skud_controllers c ON c.id = e.controller_id "
        f"WHERE {' AND '.join(where)} ORDER BY e.event_time DESC, e.id DESC LIMIT {limit}", tuple(args))
    rows = [{'id': r[0], 'time': r[1], 'kind': r[2], 'kind_label': KINDS.get(r[2], r[2]), 'direction': r[3],
             'granted': r[4], 'card': r[5], 'profile_id': r[6], 'name': r[7], 'department': r[8], 'role': r[9],
             'note': r[10], 'source': r[11], 'door': r[12], 'camera_id': r[13]} for r in cur.fetchall()]
    return {'events': rows}


def _visits(cur, body: Dict[str, Any]) -> Dict[str, Any]:
    msk = timezone(timedelta(hours=3))
    where, args = ['c.active'], []
    if body.get('date_from'):
        where.append('v.started_at >= %s')
        args.append(datetime.strptime(body['date_from'], '%Y-%m-%d').replace(tzinfo=msk))
    if body.get('date_to'):
        where.append('v.started_at < %s')
        args.append(datetime.strptime(body['date_to'], '%Y-%m-%d').replace(tzinfo=msk) + timedelta(days=1))
    if body.get('alarm'):
        where.append('v.alarm')
    cur.execute(f"SELECT v.id, v.status, v.started_at, v.ended_at, v.inside, v.entries, v.exits, v.alarm, v.note, c.name "
                f"FROM {SCHEMA}.skud_visits v JOIN {SCHEMA}.skud_controllers c ON c.id = v.controller_id "
                f"WHERE {' AND '.join(where)} ORDER BY v.started_at DESC LIMIT 300", tuple(args))
    visits = [{'id': r[0], 'status': r[1], 'started_at': r[2], 'ended_at': r[3], 'inside': r[4], 'entries': r[5],
               'exits': r[6], 'alarm': r[7], 'note': r[8], 'door': r[9], 'openings': [], 'clips': []} for r in cur.fetchall()]
    if not visits:
        return {'visits': []}
    by_id = {v['id']: v for v in visits}
    ids = list(by_id)
    cur.execute(f'SELECT id, visit_id, opened_at, last_open_at, closed_at, closed_assumed, held, marks, status '
                f'FROM {SCHEMA}.skud_openings WHERE visit_id = ANY(%s) ORDER BY opened_at', (ids,))
    for r in cur.fetchall():
        by_id[r[1]]['openings'].append({'id': r[0], 'opened_at': r[2], 'last_open_at': r[3], 'closed_at': r[4],
                                        'assumed': r[5], 'held': r[6], 'marks': json.loads(r[7] or '[]'), 'status': r[8]})
    cur.execute(f'SELECT k.id, k.visit_id, k.opening_id, k.camera_id, cam.name, k.mode, k.clip_from, k.clip_to, k.status, '
                f'k.url, k.size_bytes, k.error FROM {SCHEMA}.skud_clips k LEFT JOIN {SCHEMA}.cameras cam ON cam.id = k.camera_id '
                f'WHERE k.visit_id = ANY(%s) ORDER BY k.mode, k.clip_from', (ids,))
    for r in cur.fetchall():
        by_id[r[1]]['clips'].append({'id': r[0], 'opening_id': r[2], 'camera_id': r[3], 'camera': r[4], 'mode': r[5],
                                     'from': r[6], 'to': r[7], 'status': r[8], 'url': r[9], 'size': r[10], 'error': r[11]})
    return {'visits': visits}


def _cards(cur) -> List[Dict[str, Any]]:
    cur.execute(f'SELECT c.id, c.card_number, c.profile_id, p.full_name, c.label, c.status, c.valid_from, c.valid_to, '
                f'c.synced, c.created_at, (SELECT max(event_time) FROM {SCHEMA}.skud_events e WHERE e.card_number = c.card_number), '
                f'c.card_type, (c.pin_code IS NOT NULL), c.schedule_id, c.written_at, c.written_by, p.role '
                f'FROM {SCHEMA}.skud_cards c LEFT JOIN {SCHEMA}.profiles p ON p.id = c.profile_id '
                f'ORDER BY c.status, p.full_name NULLS LAST')
    now = datetime.now(timezone.utc)
    out = []
    for r in cur.fetchall():
        x = {'id': r[0], 'card': r[1], 'profile_id': r[2], 'name': r[3], 'label': r[4], 'status': r[5],
             'valid_from': r[6], 'valid_to': r[7], 'synced': r[8], 'created_at': r[9], 'last_used': r[10],
             'card_type': r[11], 'has_pin': r[12], 'schedule_id': r[13], 'written_at': r[14], 'written_by': r[15]}
        if _expires(r[11], r[16]):
            d = alerts.card_dates(r[14])
            x.update({'expires_at': d['expires'], 'removed_at': d['removed'],
                      'expiry_state': 'grace' if now >= d['expires'] else 'warn' if now >= d['warn_from'] else 'ok'})
        out.append(x)
    return out


def _site(cur, user: Dict[str, Any], action: str, body: Dict[str, Any]) -> Dict[str, Any]:
    if user['role'] not in MANAGER_ROLES and not (user['role'] in CARD_ROLES and action in CARD_ACTIONS):
        return _resp(403, {'error': 'Это доступно директору и заместителю директора'})

    if action == 'overview':
        cur.execute(f"SELECT id, full_name, department FROM {SCHEMA}.profiles WHERE status = 'active' ORDER BY full_name")
        emps = [{'id': r[0], 'name': r[1], 'department': r[2]} for r in cur.fetchall()]
        cur.execute(f"SELECT id, name FROM {SCHEMA}.cameras ORDER BY order_index")
        cams = [{'id': r[0], 'name': r[1]} for r in cur.fetchall()]
        ctrls = _controllers(cur)
        if user['role'] not in MANAGER_ROLES:
            ctrls = [{k: v for k, v in c.items() if k not in ('key', 'last_ip', 'gate_host')} for c in ctrls]
        return _resp(200, {'controllers': ctrls, 'cards': _cards(cur), 'employees': emps, 'cameras': cams,
                           'schedules': _schedules(cur), 'notify': alerts.settings(cur, SCHEMA),
                           'is_manager': user['role'] in MANAGER_ROLES})
    if action == 'events':
        return _resp(200, _events(cur, body))
    if action == 'cards':
        return _resp(200, {'cards': _cards(cur)})
    if action == 'visits':
        cur.execute(f'SELECT id FROM {SCHEMA}.skud_controllers WHERE active')
        for (cid,) in cur.fetchall():
            process_visits(cur, SCHEMA, cid)
        return _resp(200, _visits(cur, body))
    if action == 'devices':
        cur.execute(f"SELECT d.device_code, d.hostname, p.full_name, d.heartbeat_at FROM {SCHEMA}.devices d "
                    f"LEFT JOIN {SCHEMA}.profiles p ON p.id = d.profile_id WHERE d.status = 'linked' ORDER BY p.full_name NULLS LAST")
        return _resp(200, {'devices': [{'code': r[0], 'host': r[1], 'name': r[2], 'heartbeat_at': r[3]} for r in cur.fetchall()]})
    if action == 'clip_retry':
        cur.execute(f"UPDATE {SCHEMA}.skud_clips SET status = 'pending', attempts = 0, error = NULL WHERE visit_id = %s "
                    f"AND status IN ('failed', 'missing')", (body.get('visit_id'),))
        return _resp(200, {'ok': True})

    if action == 'card_save':
        card = norm_card(str(body.get('card') or ''))
        if not re.fullmatch(r'\d{3},\d{5}', card):
            return _resp(400, {'error': 'Не похоже на номер карты Em-Marin. Поднесите карту к считывателю ещё раз'})
        cur.execute(f'SELECT id, profile_id FROM {SCHEMA}.skud_cards WHERE card_number = %s', (card,))
        ex = cur.fetchone()
        if ex and ex[0] != body.get('id'):
            cur.execute(f'SELECT full_name FROM {SCHEMA}.profiles WHERE id = %s', (ex[1],))
            p = cur.fetchone()
            return _resp(400, {'error': f'Эта карта уже записана{" на " + p[0] if p else ""}'})
        ctype = 'guest' if body.get('card_type') == 'guest' else 'employee'
        old_num = None
        if body.get('id'):
            cur.execute(f'SELECT card_number, card_type FROM {SCHEMA}.skud_cards WHERE id=%s', (body['id'],))
            o = cur.fetchone()
            if o and o[1] == 'master':
                return _resp(400, {'error': 'Мастер-карту меняют только в профиле зам. директора'})
            old_num = o[0] if o else None
        if not body.get('id') or body.get('rewrite') or old_num != card:
            err = _check_confirm(cur, user, str(body.get('confirm_card') or ''), card, body.get('profile_id') or None)
            if err:
                return _resp(400, {'error': err, 'need_confirm': True})
        if ctype == 'guest' and not body.get('valid_to'):
            return _resp(400, {'error': 'Для гостевой карты укажите, до какого числа она действует'})
        pin = str(body.get('pin') or '').strip()
        if pin and not re.fullmatch(r'\d{6}', pin):
            return _resp(400, {'error': 'Код для клавиатуры — ровно 6 цифр'})
        sch = int(body['schedule_id']) if str(body.get('schedule_id') or '').isdigit() else None
        if user['role'] not in MANAGER_ROLES:
            pin = ''
            body = {**body, 'pin_clear': False}
            sch = None
            if body.get('id'):
                cur.execute(f'SELECT schedule_id FROM {SCHEMA}.skud_cards WHERE id=%s', (body['id'],))
                x = cur.fetchone()
                sch = x[0] if x else None
        vals = (card, body.get('profile_id') or None, (body.get('label') or '')[:100] or None,
                body.get('valid_from') or None, (body.get('valid_to') or None) if ctype == 'guest' else None, ctype, sch)
        if body.get('id'):
            cur.execute(f'SELECT card_number FROM {SCHEMA}.skud_cards WHERE id=%s', (body['id'],))
            old = cur.fetchone()
            rewrite = bool(body.get('rewrite')) or (old and old[0] != card)
            cur.execute(f'UPDATE {SCHEMA}.skud_cards SET card_number=%s, profile_id=%s, label=%s, valid_from=%s, valid_to=%s, '
                        f'card_type=%s, schedule_id=%s, synced=false, updated_at=now()'
                        f'{", written_at=now(), written_by=%s" if rewrite else ""} WHERE id=%s',
                        vals + ((user['name'],) if rewrite else ()) + (body['id'],))
            cid = body['id']
        else:
            cur.execute(f'INSERT INTO {SCHEMA}.skud_cards (card_number, profile_id, label, valid_from, valid_to, card_type, '
                        f'schedule_id, created_by, written_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id',
                        vals + (user['name'], user['name']))
            cid = cur.fetchone()[0]
        if body.get('pin_clear'):
            cur.execute(f'UPDATE {SCHEMA}.skud_cards SET pin_code = NULL WHERE id = %s', (cid,))
        elif pin:
            cur.execute(f'UPDATE {SCHEMA}.skud_cards SET pin_code = %s WHERE id = %s', (pin, cid))
        cur.execute(f'UPDATE {SCHEMA}.skud_enroll SET until_at = NULL, card_number = NULL WHERE id = 1')
        return _resp(200, {'ok': True, 'card': card, 'cards': _cards(cur)})
    if action == 'card_rewrite':
        cur.execute(f'SELECT card_number, profile_id FROM {SCHEMA}.skud_cards WHERE id=%s', (body.get('id'),))
        t = cur.fetchone()
        err = _check_confirm(cur, user, str(body.get('confirm_card') or ''), t[0] if t else '', t[1] if t else None)
        if err:
            return _resp(400, {'error': err, 'need_confirm': True})
        cur.execute(f"UPDATE {SCHEMA}.skud_cards SET written_at = now(), written_by = %s, synced = false, updated_at = now() "
                    f"WHERE id = %s AND card_type = 'employee'", (user['name'], body.get('id')))
        return _resp(200, {'ok': True, 'cards': _cards(cur)})
    if action == 'card_status':
        st = body.get('status')
        if st not in CARD_STATUSES:
            return _resp(400, {'error': 'Неверный статус'})
        cur.execute(f'UPDATE {SCHEMA}.skud_cards SET status=%s, synced=false, updated_at=now() WHERE id=%s', (st, body.get('id')))
        return _resp(200, {'ok': True, 'cards': _cards(cur)})
    if action == 'card_delete':
        cur.execute(f'DELETE FROM {SCHEMA}.skud_cards WHERE id=%s', (body.get('id'),))
        cur.execute(f'UPDATE {SCHEMA}.skud_cards SET synced=false')
        return _resp(200, {'ok': True, 'cards': _cards(cur)})
    if action == 'master_get':
        cur.execute(f"SELECT id, card_number, written_at FROM {SCHEMA}.skud_cards WHERE card_type = 'master' AND profile_id = %s",
                    (user.get('profile_id'),))
        r = cur.fetchone()
        return _resp(200, {'master': {'id': r[0], 'card': r[1], 'written_at': r[2]} if r else None})
    if action in ('master_save', 'master_delete'):
        if user['role'] not in MASTER_ROLES or not user.get('profile_id'):
            return _resp(403, {'error': 'Мастер-карту может добавить только зам. директора'})
        pin = str(body.get('pin') or '').strip()
        cur.execute(f'SELECT 1 FROM {SCHEMA}.pin_codes WHERE lower(email) = lower(%s) AND pin = %s', (user['email'], pin))
        if not pin or not cur.fetchone():
            return _resp(400, {'error': 'Неверный ПИН-код'})
        if action == 'master_delete':
            cur.execute(f"DELETE FROM {SCHEMA}.skud_cards WHERE card_type = 'master' AND profile_id = %s", (user['profile_id'],))
            cur.execute(f'UPDATE {SCHEMA}.skud_cards SET synced=false')
            return _resp(200, {'ok': True, 'master': None})
        card = norm_card(str(body.get('card') or ''))
        if not re.fullmatch(r'\d{3},\d{5}', card):
            return _resp(400, {'error': 'Не похоже на номер карты Em-Marin. Поднесите карту к считывателю ещё раз'})
        cur.execute(f"SELECT id, card_type, profile_id FROM {SCHEMA}.skud_cards WHERE card_number = %s", (card,))
        ex = cur.fetchone()
        if ex and not (ex[1] == 'master' and ex[2] == user['profile_id']):
            return _resp(400, {'error': 'Эта карта уже записана в СКУД на другого человека'})
        cur.execute(f"DELETE FROM {SCHEMA}.skud_cards WHERE card_type = 'master' AND profile_id = %s", (user['profile_id'],))
        cur.execute(f"INSERT INTO {SCHEMA}.skud_cards (card_number, profile_id, label, card_type, created_by, written_by) "
                    f"VALUES (%s, %s, 'Мастер-карта', 'master', %s, %s) RETURNING id, written_at",
                    (card, user['profile_id'], user['name'], user['name']))
        r = cur.fetchone()
        return _resp(200, {'ok': True, 'master': {'id': r[0], 'card': card, 'written_at': r[1]}})

    if action == 'card_check':
        card = norm_card(str(body.get('card') or ''))
        owner = _card_owner(cur, card)
        return _resp(200, {'card': card, 'valid': bool(re.fullmatch(r'\d{3},\d{5}', card)),
                           'owner': owner[2] if owner else None, 'status': owner[1] if owner else None})

    if action == 'enroll_start':
        cur.execute(f"UPDATE {SCHEMA}.skud_enroll SET until_at = now() + interval '2 minutes', card_number = NULL WHERE id = 1")
        return _resp(200, {'ok': True})
    if action == 'enroll_poll':
        cur.execute(f'SELECT card_number, until_at > now() FROM {SCHEMA}.skud_enroll WHERE id = 1')
        r = cur.fetchone()
        return _resp(200, {'card': r[0] if r else None, 'waiting': bool(r and r[1])})

    if action == 'controller_save':
        name = (body.get('name') or 'Склад').strip()[:80]
        secs = max(1, min(int(body.get('open_seconds') or 3), 30))
        pre = max(0, min(int(body.get('pre_seconds') if body.get('pre_seconds') is not None else 10), 120))
        post = max(0, min(int(body.get('post_seconds') if body.get('post_seconds') is not None else 10), 120))
        quality = 'hd' if body.get('recorder_quality') == 'hd' else 'sd'
        g_host = str(body.get('gate_host') or '').strip()[:60] or None
        if g_host and not re.fullmatch(r'\d{1,3}(\.\d{1,3}){3}', g_host):
            return _resp(400, {'error': 'IP-адрес контроллера в виде 192.168.1.50 (или оставьте пустым — найдётся сам)'})
        g_port = max(1, min(int(body.get('gate_port') or 5000), 65535))
        g_addr = max(1, min(int(body.get('gate_address') or 1), 254))
        if body.get('id'):
            cur.execute(f'UPDATE {SCHEMA}.skud_controllers SET gate_host=%s, gate_port=%s, gate_address=%s WHERE id=%s',
                        (g_host, g_port, g_addr, body['id']))
            cur.execute(f'UPDATE {SCHEMA}.skud_controllers SET name=%s, camera_id=%s, open_seconds=%s, inside_camera_id=%s, '
                        f'pre_seconds=%s, post_seconds=%s, recorder_device=%s, recorder_quality=%s WHERE id=%s',
                        (name, body.get('camera_id') or None, secs, body.get('inside_camera_id') or None, pre, post,
                         body.get('recorder_device') or None, quality, body['id']))
            cur.execute(f'INSERT INTO {SCHEMA}.skud_commands (controller_id, operation, payload, created_by) VALUES (%s,%s,%s,%s)',
                        (body['id'], 'set_open_time', json.dumps({'seconds': secs}), user['name']))
        else:
            cur.execute(f'INSERT INTO {SCHEMA}.skud_controllers (name, camera_id, open_seconds, model, inside_camera_id, '
                        f'pre_seconds, post_seconds, recorder_device, recorder_quality) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                        (name, body.get('camera_id') or None, secs, 'Gate-4000-Ethernet', body.get('inside_camera_id') or None,
                         pre, post, body.get('recorder_device') or None, quality))
        return _resp(200, {'ok': True, 'controllers': _controllers(cur)})
    if action == 'open_door':
        cur.execute(f'SELECT last_seen_at FROM {SCHEMA}.skud_controllers WHERE id=%s', (body.get('id'),))
        if not cur.fetchone():
            return _resp(404, {'error': 'Контроллер не найден'})
        cur.execute(f'INSERT INTO {SCHEMA}.skud_commands (controller_id, operation, created_by) VALUES (%s,%s,%s)',
                    (body['id'], 'open_door', user['name']))
        _save_event(cur, body['id'], {'kind': 'remote_open', 'time': datetime.now(timezone.utc).isoformat(),
                                      'person': user['name'], 'note': 'Открыто кнопкой на сайте'}, 'site')
        process_visits(cur, SCHEMA, body['id'])
        return _resp(200, {'ok': True})
    if action == 'schedule_save':
        name = str(body.get('name') or '').strip()[:60]
        days = int(body.get('days') or 0) & 0x7F
        tf, tt = str(body.get('from') or ''), str(body.get('to') or '')
        if not name or not days or not re.fullmatch(r'\d{2}:\d{2}', tf) or not re.fullmatch(r'\d{2}:\d{2}', tt) or tf >= tt:
            return _resp(400, {'error': 'Укажите название, дни недели и время «с» меньше, чем «до»'})
        if body.get('id'):
            cur.execute(f'UPDATE {SCHEMA}.skud_schedules SET name=%s, days=%s, time_from=%s, time_to=%s WHERE id=%s',
                        (name, days, tf, tt, body['id']))
        else:
            if len(_schedules(cur)) >= 7:
                return _resp(400, {'error': 'Контроллер хранит не больше 7 расписаний'})
            cur.execute(f'INSERT INTO {SCHEMA}.skud_schedules (name, days, time_from, time_to) VALUES (%s,%s,%s,%s)', (name, days, tf, tt))
        cur.execute(f'UPDATE {SCHEMA}.skud_cards SET synced=false')
        return _resp(200, {'ok': True, 'schedules': _schedules(cur), 'cards': _cards(cur)})
    if action == 'schedule_delete':
        cur.execute(f'UPDATE {SCHEMA}.skud_cards SET schedule_id = NULL, synced=false WHERE schedule_id = %s', (body.get('id'),))
        cur.execute(f'DELETE FROM {SCHEMA}.skud_schedules WHERE id = %s', (body.get('id'),))
        cur.execute(f'UPDATE {SCHEMA}.skud_cards SET synced=false')
        return _resp(200, {'ok': True, 'schedules': _schedules(cur), 'cards': _cards(cur)})
    if action == 'notify_save':
        v = {'alarms_to_employees': bool(body.get('alarms_to_employees'))}
        cur.execute(f"INSERT INTO {SCHEMA}.app_settings (key, value, updated_by) VALUES ('skud_notify', %s, %s) "
                    f"ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()",
                    (json.dumps(v), user['name']))
        return _resp(200, {'ok': True, 'notify': v})
    if action in ('antipassback', 'outputs_save', 'output'):
        cur.execute(f'SELECT outputs FROM {SCHEMA}.skud_controllers WHERE id=%s', (body.get('id'),))
        row = cur.fetchone()
        if not row:
            return _resp(404, {'error': 'Контроллер не найден'})
        if action == 'antipassback':
            cur.execute(f'UPDATE {SCHEMA}.skud_controllers SET antipassback=%s WHERE id=%s', (bool(body.get('on')), body['id']))
            cur.execute(f'UPDATE {SCHEMA}.skud_cards SET synced=false')
        elif action == 'outputs_save':
            outs = [{'addr': int(o.get('addr')), 'name': str(o.get('name') or '').strip()[:40] or f"Выход {o.get('addr')}"}
                    for o in (body.get('outputs') or []) if str(o.get('addr')) in ('1', '2', '3', '4', '5', '6', '7')]
            cur.execute(f'UPDATE {SCHEMA}.skud_controllers SET outputs=%s WHERE id=%s', (json.dumps(outs, ensure_ascii=False), body['id']))
        else:
            mode = body.get('mode') if body.get('mode') in ('on', 'off', 'pulse') else 'pulse'
            secs = max(1, min(int(body.get('seconds') or 5), 255))
            addr = int(body.get('addr') or 0)
            if not 1 <= addr <= 7:
                return _resp(400, {'error': 'Неверный выход'})
            cur.execute(f'INSERT INTO {SCHEMA}.skud_commands (controller_id, operation, payload, created_by) VALUES (%s,%s,%s,%s)',
                        (body['id'], 'output', json.dumps({'addr': addr, 'mode': mode, 'seconds': secs}), user['name']))
        return _resp(200, {'ok': True, 'controllers': _controllers(cur)})
    if action in ('emergency', 'sync_clock', 'gate_info'):
        cur.execute(f'SELECT id FROM {SCHEMA}.skud_controllers WHERE id=%s', (body.get('id'),))
        if not cur.fetchone():
            return _resp(404, {'error': 'Контроллер не найден'})
        if action == 'emergency':
            on = bool(body.get('on'))
            cur.execute(f'UPDATE {SCHEMA}.skud_controllers SET emergency_open=%s WHERE id=%s', (on, body['id']))
            _save_event(cur, body['id'], {'kind': 'remote_open' if on else 'other', 'time': datetime.now(timezone.utc).isoformat(),
                                          'person': user['name'], 'note': 'Аварийное открытие: дверь открыта постоянно' if on
                                          else 'Аварийное открытие выключено'}, 'site')
            process_visits(cur, SCHEMA, body['id'])
        else:
            cur.execute(f'INSERT INTO {SCHEMA}.skud_commands (controller_id, operation, created_by) VALUES (%s,%s,%s)',
                        (body['id'], action, user['name']))
        return _resp(200, {'ok': True, 'controllers': _controllers(cur)})
    if action == 'sync_cards':
        cur.execute(f'UPDATE {SCHEMA}.skud_cards SET synced=false')
        return _resp(200, {'ok': True})
    return _resp(400, {'error': 'Неизвестное действие'})


def _handler_impl(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''СКУД (дверь склада): журнал проходов, ключ-карты сотрудников (запись, привязка, блокировка,
    удаление), открытие двери с сайта. Контроллер Gate-4000-Ethernet связывается через «мост»
    (программа в локальной сети), который присылает события и забирает карты/команды по ключу X-Skud-Key.'''
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}
    if event.get('httpMethod') != 'POST':
        return _resp(405, {'error': 'Метод не поддерживается'})
    body = json.loads(event.get('body') or '{}')
    action = body.get('action') or ''

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.autocommit = True
    cur = conn.cursor()
    try:
        if action.startswith('bridge_'):
            ctrl = _controller_by_key(cur, event, body)
            if not ctrl:
                return _resp(401, {'error': 'Неверный ключ контроллера'})
            return _bridge(cur, ctrl, action, body, event)
        if action.startswith('rec_'):
            headers = event.get('headers') or {}
            token = (headers.get('X-Authorization') or headers.get('x-authorization') or '').replace('Bearer ', '').strip()
            if action == 'rec_key':
                dev = recorder.device_by_api_token(cur, SCHEMA, token)
                if not dev:
                    return _resp(401, {'error': 'Компьютер не привязан'})
                return _resp(200, recorder.issue_key(cur, SCHEMA, dev))
            dev = recorder.device_by_token(cur, SCHEMA, token)
            if not dev:
                return _resp(401, {'error': 'Компьютер не привязан'})
            if action == 'rec_poll':
                return _resp(200, recorder.poll(cur, SCHEMA, dev, body))
            if action == 'rec_part':
                return _resp(200, recorder.upload_part(body))
            if action == 'rec_done':
                return _resp(200, recorder.done(cur, SCHEMA, body))
            if action.startswith('rec_gate_'):
                return _gate(cur, dev, action, body, event)
            return _resp(400, {'error': 'Неизвестное действие'})
        user = _site_user(cur, event)
        if not user:
            return _resp(401, {'error': 'Нужно войти в систему'})
        if action == 'notices':
            alerts.daily_once(cur, SCHEMA)
            return _resp(200, {'notices': alerts.notices_for(cur, SCHEMA, user)})
        if action == 'notice_dismiss':
            alerts.dismiss(cur, SCHEMA, user, str(body.get('card_id') or ''), str(body.get('cycle') or ''))
            return _resp(200, {'ok': True})
        return _site(cur, user, action, body)
    finally:
        cur.close()
        conn.close()


import tenant as _tenant  # noqa: E402


def _finders(body, event, qs):
    h = event.get('headers') or {}
    t = _tenant.token_from(event, body)
    out = []
    key = (h.get('X-Skud-Key') or h.get('x-skud-key') or body.get('key') or '').strip()
    if str(body.get('action') or '').startswith('bridge_') and key:
        out.append(('skud_controllers', 'secret = %s', [key]))
    if t.startswith('rec_'):
        out.append(('recorder_keys', 'key = %s AND revoked_at IS NULL', [t]))
    return out


_wrapped = _tenant.wrap(globals(), _handler_impl, _finders, ())


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''СКУД (дверь склада): журнал проходов, ключ-карты сотрудников (запись, привязка, блокировка,
    удаление), открытие двери с сайта. Контроллер Gate-4000-Ethernet связывается через «мост»
    (программа в локальной сети), который присылает события и забирает карты/команды по ключу X-Skud-Key.
    Данные каждой организации хранятся отдельно: схема выбирается по токену.'''
    return _wrapped(event, context)
