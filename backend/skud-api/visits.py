"""Сборка «посещений склада» из событий контроллера и задания на видеоотрывки.

Открытие двери (opening) — от первого срабатывания (ключ, кнопка, сайт, взлом) до закрытия.
Повторные срабатывания, пока дверь не закрылась, продлевают то же открытие.
Посещение (visit) — цикл «кто-то вошёл по ключу → все вышли»: считаем людей внутри
(ключ на вход +1, кнопка/ключ на выход −1). Пока внутри кто-то есть, все открытия
(в том числе кнопкой) относятся к одному посещению. Нажатие кнопки, когда по счёту внутри
никого нет, в течение 30 минут после конца посещения дописывается к нему (вошли вдвоём по одной карте).

Весь разбор идёт в памяти, в базу — несколько запросов на пачку событий (у базы лимит запросов).
"""
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

OPEN_KINDS = {'entry', 'exit', 'exit_button', 'remote_open', 'forced'}
REJOIN_WINDOW = timedelta(minutes=30)
SENSOR_WAIT = timedelta(minutes=10)
STALE_VISIT = timedelta(hours=12)
PART = timedelta(minutes=10)
READY_DELAY = timedelta(seconds=20)
INSIDE_NAMES = ('склад-вн', 'складвн')


class Engine:
    def __init__(self, cur, schema: str, ctrl: Dict[str, Any]):
        self.cur, self.s, self.c = cur, schema, ctrl
        self.pre = timedelta(seconds=ctrl['pre'])
        self.post = timedelta(seconds=ctrl['post'])
        self.lock = timedelta(seconds=ctrl['open_seconds'] + 2)
        self.visits: Dict[int, Dict[str, Any]] = {}
        self.openings: List[Dict[str, Any]] = []
        self.clips: List[Dict[str, Any]] = []
        self.op: Optional[Dict[str, Any]] = None
        self.visit: Optional[Dict[str, Any]] = None
        self.last_door_clip: Dict[int, Dict[str, Any]] = {}

    def q(self, sql: str, args: tuple = ()):
        self.cur.execute(sql.replace('{S}', self.s), args)

    # ---------- загрузка состояния ----------
    def load(self, op_row, visit_row):
        if visit_row:
            self.visit = self._visit_from_row(visit_row)
        if op_row:
            self.op = {'id': op_row[0], 'visit_id': op_row[1], 'opened_at': op_row[2], 'last': op_row[3],
                       'marks': json.loads(op_row[4] or '[]'), 'held': op_row[5], 'status': 'open',
                       'closed_at': None, 'assumed': False, 'dirty': False}
            self.openings.append(self.op)
            if op_row[1] not in self.visits:
                self.q('SELECT id, status, started_at, ended_at, inside, entries, exits, alarm, note, inside_until '
                       'FROM {S}.skud_visits WHERE id = %s', (op_row[1],))
                r = self.cur.fetchone()
                if r:
                    self._visit_from_row(r)

    def _visit_from_row(self, r) -> Dict[str, Any]:
        v = {'id': r[0], 'status': r[1], 'started_at': r[2], 'ended_at': r[3], 'inside': r[4], 'entries': r[5],
             'exits': r[6], 'alarm': r[7], 'note': r[8], 'inside_until': r[9], 'dirty': False, 'new': False}
        self.visits[v['id']] = v
        return v

    # ---------- посещения ----------
    def _new_visit(self, t: datetime, note: Optional[str] = None) -> Dict[str, Any]:
        until = t - self.pre if self.c['inside_cam'] else None
        self.q('INSERT INTO {S}.skud_visits (controller_id, started_at, note, inside_until) VALUES (%s,%s,%s,%s) RETURNING id',
               (self.c['id'], t, note, until))
        vid = self.cur.fetchone()[0]
        v = {'id': vid, 'status': 'open', 'started_at': t, 'ended_at': None, 'inside': 0, 'entries': 0, 'exits': 0,
             'alarm': False, 'note': note, 'inside_until': until, 'dirty': True, 'new': True}
        self.visits[vid] = v
        self.visit = v
        return v

    def _rejoin_or_new(self, t: datetime) -> Dict[str, Any]:
        cand = [v for v in self.visits.values() if v['status'] == 'closed' and v['ended_at']
                and t - REJOIN_WINDOW <= v['ended_at'] <= t]
        if cand:
            v = max(cand, key=lambda x: x['ended_at'])
        else:
            self.q("SELECT id, status, started_at, ended_at, inside, entries, exits, alarm, note, inside_until "
                   "FROM {S}.skud_visits WHERE controller_id = %s AND status = 'closed' AND ended_at >= %s "
                   'AND ended_at <= %s ORDER BY ended_at DESC LIMIT 1', (self.c['id'], t - REJOIN_WINDOW, t))
            r = self.cur.fetchone()
            if not r:
                return self._new_visit(t, 'Выход по кнопке без входа по ключу')
            v = self.visits.get(r[0]) or self._visit_from_row(r)
        v.update(status='open', ended_at=None, dirty=True)
        tails = [c for c in self.clips if c['visit_id'] == v['id'] and c['mode'] == 'inside' and c.get('tail')]
        if tails and v['inside_until'] is not None:
            v['inside_until'] = min(c['from'] for c in tails)
        self.clips = [c for c in self.clips if c not in tails]
        self.visit = v
        return v

    def _close_visit(self, v: Dict[str, Any], at: datetime, note: Optional[str] = None):
        v.update(status='closed', ended_at=at, dirty=True)
        if note:
            v['note'] = note if not v['note'] else f"{v['note']}; {note}"
        self._inside_parts(v, at + self.post, True)
        if self.visit is v:
            self.visit = None

    def _inside_parts(self, v: Dict[str, Any], upto: datetime, final: bool):
        """Камера внутри склада (Склад-ВН): всё посещение кусками по 10 минут."""
        if not self.c['inside_cam'] or v['inside_until'] is None:
            return
        a = v['inside_until']
        while upto - a >= PART or (final and upto > a):
            b = min(upto, a + PART)
            self.clips.append({'visit_id': v['id'], 'opening': None, 'camera': self.c['inside_cam'], 'mode': 'inside',
                               'from': a, 'to': b, 'tail': final})
            a = b
        if a != v['inside_until']:
            v['inside_until'] = a
            v['dirty'] = True

    # ---------- открытия двери ----------
    def _deadline(self, op) -> datetime:
        return op['last'] + (SENSOR_WAIT if self.c['sensor'] else self.lock)

    def _close_opening(self, op, at: datetime, assumed: bool):
        op.update(status='closed', closed_at=at, assumed=assumed, dirty=True)
        if self.op is op:
            self.op = None
        if self.c['door_cam']:
            self._door_clip(op, op['opened_at'] - self.pre, at + self.post)
        v = self.visits.get(op['visit_id'])
        if v and v['status'] == 'open' and v['inside'] <= 0:
            self._close_visit(v, at)

    def _door_clip(self, op, a: datetime, b: datetime):
        prev = self.last_door_clip.get(op['visit_id'])
        if prev and prev['to'] >= a and b - prev['from'] <= PART:
            prev['to'] = max(prev['to'], b)
            return
        while a < b:
            end = min(b, a + PART)
            clip = {'visit_id': op['visit_id'], 'opening': op, 'camera': self.c['door_cam'], 'mode': 'door',
                    'from': a, 'to': end}
            self.clips.append(clip)
            self.last_door_clip[op['visit_id']] = clip
            a = end

    def apply(self, e: Dict[str, Any]):
        t, kind = e['time'], e['kind']
        if self.op and self._deadline(self.op) < t:
            self._close_opening(self.op, self.op['last'] + self.lock, True)
        mark = {'t': t.isoformat(), 'kind': kind, 'name': e['name']}

        if kind in OPEN_KINDS:
            v = self.visit if self.visit and self.visit['status'] == 'open' else None
            if kind == 'entry':
                v = v or self._new_visit(t)
                v['inside'] += 1
                v['entries'] += 1
            elif kind in ('exit', 'exit_button'):
                v = v or self._rejoin_or_new(t)
                v['inside'] = max(v['inside'] - 1, 0)
                v['exits'] += 1
            else:
                v = v or self._new_visit(t)
            if kind == 'forced':
                v['alarm'] = True
            v['dirty'] = True
            op = self.op
            if op and op['visit_id'] == v['id']:
                op['marks'].append(mark)
                op['last'] = max(op['last'], t)
                op['dirty'] = True
            else:
                if op:
                    self._close_opening(op, t, True)
                self.op = {'id': None, 'visit_id': v['id'], 'opened_at': t, 'last': t, 'marks': [mark], 'held': False,
                           'status': 'open', 'closed_at': None, 'assumed': False, 'dirty': True}
                self.openings.append(self.op)
            self._inside_parts(v, t, False)
            return

        if kind == 'held_open' and self.op:
            self.op['marks'].append(mark)
            self.op.update(held=True, last=max(self.op['last'], t), dirty=True)
            v = self.visits.get(self.op['visit_id'])
            if v:
                v.update(alarm=True, dirty=True)
        elif kind == 'door_closed' and self.op:
            self._close_opening(self.op, max(t, self.op['last']), False)
        elif kind in ('denied', 'denied_blocked') and self.visit:
            txt = f"Отказ: {e['name'] or e['card'] or 'карта'}"
            v = self.visit
            v['note'] = txt if not v['note'] else f"{v['note']}; {txt}"
            v['alarm'] = v['alarm'] or kind == 'denied_blocked'
            v['dirty'] = True

    def tick(self, now: datetime):
        if self.op and self._deadline(self.op) < now:
            self._close_opening(self.op, self.op['last'] + self.lock, True)
        v = self.visit
        if v and v['status'] == 'open':
            last = max((o['last'] for o in self.openings if o['visit_id'] == v['id']), default=None)
            if last is None:
                self.q('SELECT max(last_open_at) FROM {S}.skud_openings WHERE visit_id = %s', (v['id'],))
                last = self.cur.fetchone()[0] or v['started_at']
            if now - last > STALE_VISIT and not self.op:
                self._close_visit(v, last + self.lock, 'Выход не отмечен — посещение закрыто автоматически')
            else:
                self._inside_parts(v, now, False)

    # ---------- запись ----------
    def save(self):
        for v in self.visits.values():
            if v['dirty']:
                self.q('UPDATE {S}.skud_visits SET status=%s, ended_at=%s, inside=%s, entries=%s, exits=%s, alarm=%s, '
                       'note=%s, inside_until=%s WHERE id=%s',
                       (v['status'], v['ended_at'], v['inside'], v['entries'], v['exits'], v['alarm'], v['note'],
                        v['inside_until'], v['id']))
        for op in self.openings:
            marks = json.dumps(op['marks'], ensure_ascii=False)
            if op['id'] is None:
                self.q('INSERT INTO {S}.skud_openings (visit_id, controller_id, status, opened_at, last_open_at, closed_at, '
                       'closed_assumed, held, marks) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id',
                       (op['visit_id'], self.c['id'], op['status'], op['opened_at'], op['last'], op['closed_at'],
                        op['assumed'], op['held'], marks))
                op['id'] = self.cur.fetchone()[0]
            elif op['dirty']:
                self.q('UPDATE {S}.skud_openings SET status=%s, last_open_at=%s, closed_at=%s, closed_assumed=%s, held=%s, '
                       'marks=%s WHERE id=%s', (op['status'], op['last'], op['closed_at'], op['assumed'], op['held'],
                                                marks, op['id']))
        if self.clips:
            rows, args = [], []
            for c in self.clips:
                rows.append('(%s,%s,%s,%s,%s,%s)')
                args += [c['visit_id'], c['opening']['id'] if c['opening'] else None, c['camera'], c['mode'], c['from'], c['to']]
            self.q('INSERT INTO {S}.skud_clips (visit_id, opening_id, camera_id, mode, clip_from, clip_to) VALUES '
                   + ','.join(rows), tuple(args))


def load_controller(cur, schema: str, ctrl_id: str) -> Optional[Dict[str, Any]]:
    cur.execute(
        f'SELECT c.id, c.camera_id, COALESCE(c.inside_camera_id, (SELECT id FROM {schema}.cameras '
        f"WHERE lower(replace(name, ' ', '')) IN %s LIMIT 1)), c.open_seconds, c.pre_seconds, c.post_seconds, "
        f"EXISTS(SELECT 1 FROM {schema}.skud_events e WHERE e.controller_id = c.id AND e.event_kind = 'door_closed'), "
        f'(SELECT row_to_json(o) FROM (SELECT id, visit_id, opened_at, last_open_at, marks, held FROM {schema}.skud_openings '
        f"WHERE controller_id = c.id AND status = 'open' ORDER BY id DESC LIMIT 1) o), "
        f'(SELECT row_to_json(v) FROM (SELECT id, status, started_at, ended_at, inside, entries, exits, alarm, note, inside_until '
        f"FROM {schema}.skud_visits WHERE controller_id = c.id AND status = 'open' ORDER BY id DESC LIMIT 1) v) "
        f'FROM {schema}.skud_controllers c WHERE c.id = %s', (INSIDE_NAMES, ctrl_id))
    r = cur.fetchone()
    if not r:
        return None
    return {'id': r[0], 'door_cam': r[1], 'inside_cam': r[2], 'open_seconds': r[3] or 3,
            'pre': 10 if r[4] is None else r[4], 'post': 10 if r[5] is None else r[5], 'sensor': bool(r[6]),
            'op': r[7], 'visit': r[8]}


def _ts(s):
    if s is None or isinstance(s, datetime):
        return s
    d = datetime.fromisoformat(str(s))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def process(cur, schema: str, ctrl_id: str, now: Optional[datetime] = None) -> None:
    """Разбирает новые события контроллера и закрывает то, что закрылось по времени."""
    ctrl = load_controller(cur, schema, ctrl_id)
    if not ctrl:
        return
    now = now or datetime.now(timezone.utc)
    cur.execute(f'SELECT e.id, e.event_time, e.event_kind, COALESCE(p.full_name, e.person_name), e.card_number '
                f'FROM {schema}.skud_events e LEFT JOIN {schema}.profiles p ON p.id = e.profile_id '
                f'WHERE e.controller_id = %s AND NOT e.processed ORDER BY e.event_time, e.id LIMIT 500', (ctrl_id,))
    rows = cur.fetchall()
    if not rows and not ctrl['op'] and not ctrl['visit']:
        return
    eng = Engine(cur, schema, ctrl)
    o, v = ctrl['op'], ctrl['visit']
    eng.load(
        (o['id'], o['visit_id'], _ts(o['opened_at']), _ts(o['last_open_at']), o['marks'], o['held']) if o else None,
        (v['id'], v['status'], _ts(v['started_at']), _ts(v['ended_at']), v['inside'], v['entries'], v['exits'],
         v['alarm'], v['note'], _ts(v['inside_until'])) if v else None)
    for r in rows:
        eng.apply({'time': r[1], 'kind': r[2], 'name': r[3], 'card': r[4]})
    eng.tick(now)
    eng.save()
    if rows:
        cur.execute(f'UPDATE {schema}.skud_events SET processed = true WHERE id = ANY(%s)', ([r[0] for r in rows],))
