"""СКУД: срок действия карт сотрудников, уведомления на сайте и в ВК.

Карта сотрудника действует ровно 1 месяц с записи (перезаписи), потом ещё 5 резервных дней;
через 1 месяц + 5 дней карта удаляется из базы (и из контроллера при следующей синхронизации).
Предупреждение начинается за 5 дней до конца месяца и идёт, пока карту не перезапишут
(на сайте — пока пользователь не закроет его крестиком).
"""
import os
import secrets
import json
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

GRACE_DAYS = 5
WARN_DAYS = 5
MSK = timezone(timedelta(hours=3))
ALERT_KINDS = {'forced': 'Дверь склада взломана!', 'held_open': 'Дверь склада оставлена открытой',
               'denied_blocked': 'Попытка пройти по заблокированной карте'}
NOTIFY_ROLES = ('director', 'deputy_director', 'senior_employee')
EXPIRY_ROLES = ('deputy_director', 'senior_employee')


def add_month(d: datetime) -> datetime:
    y, m = d.year + (d.month // 12), d.month % 12 + 1
    for day in (d.day, 30, 29, 28):
        try:
            return d.replace(year=y, month=m, day=day)
        except ValueError:
            continue
    return d + timedelta(days=30)


def card_dates(written_at: datetime) -> Dict[str, datetime]:
    month_end = add_month(written_at)
    return {'expires': month_end, 'removed': month_end + timedelta(days=GRACE_DAYS), 'warn_from': month_end - timedelta(days=WARN_DAYS)}


def _days_left(now: datetime, until: datetime) -> int:
    return max(0, (until.astimezone(MSK).date() - now.astimezone(MSK).date()).days)


def vk_send(cur, schema: str, profile_ids: List[str], text: str) -> int:
    token = os.environ.get('VK_GROUP_TOKEN')
    if not token or not profile_ids:
        return 0
    cur.execute(f"SELECT DISTINCT vk_user_id FROM {schema}.vk_bindings WHERE status = 'confirmed' AND vk_user_id IS NOT NULL "
                f'AND profile_id = ANY(%s)', (list(profile_ids),))
    sent = 0
    for (vk_id,) in cur.fetchall():
        data = urllib.parse.urlencode({'access_token': token, 'v': '5.199', 'user_id': vk_id,
                                       'random_id': secrets.randbelow(2 ** 31), 'message': text[:3500]}).encode()
        try:
            with urllib.request.urlopen('https://api.vk.com/method/messages.send', data=data, timeout=5) as r:
                if 'error' not in json.loads(r.read().decode()):
                    sent += 1
        except Exception:
            continue
    return sent


def _once(cur, schema: str, key: str) -> bool:
    cur.execute(f'INSERT INTO {schema}.skud_vk_sent (key) VALUES (%s) ON CONFLICT DO NOTHING', (key,))
    return cur.rowcount > 0


def settings(cur, schema: str) -> Dict[str, Any]:
    cur.execute(f"SELECT value FROM {schema}.app_settings WHERE key = 'skud_notify'")
    r = cur.fetchone()
    v = (r[0] if r and isinstance(r[0], dict) else json.loads(r[0]) if r and r[0] else {}) or {}
    return {'alarms_to_employees': bool(v.get('alarms_to_employees', False))}


def _profiles(cur, schema: str, roles) -> List[str]:
    cur.execute(f"SELECT id FROM {schema}.profiles WHERE status = 'active' AND role = ANY(%s)", (list(roles),))
    return [r[0] for r in cur.fetchall()]


def alarm(cur, schema: str, kind: str, door: str, name: str, when: datetime, card: str) -> None:
    """Тревога с двери → ВК руководству (и сотрудникам, если включено). Повтор того же события не шлём."""
    title = ALERT_KINDS.get(kind)
    if not title:
        return
    key = f'alarm:{kind}:{card or ""}:{when.astimezone(MSK).strftime("%Y-%m-%d %H:%M")}'
    if not _once(cur, schema, key):
        return
    text = f'⚠ СКУД «{door}»: {title}\n{when.astimezone(MSK).strftime("%d.%m.%Y %H:%M")}'
    if name or card:
        text += f'\nКарта: {name or "не записана"}{f" ({card})" if card else ""}'
    roles = NOTIFY_ROLES + (('employee',) if settings(cur, schema)['alarms_to_employees'] else ())
    vk_send(cur, schema, _profiles(cur, schema, roles), text)


def expiring(cur, schema: str) -> List[Dict[str, Any]]:
    """Карты сотрудников, у которых идёт предупреждение (за 5 дней до конца месяца и 5 резервных дней)."""
    now = datetime.now(timezone.utc)
    cur.execute(f"SELECT c.id, c.card_number, c.profile_id, COALESCE(p.full_name, c.label, 'без имени'), c.written_at "
                f"FROM {schema}.skud_cards c LEFT JOIN {schema}.profiles p ON p.id = c.profile_id "
                f"WHERE c.card_type = 'employee' AND c.status = 'active' AND COALESCE(p.role, 'employee') = 'employee'")
    out = []
    for cid, num, pid, name, written in cur.fetchall():
        d = card_dates(written)
        if now < d['warn_from']:
            continue
        grace = now >= d['expires']
        out.append({'card_id': cid, 'card': num, 'profile_id': pid, 'name': name, 'cycle': written,
                    'expires': d['expires'], 'removed': d['removed'], 'grace': grace,
                    'days': _days_left(now, d['removed'] if grace else d['expires'])})
    return out


def notice_text(x: Dict[str, Any]) -> str:
    if x['grace']:
        return (f"Внимание! Карта СКУД сотрудника {x['name']} работает в резервные дни: через {x['days']} дн. "
                f"она будет удалена! Перезапишите карту!")
    return (f"Внимание! Карта СКУД сотрудника {x['name']}, через {x['days']} дн. перестанет работать! Перезапишите карту! "
            f"После истечения срока действия карты, будет дано {GRACE_DAYS} резервных дней!")


def notices_for(cur, schema: str, user: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Уведомления для шапки сайта: зам. директора и старшему — по всем картам, сотруднику — по своей."""
    items = expiring(cur, schema)
    if user.get('role') not in EXPIRY_ROLES:
        items = [x for x in items if x['profile_id'] and x['profile_id'] == user.get('profile_id')]
    if not items:
        return []
    cur.execute(f'SELECT card_id, cycle FROM {schema}.skud_notice_dismiss WHERE user_id = %s', (user['id'],))
    closed = {(r[0], r[1]) for r in cur.fetchall()}
    return [{'id': f"{x['card_id']}:{x['cycle'].isoformat()}", 'card_id': x['card_id'], 'cycle': x['cycle'].isoformat(),
             'text': notice_text(x), 'grace': x['grace'], 'days': x['days']}
            for x in items if (x['card_id'], x['cycle']) not in closed]


def dismiss(cur, schema: str, user: Dict[str, Any], card_id: str, cycle: str) -> None:
    cur.execute(f'INSERT INTO {schema}.skud_notice_dismiss (user_id, card_id, cycle) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING',
                (user['id'], card_id, cycle))


def daily(cur, schema: str) -> Dict[str, int]:
    """Раз в день (по первому обращению): ВК-напоминания о картах, удаление карт после резервных дней."""
    now = datetime.now(timezone.utc)
    today = now.astimezone(MSK).strftime('%Y-%m-%d')
    sent = removed = 0
    for x in expiring(cur, schema):
        if now >= x['removed']:
            cur.execute(f'DELETE FROM {schema}.skud_cards WHERE id = %s', (x['card_id'],))
            cur.execute(f'UPDATE {schema}.skud_cards SET synced = false')
            removed += 1
            if _once(cur, schema, f"removed:{x['card_id']}:{x['cycle'].isoformat()}"):
                vk_send(cur, schema, _profiles(cur, schema, EXPIRY_ROLES) + ([x['profile_id']] if x['profile_id'] else []),
                        f"Карта СКУД сотрудника {x['name']} ({x['card']}) удалена: прошёл месяц и {GRACE_DAYS} резервных дней. "
                        f"Запишите карту заново.")
            continue
        if not _once(cur, schema, f"expiry:{x['card_id']}:{x['cycle'].isoformat()}:{today}"):
            continue
        targets = _profiles(cur, schema, EXPIRY_ROLES) + ([x['profile_id']] if x['profile_id'] else [])
        sent += vk_send(cur, schema, list(dict.fromkeys(targets)), notice_text(x))
    cur.execute(f"DELETE FROM {schema}.skud_cards WHERE card_type = 'guest' AND valid_to IS NOT NULL AND valid_to < current_date - 1")
    if cur.rowcount:
        cur.execute(f'UPDATE {schema}.skud_cards SET synced = false')
    cur.execute(f"DELETE FROM {schema}.skud_vk_sent WHERE sent_at < now() - interval '60 days'")
    return {'sent': sent, 'removed': removed}


def daily_once(cur, schema: str) -> None:
    today = datetime.now(MSK).strftime('%Y-%m-%d')
    if _once(cur, schema, f'daily:{today}'):
        daily(cur, schema)
