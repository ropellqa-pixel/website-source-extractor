import json
import os
import secrets
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional

import psycopg2

from access import current_user

SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')
CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Authorization',
    'Access-Control-Max-Age': '86400',
}
LETTERS = 'АБВГДЕЖЗИКЛМНПРСТУФХЦЧШЭЮЯ'
LATIN = str.maketrans('ABEKMHOPCTXY', 'АВЕКМНОРСТХУ')
CATEGORIES = {'equipment': 'Оборудование', 'dishes': 'Посуда', 'inventory': 'Инвентарь', 'other': 'Прочее'}
KINDS = {'income': 'Приход', 'writeoff': 'Списание', 'recount': 'Инвентаризация (пересчёт)'}
REASONS = ['Бой', 'Износ', 'Поломка', 'Утеря', 'Кража', 'Брак', 'Передача', 'Прочее']


def _resp(status: int, payload: Any) -> Dict[str, Any]:
    return {'statusCode': status, 'headers': {**CORS, 'Content-Type': 'application/json'},
            'body': json.dumps(payload, ensure_ascii=False, default=lambda v: float(v) if isinstance(v, Decimal) else str(v))}


def _err(text: str, status: int = 400) -> Dict[str, Any]:
    return _resp(status, {'error': text})


def _dec(v: Any, places: str = '0.001') -> Optional[Decimal]:
    try:
        d = Decimal(str(v if v not in (None, '') else '0').replace(' ', '').replace(',', '.')).quantize(Decimal(places))
    except (InvalidOperation, ValueError):
        return None
    return d if Decimal('0') <= d < Decimal('100000000') else None


def norm_code(s: str) -> str:
    return str(s or '').strip().upper().translate(LATIN).replace(' ', '').replace('-', '')


def _new_code(cur, table: str, column: str) -> str:
    while True:
        code = ''.join(secrets.choice(LETTERS) for _ in range(2)) + f'{secrets.randbelow(10000):04d}'
        cur.execute(f'SELECT 1 FROM {SCHEMA}.{table} WHERE {column} = %s', (code,))
        if not cur.fetchone():
            return code


def _rows(cur) -> List[Dict[str, Any]]:
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _items(cur) -> List[Dict[str, Any]]:
    cur.execute(f'SELECT id, code, name, category, unit, qty, price, location, note, created_at FROM {SCHEMA}.inv_items '
                f'WHERE NOT archived ORDER BY name')
    return _rows(cur)


def _docs(cur, q: str = '') -> List[Dict[str, Any]]:
    params: List[Any] = []
    where = ''
    if q:
        where = (f' WHERE d.number = %s OR d.reason ILIKE %s OR d.comment ILIKE %s OR EXISTS (SELECT 1 FROM {SCHEMA}.inv_doc_lines l '
                 f'WHERE l.doc_id = d.id AND (l.item_name ILIKE %s OR l.item_code = %s))')
        like = f'%{q}%'
        params = [norm_code(q), like, like, like, norm_code(q)]
    cur.execute(f'SELECT d.id, d.number, d.kind, d.doc_date, d.reason, d.comment, d.total, d.created_by, d.created_at, '
                f'(SELECT count(*) FROM {SCHEMA}.inv_doc_lines l WHERE l.doc_id = d.id) AS lines, '
                f'(SELECT COALESCE(sum(l.qty), 0) FROM {SCHEMA}.inv_doc_lines l WHERE l.doc_id = d.id) AS qty '
                f'FROM {SCHEMA}.inv_docs d{where} ORDER BY d.doc_date DESC, d.id DESC LIMIT 200', params)
    return _rows(cur)


def _doc(cur, doc_id: int) -> Optional[Dict[str, Any]]:
    cur.execute(f'SELECT * FROM {SCHEMA}.inv_docs WHERE id = %s', (doc_id,))
    r = _rows(cur)
    if not r:
        return None
    d = r[0]
    cur.execute(f'SELECT l.*, i.unit FROM {SCHEMA}.inv_doc_lines l JOIN {SCHEMA}.inv_items i ON i.id = l.item_id '
                f'WHERE l.doc_id = %s ORDER BY l.id', (doc_id,))
    d['lines'] = _rows(cur)
    return d


def _create_doc(cur, user: Dict[str, Any], kind: str, lines: List[Dict[str, Any]], doc_date: str, reason: str, comment: str) -> Dict[str, Any]:
    number = _new_code(cur, 'inv_docs', 'number')
    cur.execute(f'INSERT INTO {SCHEMA}.inv_docs (number, kind, doc_date, reason, comment, created_by) '
                f'VALUES (%s, %s, %s, %s, %s, %s) RETURNING id', (number, kind, doc_date, reason, comment, user['name']))
    doc_id = cur.fetchone()[0]
    total = Decimal('0')
    for ln in lines:
        cur.execute(f'SELECT id, code, name, qty, price FROM {SCHEMA}.inv_items WHERE id = %s AND NOT archived FOR UPDATE', (ln['item_id'],))
        it = cur.fetchone()
        if not it:
            raise ValueError('Предмет не найден или в архиве')
        before = Decimal(it[3])
        qty = ln['qty']
        price = ln.get('price') if ln.get('price') is not None else Decimal(it[4])
        if kind == 'income':
            after = before + qty
        elif kind == 'writeoff':
            if qty > before:
                raise ValueError(f'«{it[2]}» ({it[1]}): нельзя списать {qty.normalize()} — на учёте только {before.normalize()}')
            after = before - qty
        else:
            after = qty
            qty = after - before
        cur.execute(f'INSERT INTO {SCHEMA}.inv_doc_lines (doc_id, item_id, item_code, item_name, qty, qty_before, qty_after, price) '
                    f'VALUES (%s, %s, %s, %s, %s, %s, %s, %s)', (doc_id, it[0], it[1], it[2], qty, before, after, price))
        upd_price = ', price = %s' if kind == 'income' and ln.get('price') is not None else ''
        cur.execute(f'UPDATE {SCHEMA}.inv_items SET qty = %s{upd_price} WHERE id = %s',
                    (after, *([price] if upd_price else []), it[0]))
        total += abs(qty) * Decimal(price)
    cur.execute(f'UPDATE {SCHEMA}.inv_docs SET total = %s WHERE id = %s', (total, doc_id))
    return {'id': doc_id, 'number': number}


def _parse_lines(body: Dict[str, Any], kind: str) -> List[Dict[str, Any]]:
    out, seen = [], set()
    for raw in body.get('lines') or []:
        iid = int(raw.get('item_id') or 0)
        qty = _dec(raw.get('qty'))
        if not iid or qty is None:
            raise ValueError('Проверьте количество в строках документа')
        if kind != 'recount' and qty <= 0:
            raise ValueError('Количество должно быть больше нуля')
        if iid in seen:
            raise ValueError('Один и тот же предмет добавлен дважды')
        seen.add(iid)
        price = _dec(raw.get('price'), '0.01') if raw.get('price') not in (None, '') else None
        out.append({'item_id': iid, 'qty': qty, 'price': price})
    if not out:
        raise ValueError('Добавьте хотя бы один предмет')
    return out


def _handler_impl(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Инвентаризация оборудования и посуды: карточки предметов с номером из 2 букв и 4 цифр,
    документы прихода, списания и пересчёта (тоже с номером), поиск по названию и номеру, история движения.'''
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}
    if event.get('httpMethod') != 'POST':
        return _err('Метод не поддерживается', 405)
    body = json.loads(event.get('body') or '{}')
    action = body.get('action') or ''
    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    cur = conn.cursor()
    try:
        user = current_user(cur, SCHEMA, event)
        if not user:
            return _err('Нужно войти в систему', 401)
        if '/inventory' not in user['sections']:
            return _err('Нет доступа к инвентаризации', 403)
        can = user['actions']
        can_edit = 'inventory.edit' in can
        can_off = 'inventory.writeoff' in can or can_edit

        if action == 'overview':
            return _resp(200, {'items': _items(cur), 'docs': _docs(cur), 'categories': CATEGORIES, 'kinds': KINDS,
                               'reasons': REASONS, 'can_edit': can_edit, 'can_writeoff': can_off})
        if action == 'docs':
            return _resp(200, {'docs': _docs(cur, str(body.get('q') or '').strip()[:100])})
        if action == 'doc':
            d = _doc(cur, int(body.get('id') or 0))
            return _resp(200, {'doc': d}) if d else _err('Документ не найден', 404)
        if action == 'item_history':
            cur.execute(f'SELECT l.qty, l.qty_before, l.qty_after, d.id AS doc_id, d.number, d.kind, d.doc_date, d.reason, d.created_by '
                        f'FROM {SCHEMA}.inv_doc_lines l JOIN {SCHEMA}.inv_docs d ON d.id = l.doc_id WHERE l.item_id = %s '
                        f'ORDER BY d.doc_date DESC, d.id DESC', (int(body.get('id') or 0),))
            return _resp(200, {'history': _rows(cur)})

        if action == 'item_save':
            if not can_edit:
                return _err('Нет права вести карточки предметов', 403)
            name = str(body.get('name') or '').strip()[:200]
            if not name:
                return _err('Укажите название')
            cat = body.get('category') if body.get('category') in CATEGORIES else 'other'
            unit = str(body.get('unit') or 'шт').strip()[:20] or 'шт'
            price = _dec(body.get('price'), '0.01')
            if price is None:
                return _err('Неверная цена')
            loc, note = str(body.get('location') or '').strip()[:200], str(body.get('note') or '').strip()[:500]
            iid = int(body.get('id') or 0)
            if iid:
                cur.execute(f'UPDATE {SCHEMA}.inv_items SET name = %s, category = %s, unit = %s, price = %s, location = %s, note = %s '
                            f'WHERE id = %s RETURNING code', (name, cat, unit, price, loc, note, iid))
                r = cur.fetchone()
                if not r:
                    return _err('Предмет не найден', 404)
                conn.commit()
                return _resp(200, {'ok': True, 'id': iid, 'code': r[0]})
            qty = _dec(body.get('qty'))
            if qty is None:
                return _err('Неверное количество')
            code = _new_code(cur, 'inv_items', 'code')
            cur.execute(f'INSERT INTO {SCHEMA}.inv_items (code, name, category, unit, price, location, note, created_by) '
                        f'VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id', (code, name, cat, unit, price, loc, note, user['name']))
            iid = cur.fetchone()[0]
            doc = None
            if qty > 0:
                doc = _create_doc(cur, user, 'income', [{'item_id': iid, 'qty': qty, 'price': price}],
                                  date.today().isoformat(), 'Постановка на учёт', '')
            conn.commit()
            return _resp(200, {'ok': True, 'id': iid, 'code': code, 'doc': doc})

        if action == 'item_archive':
            if not can_edit:
                return _err('Нет права вести карточки предметов', 403)
            cur.execute(f'UPDATE {SCHEMA}.inv_items SET archived = true WHERE id = %s AND qty = 0 RETURNING id', (int(body.get('id') or 0),))
            if not cur.fetchone():
                conn.rollback()
                return _err('В архив можно убрать только предмет с нулевым остатком — сначала спишите его')
            conn.commit()
            return _resp(200, {'ok': True})

        if action == 'doc_create':
            kind = body.get('kind')
            if kind not in KINDS:
                return _err('Неизвестный вид документа')
            if kind == 'writeoff' and not can_off:
                return _err('Нет права списывать', 403)
            if kind != 'writeoff' and not can_edit:
                return _err('Нет права оформлять приход и пересчёт', 403)
            try:
                d = date.fromisoformat(str(body.get('doc_date') or date.today().isoformat())[:10])
            except ValueError:
                return _err('Неверная дата')
            reason = str(body.get('reason') or '').strip()[:100]
            if kind == 'writeoff' and not reason:
                return _err('Укажите причину списания')
            try:
                lines = _parse_lines(body, kind)
                res = _create_doc(cur, user, kind, lines, d.isoformat(), reason, str(body.get('comment') or '').strip()[:500])
            except ValueError as e:
                conn.rollback()
                return _err(str(e))
            conn.commit()
            return _resp(200, {'ok': True, **res})
        return _err('Неизвестное действие')
    finally:
        cur.close()
        conn.close()


import tenant as _tenant  # noqa: E402


def _finders(body, event, qs):
    return []


_wrapped = _tenant.wrap(globals(), _handler_impl, _finders, ())


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Инвентаризация оборудования и посуды: номера предметов и документов (2 буквы + 4 цифры),
    приход, списание по количеству, пересчёт, поиск по названию и номеру.
    Данные каждой организации хранятся отдельно: схема выбирается по токену.'''
    return _wrapped(event, context)
