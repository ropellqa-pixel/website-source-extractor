"""ВК-бот СКУД: постоянные кнопки, открытие двери с телефона, сводки и настройки для руководства."""
import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

MSK = timezone(timedelta(hours=3))
MGMT_DEPARTMENT = 'Руководство'
OPEN_ROLES = ('director', 'deputy_director', 'senior_employee')
SETTINGS_ROLES = ('director', 'deputy_director')
ALERTS = [('forced', 'Взлом двери'), ('held_open', 'Дверь не закрыта'), ('denied_blocked', 'Заблок. карта'),
          ('denied', 'Чужая карта'), ('reader_fault', 'Считыватель'), ('button_stuck', 'Залипла кнопка'),
          ('power', 'Питание контроллера'), ('offline', 'Контроллер молчит'), ('pc_offline', 'ПК/свет выключен'),
          ('restored', 'Связь вернулась'), ('guard', 'Открытие на охране')]
ALERT_DEFAULT = ['forced', 'held_open', 'denied_blocked', 'reader_fault', 'button_stuck', 'power', 'offline', 'pc_offline', 'restored', 'guard']
KIND_RU = {'entry': 'вход по карте', 'exit': 'выход по карте', 'exit_button': 'выход по кнопке', 'denied': 'отказ',
           'denied_blocked': 'заблокированная карта', 'remote_open': 'открыта удалённо', 'forced': 'ВЗЛОМ',
           'held_open': 'дверь не закрыта', 'door_closed': 'дверь закрыта', 'power': 'перезапуск контроллера',
           'reader_fault': 'неисправен считыватель', 'button_stuck': 'залипла кнопка', 'offline': 'контроллер не отвечает',
           'pc_offline': 'ПК склада выключен', 'restored': 'связь восстановлена', 'guard': 'ОТКРЫТИЕ НА ОХРАНЕ', 'other': 'событие'}


def _btn(label: str, cmd: str, color: str = 'secondary', **extra) -> Dict[str, Any]:
    return {'action': {'type': 'text', 'label': label[:40], 'payload': json.dumps({'cmd': cmd, **extra}, ensure_ascii=False)},
            'color': color}


def who(cur, schema: str, vk_id: Any) -> Optional[Dict[str, Any]]:
    cur.execute(f"SELECT p.id, p.full_name, p.role, p.department FROM {schema}.vk_bindings b JOIN {schema}.profiles p "
                f"ON p.id = b.profile_id WHERE b.vk_user_id = %s AND b.status = 'confirmed' AND p.status = 'active' "
                f"ORDER BY CASE p.role WHEN 'director' THEN 1 WHEN 'deputy_director' THEN 2 WHEN 'senior_employee' THEN 3 ELSE 4 END "
                f"LIMIT 1", (int(vk_id),))
    r = cur.fetchone()
    if not r:
        return None
    mgmt = r[3] == MGMT_DEPARTMENT
    return {'id': r[0], 'name': r[1], 'role': r[2], 'can_open': r[2] in OPEN_ROLES or mgmt,
            'can_set': r[2] in SETTINGS_ROLES or mgmt}


def keyboard(u: Optional[Dict[str, Any]]) -> str:
    if not u:
        rows = [[_btn('❓ Как подключиться', 'help', 'primary')]]
    elif u['can_open']:
        rows = [[_btn('🔓 Открыть дверь склада', 'open', 'positive')],
                [_btn('📊 Сводка', 'summary', 'primary'), _btn('👥 Кто на складе', 'inside', 'primary')],
                [_btn('🚨 Тревоги', 'alarms'), _btn('📋 Журнал', 'journal')],
                [_btn('🔌 Связь с дверью', 'link'), _btn('💳 Карты', 'cards')],
                [_btn('🛡 Охрана склада', 'guard', 'negative')]]
        if u['can_set']:
            rows.append([_btn('⚙ Настройки тревог', 'alarm_settings'), _btn('🛠 Управление дверью', 'door_settings')])
        rows.append([_btn('🚶 Мои проходы', 'mine'), _btn('❓ Помощь', 'help')])
    else:
        rows = [[_btn('🚶 Мои проходы', 'mine', 'primary'), _btn('❓ Помощь', 'help')]]
    return json.dumps({'one_time': False, 'buttons': rows}, ensure_ascii=False)


def _inline(rows: List[List[Dict[str, Any]]]) -> str:
    return json.dumps({'inline': True, 'buttons': rows}, ensure_ascii=False)


def _ctrl(cur, schema: str) -> Optional[Dict[str, Any]]:
    cur.execute(f'SELECT id, name, last_seen_at, gate_seen_at, gate_status, emergency_open, open_seconds, timing, recorder_device '
                f'FROM {schema}.skud_controllers WHERE active ORDER BY created_at LIMIT 1')
    r = cur.fetchone()
    if not r:
        return None
    now = datetime.now(timezone.utc)
    return {'id': r[0], 'name': r[1], 'online': bool(r[2] and now - r[2] < timedelta(seconds=90)),
            'pc_online': bool(r[3] and now - r[3] < timedelta(seconds=60)), 'last_seen': r[2], 'pc_seen': r[3],
            'status': r[4] or '', 'emergency': bool(r[5]), 'open_seconds': r[6] or 3,
            'timing': (json.loads(r[7]) if r[7] else {}) or {}, 'pc': r[8]}


def _t(d: Optional[datetime], fmt: str = '%d.%m %H:%M') -> str:
    return d.astimezone(MSK).strftime(fmt) if d else '—'


def _link_text(c: Dict[str, Any]) -> str:
    if not c['pc']:
        return '⚪ Не выбран компьютер склада'
    if c['online']:
        return '🟢 Дверь на связи'
    if c['pc_online']:
        return f"🟡 ПК склада на связи, контроллер — нет ({c['status'] or 'нет ответа'})"
    return f"🔴 ПК склада не на связи (последний раз {_t(c['pc_seen'])})"


def _guard_state(g: Dict[str, Any]) -> bool:
    """То же правило, что на сервере СКУД: ручное включение действует до смены состояния по расписанию."""
    def by_sched(t: datetime) -> bool:
        if not g.get('schedule'):
            return False
        t = t.astimezone(MSK)
        f, to, days, hm = g.get('from', '21:00'), g.get('to', '08:00'), int(g.get('days') or 127), t.strftime('%H:%M')
        if f <= to:
            return bool(days & (1 << t.weekday())) and f <= hm < to
        if hm >= f:
            return bool(days & (1 << t.weekday()))
        return hm < to and bool(days & (1 << ((t.weekday() - 1) % 7)))
    now = datetime.now(timezone.utc)
    sched = by_sched(now)
    if g.get('manual') not in (True, False):
        return sched
    try:
        at = datetime.fromisoformat(str(g.get('manual_at')))
    except ValueError:
        return sched
    if g.get('schedule') and by_sched(at) != sched:
        return sched
    return bool(g['manual'])


def _settings(cur, schema: str) -> Dict[str, Any]:
    cur.execute(f"SELECT value FROM {schema}.app_settings WHERE key = 'skud_notify'")
    r = cur.fetchone()
    v = (r[0] if r and isinstance(r[0], dict) else json.loads(r[0]) if r and r[0] else {}) or {}
    kinds = v.get('kinds') if isinstance(v.get('kinds'), list) else list(ALERT_DEFAULT)
    if 'offline' in kinds and int(v.get('v') or 1) < 2:
        kinds = kinds + [k for k in ('pc_offline', 'restored') if k not in kinds]
    if int(v.get('v') or 1) < 3 and 'guard' not in kinds:
        kinds = kinds + ['guard']
    return {'alarms_to_employees': bool(v.get('alarms_to_employees', False)), 'kinds': kinds, 'v': 3}


def _save_settings(cur, schema: str, v: Dict[str, Any], by: str) -> None:
    cur.execute(f"INSERT INTO {schema}.app_settings (key, value, updated_by) VALUES ('skud_notify', %s, %s) "
                f"ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()",
                (json.dumps(v), by))


def _event(cur, schema: str, c: Dict[str, Any], kind: str, person: str, note: str) -> None:
    cur.execute(f'INSERT INTO {schema}.skud_events (controller_id, event_time, event_kind, granted, person_name, note, source) '
                f"VALUES (%s, now(), %s, %s, %s, %s, 'vk')", (c['id'], kind, kind == 'remote_open', person, note))


def _management_vk(cur, schema: str, except_vk: Any) -> List[int]:
    cur.execute(f"SELECT DISTINCT b.vk_user_id FROM {schema}.vk_bindings b JOIN {schema}.profiles p ON p.id = b.profile_id "
                f"WHERE b.status = 'confirmed' AND b.vk_user_id IS NOT NULL AND p.status = 'active' "
                f"AND (p.role = ANY(%s) OR p.department = %s)", (list(OPEN_ROLES), MGMT_DEPARTMENT))
    return [int(x[0]) for x in cur.fetchall() if int(x[0]) != int(except_vk)]


def _events_text(rows) -> str:
    out = []
    for t, kind, name, card, note, src in rows:
        line = f"{_t(t)} — {KIND_RU.get(kind, kind)}"
        if name or card:
            line += f": {name or 'карта ' + card}"
        if kind in ('remote_open', 'other', 'power', 'offline', 'pc_offline', 'restored', 'guard') and note:
            line += f" ({note[:60]})"
        out.append(line)
    return '\n'.join(out) or 'Событий нет'


def handle(cur, schema: str, vk_id: Any, text: str, payload: Dict[str, Any]) -> Tuple[str, Optional[str], List[Tuple[List[int], str]]]:
    """Ответ на нажатие кнопки. Возвращает (текст, inline-клавиатура или None, рассылки [(vk_ids, текст)])."""
    u = who(cur, schema, vk_id)
    cmd = str(payload.get('cmd') or '')
    if not cmd:
        low = text.lower()
        for word, c in (('открыть', 'open'), ('сводк', 'summary'), ('трево', 'alarms'), ('журнал', 'journal'),
                        ('кто на', 'inside'), ('связь', 'link'), ('мои', 'mine'), ('карты', 'cards'), ('помощ', 'help'),
                        ('меню', 'help'), ('начать', 'help'), ('start', 'help')):
            if word in low:
                cmd = c
                break
    if not u:
        return ('Здравствуйте! Это бот АнодБИЗ. Чтобы пользоваться кнопками, привяжите ВК: в личном кабинете '
                'откройте «Сотрудники» → «Привязка VK» и отправьте сюда 6-значный код.'), None, []
    if cmd in ('help', ''):
        lines = [f"{u['name']}, кнопки внизу работают всегда."]
        if u['can_open']:
            lines.append('🔓 «Открыть дверь склада» — откроет замок через ПК склада (с подтверждением), запись попадёт в журнал.')
            lines.append('📊 Сводка, 👥 кто на складе, 🚨 тревоги, 📋 журнал, 🔌 связь с дверью, 💳 карты.')
            lines.append('🛡 «Охрана склада» — поставить или снять склад с охраны: любое открытие двери на охране — тревога и сирена.')
        if u['can_set']:
            lines.append('⚙ Настройки тревог и 🛠 управление дверью — аварийное открытие, время замка, часы, карты.')
        lines.append('🚶 «Мои проходы» — ваши входы и выходы.')
        return '\n'.join(lines), None, []
    if cmd == 'mine':
        cur.execute(f'SELECT event_time, event_kind, person_name, card_number, note, source FROM {schema}.skud_events '
                    f'WHERE profile_id = %s ORDER BY event_time DESC LIMIT 15', (u['id'],))
        return '🚶 Ваши последние проходы:\n' + _events_text(cur.fetchall()), None, []
    if not u['can_open']:
        return 'Эта кнопка доступна руководству и старшим сотрудникам.', None, []
    c = _ctrl(cur, schema)
    if not c:
        return 'Контроллер двери ещё не добавлен на сайте (раздел СКУД).', None, []

    if cmd == 'open':
        return (f"Открыть дверь «{c['name']}»?\n{_link_text(c)}",
                _inline([[_btn('✅ Да, открыть', 'open_yes', 'positive', t=int(time.time())), _btn('Отмена', 'help')]]), [])
    if cmd == 'open_yes':
        if time.time() - float(payload.get('t') or 0) > 120:
            return 'Подтверждение устарело — нажмите «Открыть дверь склада» ещё раз.', None, []
        cur.execute(f'INSERT INTO {schema}.skud_commands (controller_id, operation, created_by) VALUES (%s, %s, %s)',
                    (c['id'], 'open_door', u['name'] + ' (ВК)'))
        _event(cur, schema, c, 'remote_open', u['name'], 'Открыто из ВК')
        note = ('Команда передана, дверь откроется через 1–2 секунды.' if c['online']
                else f"⚠ Сейчас нет связи с дверью: {_link_text(c)}. Если связь появится в течение минуты — дверь откроется.")
        return (f"🔓 {note}\nЗаписано в журнал.",
                None, [(_management_vk(cur, schema, vk_id), f"🔓 Дверь «{c['name']}» открыта из ВК: {u['name']}, {_t(datetime.now(timezone.utc), '%H:%M:%S')}")])
    if cmd in ('guard', 'guard_on', 'guard_off'):
        cur.execute(f'SELECT guard FROM {schema}.skud_controllers WHERE id = %s', (c['id'],))
        raw = (cur.fetchone() or [None])[0]
        g = json.loads(raw) if raw else {}
        on_now = _guard_state(g)
        if cmd in ('guard_on', 'guard_off'):
            on = cmd == 'guard_on'
            g.update({'manual': on, 'manual_at': datetime.now(timezone.utc).isoformat(), 'by': u['name'] + ' (ВК)'})
            cur.execute(f'UPDATE {schema}.skud_controllers SET guard = %s WHERE id = %s', (json.dumps(g, ensure_ascii=False), c['id']))
            if on != on_now:
                cur.execute(f'INSERT INTO {schema}.skud_events (controller_id, event_time, event_kind, granted, person_name, note, source) '
                            f"VALUES (%s, now(), 'other', false, %s, %s, 'guard')",
                            (c['id'], u['name'], 'Склад поставлен на охрану (ВК)' if on else 'Склад снят с охраны (ВК)'))
            msg = f"{'🛡 Склад «' + c['name'] + '» поставлен на охрану' if on else '🔓 Склад «' + c['name'] + '» снят с охраны'} — {u['name']}"
            return msg + ('\nЛюбое открытие двери — тревога в ВК' + (' и сирена.' if g.get('siren', True) else '.') if on else ''), None, \
                [(_management_vk(cur, schema, vk_id), msg)]
        sched = (f"по расписанию {g.get('from', '21:00')}–{g.get('to', '08:00')}" if g.get('schedule') else 'расписание не задано')
        return (f"🛡 Охрана склада: {'ВКЛЮЧЕНА' if on_now else 'снята'}\nАвтоматически: {sched}"
                + (f"\nПоследний раз вручную: {g.get('by')}" if g.get('by') else ''),
                _inline([[_btn('🛡 Поставить на охрану', 'guard_on', 'negative') if not on_now else _btn('🔓 Снять с охраны', 'guard_off', 'positive')]]), [])
    if cmd == 'link':
        return (f"🔌 {_link_text(c)}\nКонтроллер отвечал: {_t(c['last_seen'], '%d.%m %H:%M:%S')}\n"
                f"ПК склада: {_t(c['pc_seen'], '%d.%m %H:%M:%S')}\nСостояние: {c['status'] or '—'}"
                + ('\n🚨 Включено аварийное открытие!' if c['emergency'] else '')), None, []
    if cmd == 'summary':
        start = datetime.now(MSK).replace(hour=0, minute=0, second=0, microsecond=0)
        cur.execute(f'SELECT event_kind, count(*) FROM {schema}.skud_events WHERE controller_id = %s AND event_time >= %s '
                    f'GROUP BY event_kind', (c['id'], start))
        n = dict(cur.fetchall())
        cur.execute(f'SELECT count(DISTINCT profile_id) FROM {schema}.skud_events WHERE controller_id = %s AND event_time >= %s '
                    f"AND event_kind = 'entry'", (c['id'], start))
        people = cur.fetchone()[0]
        alarms = sum(n.get(k, 0) for k, _ in ALERTS)
        return (f"📊 Сводка за сегодня — «{c['name']}»\n{_link_text(c)}\n"
                f"Входов по карте: {n.get('entry', 0)} (людей: {people})\n"
                f"Выходов: {n.get('exit_button', 0) + n.get('exit', 0)}\n"
                f"Открыто удалённо: {n.get('remote_open', 0)}\n"
                f"Отказов: {n.get('denied', 0) + n.get('denied_blocked', 0)}\n"
                f"Тревог: {alarms}" + (' 🚨' if alarms else '')
                + ('\n🚨 Включено аварийное открытие!' if c['emergency'] else '')), None, []
    if cmd == 'inside':
        cur.execute(f"SELECT started_at, inside, people FROM {schema}.skud_visits WHERE controller_id = %s AND status = 'open' "
                    f'ORDER BY id DESC LIMIT 1', (c['id'],))
        r = cur.fetchone()
        if not r or not r[1]:
            return '👥 Сейчас на складе по картам никого нет.', None, []
        ppl = json.loads(r[2]) if r[2] else []
        return f"👥 На складе с {_t(r[0], '%H:%M')}: {r[1]} чел.\n" + ('\n'.join(ppl) if ppl else ''), None, []
    if cmd == 'alarms':
        cur.execute(f'SELECT event_time, event_kind, person_name, card_number, note, source FROM {schema}.skud_events '
                    f"WHERE controller_id = %s AND event_kind = ANY(%s) AND event_time > now() - interval '7 days' "
                    f'ORDER BY event_time DESC LIMIT 15', (c['id'], [k for k, _ in ALERTS]))
        return '🚨 Тревоги за 7 дней:\n' + _events_text(cur.fetchall()), None, []
    if cmd == 'journal':
        cur.execute(f'SELECT event_time, event_kind, person_name, card_number, note, source FROM {schema}.skud_events '
                    f'WHERE controller_id = %s ORDER BY event_time DESC LIMIT 15', (c['id'],))
        return '📋 Последние события:\n' + _events_text(cur.fetchall()), None, []
    if cmd == 'cards':
        cur.execute(f"SELECT count(*) FILTER (WHERE status = 'active'), count(*) FILTER (WHERE status = 'blocked'), "
                    f"count(*) FILTER (WHERE card_type = 'guest'), count(*) FILTER (WHERE NOT synced) FROM {schema}.skud_cards")
        a, b, g, ns = cur.fetchone()
        return (f"💳 Карт активных: {a}, заблокировано: {b}, гостевых: {g}\n"
                + (f"Ждут записи в контроллер: {ns}" if ns else 'Все карты записаны в контроллер')), None, []

    if not u['can_set']:
        return 'Настройки доступны директору, заместителю и отделу «Руководство».', None, []
    st = _settings(cur, schema)
    if cmd == 'alarm_toggle':
        k = str(payload.get('k') or '')
        if k in dict(ALERTS):
            st['kinds'] = [x for x in st['kinds'] if x != k] if k in st['kinds'] else st['kinds'] + [k]
            _save_settings(cur, schema, st, u['name'] + ' (ВК)')
        cmd = 'alarm_settings'
    if cmd == 'emp_toggle':
        st['alarms_to_employees'] = not st['alarms_to_employees']
        _save_settings(cur, schema, st, u['name'] + ' (ВК)')
        cmd = 'alarm_settings'
    if cmd == 'alarm_settings':
        page = 1 if int(payload.get('p') or 0) else 0
        part = ALERTS[:6] if page == 0 else ALERTS[6:]
        btns = [_btn(('✅ ' if k in st['kinds'] else '▫ ') + label, 'alarm_toggle', 'positive' if k in st['kinds'] else 'secondary',
                     k=k, p=page) for k, label in part]
        rows = [btns[i:i + 2] for i in range(0, len(btns), 2)]
        if page == 0:
            rows.append([_btn('Ещё тревоги →', 'alarm_settings', p=1)])
        else:
            rows.append([_btn(('✅ ' if st['alarms_to_employees'] else '▫ ') + 'Тревоги и сотрудникам', 'emp_toggle', p=1)])
            rows.append([_btn('← Назад', 'alarm_settings', p=0)])
        return (f"⚙ Какие тревоги присылать в ВК ({page + 1}/2). Нажмите, чтобы включить или выключить:", _inline(rows), [])

    if cmd == 'emergency' and payload.get('on') and not payload.get('sure'):
        return ('🚨 Аварийное открытие: дверь будет открыта ПОСТОЯННО, пока его не выключат. Включить?',
                _inline([[_btn('🚨 Да, включить', 'emergency', 'negative', on=1, sure=1), _btn('Отмена', 'door_settings')]]), [])
    if cmd == 'emergency':
        on = bool(payload.get('on'))
        cur.execute(f'UPDATE {schema}.skud_controllers SET emergency_open = %s WHERE id = %s', (on, c['id']))
        _event(cur, schema, c, 'remote_open' if on else 'other', u['name'],
               'Аварийное открытие включено из ВК' if on else 'Аварийное открытие выключено из ВК')
        msg = f"🚨 Аварийное открытие {'ВКЛЮЧЕНО — дверь открыта постоянно' if on else 'выключено'} ({u['name']})"
        return msg, None, [(_management_vk(cur, schema, vk_id), f"«{c['name']}»: {msg}")]
    if cmd in ('clock', 'gate_info'):
        cur.execute(f'INSERT INTO {schema}.skud_commands (controller_id, operation, created_by) VALUES (%s, %s, %s)',
                    (c['id'], 'sync_clock' if cmd == 'clock' else 'gate_info', u['name'] + ' (ВК)'))
        return '🕒 Команда отправлена контроллеру.', None, []
    if cmd == 'resync':
        cur.execute(f'UPDATE {schema}.skud_cards SET synced = false')
        return '💳 Карты будут заново записаны в контроллер в течение пары секунд (если дверь на связи).', None, []
    if cmd == 'lock':
        tm = c['timing']
        tenths = int(tm.get('relay_tenths') or c['open_seconds'] * 10)
        tenths = max(10, min(tenths + 10 * int(payload.get('d') or 0), 250))
        tm['relay_tenths'] = tenths
        cur.execute(f'UPDATE {schema}.skud_controllers SET timing = %s, open_seconds = %s WHERE id = %s',
                    (json.dumps(tm), max(1, tenths // 10), c['id']))
        cur.execute(f'INSERT INTO {schema}.skud_commands (controller_id, operation, payload, created_by) VALUES (%s, %s, %s, %s)',
                    (c['id'], 'set_params', json.dumps({'relay_tenths': tenths}), u['name'] + ' (ВК)'))
        c['timing'] = tm
        cmd = 'door_settings'
    if cmd == 'door_settings':
        secs = int(c['timing'].get('relay_tenths') or c['open_seconds'] * 10) / 10
        rows = [[_btn('🚨 Выключить аварийное' if c['emergency'] else '🚨 Аварийное открытие', 'emergency',
                      'negative', on=0 if c['emergency'] else 1)],
                [_btn('Замок −1 с', 'lock', d=-1), _btn('Замок +1 с', 'lock', d=1)],
                [_btn('🕒 Сверить часы', 'clock'), _btn('💳 Перезаписать карты', 'resync')],
                [_btn('ℹ Проверить контроллер', 'gate_info')]]
        return (f"🛠 «{c['name']}»\n{_link_text(c)}\nЗамок открыт: {secs:g} с\n"
                f"Аварийное открытие: {'ВКЛЮЧЕНО' if c['emergency'] else 'выключено'}"), _inline(rows), []
    return 'Не понял команду. Пользуйтесь кнопками внизу.', None, []
