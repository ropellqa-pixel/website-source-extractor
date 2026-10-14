import base64
import hashlib
import json
import os
import re
import secrets
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional

import psycopg2

import sber
from access import current_user
from bank import guess_category

SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')
CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Authorization',
    'Access-Control-Max-Age': '86400',
}
STATUS = {
    'draft': 'Черновик', 'sent': 'На оплате у директора', 'rejected': 'Отклонена', 'paying': 'Отправлена в банк',
    'signing': 'Ждёт подписи по СМС', 'paid': 'Оплачена', 'failed': 'Ошибка банка', 'cancelled': 'Отменена',
}
PBKDF2_ITERATIONS = 150000
VATS = {'none', '0', '5', '7', '10', '20', '22'}


def _resp(status: int, payload: Any, headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    return {'statusCode': status, 'headers': {**CORS, 'Content-Type': 'application/json', **(headers or {})},
            'body': json.dumps(payload, ensure_ascii=False, default=str)}


def _err(text: str, status: int = 400) -> Dict[str, Any]:
    return _resp(status, {'error': text})


def _num(v: Any) -> float:
    return float(v) if v is not None else 0.0


def _money(v: Any) -> Optional[Decimal]:
    try:
        d = Decimal(str(v).replace(' ', '').replace(',', '.')).quantize(Decimal('0.01'))
    except (InvalidOperation, ValueError):
        return None
    return d if Decimal('0.01') <= d <= Decimal('99999999') else None


def _log(cur, user: Dict[str, Any], action: str, details: str) -> None:
    cur.execute(f'INSERT INTO {SCHEMA}.acc_log (user_name, action, details) VALUES (%s, %s, %s)',
                (user['name'], 'СБЕР: ' + action, details[:500]))


def _settings(cur) -> Dict[str, Any]:
    cur.execute(f"SELECT value FROM {SCHEMA}.app_settings WHERE key = 'sber'")
    r = cur.fetchone()
    v = r[0] if r and isinstance(r[0], dict) else json.loads(r[0]) if r else {}
    return {'limit_payment': 300000, 'limit_day': 1000000,
            'scope': 'openid GET_CLIENT_ACCOUNTS GET_STATEMENT_ACCOUNT GET_STATEMENT_TRANSACTION PAY_DOC_RU', **v}


def _save_settings(cur, v: Dict[str, Any], who: str) -> None:
    cur.execute(f"INSERT INTO {SCHEMA}.app_settings (key, value, updated_by) VALUES ('sber', %s, %s) "
                f'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()',
                (json.dumps(v, ensure_ascii=False), who))


def _vault_get(cur, key: str) -> Optional[str]:
    cur.execute(f'SELECT value FROM {SCHEMA}.sber_vault WHERE key = %s', (key,))
    r = cur.fetchone()
    return sber.decrypt(r[0]) if r else None


def _vault_set(cur, key: str, value: str) -> None:
    cur.execute(f'INSERT INTO {SCHEMA}.sber_vault (key, value, updated_at) VALUES (%s, %s, now()) '
                f'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', (key, sber.encrypt(value)))


def _sign_url(s: Dict[str, Any], ext: str) -> str:
    tpl = str(s.get('sign_url_template') or '')
    return tpl.replace('{externalId}', ext) if '{externalId}' in tpl else sber.sign_url(ext)


def _load_cert(cur) -> None:
    raw, pw = _vault_get(cur, 'cert_p12'), _vault_get(cur, 'cert_password')
    sber.set_cert(base64.b64decode(raw) if raw else None, pw or '')


def _token(cur) -> str:
    """Действующий токен банка; при истечении — обновление по refresh_token."""
    access = _vault_get(cur, 'access_token')
    exp = _vault_get(cur, 'access_exp')
    if access and exp and int(exp) > sber.now() + 60:
        return access
    rt = _vault_get(cur, 'refresh_token')
    if not rt:
        raise sber.SberError('СберБизнес не подключён. Замдиректора: раздел СБЕР → «Подключить»')
    t = sber.refresh(rt)
    _store_tokens(cur, t)
    return t['access_token']


def _store_tokens(cur, t: Dict[str, Any]) -> None:
    _vault_set(cur, 'access_token', t['access_token'])
    _vault_set(cur, 'access_exp', str(sber.now() + int(t.get('expires_in') or 3600)))
    if t.get('refresh_token'):
        _vault_set(cur, 'refresh_token', t['refresh_token'])


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _cp(cur, cp_id: int) -> Optional[Dict[str, Any]]:
    cur.execute(f'SELECT id, name, kind, inn, kpp, account, bank_bic, bank_name, corr_account, default_purpose, vat_rate, '
                f'requisites_hash, requisites_updated_at, requisites_updated_by, archived, default_category_id, phone, comment '
                f'FROM {SCHEMA}.acc_counterparties WHERE id = %s', (cp_id,))
    r = cur.fetchone()
    if not r:
        return None
    return {'id': r[0], 'name': r[1], 'kind': r[2], 'inn': r[3] or '', 'kpp': r[4] or '', 'account': r[5] or '', 'bic': r[6] or '',
            'bank_name': r[7] or '', 'corr_account': r[8] or '', 'default_purpose': r[9] or '', 'vat_rate': r[10] or 'none',
            'requisites_hash': r[11], 'requisites_updated_at': r[12], 'requisites_updated_by': r[13], 'archived': r[14],
            'default_category_id': r[15], 'phone': r[16] or '', 'comment': r[17] or '',
            'ready': bool(r[5] and r[6] and r[1] and r[11])}


def _counterparties(cur) -> List[Dict[str, Any]]:
    cur.execute(f'SELECT id FROM {SCHEMA}.acc_counterparties ORDER BY archived, name')
    return [_cp(cur, r[0]) for r in cur.fetchall()]


def _requests(cur, where: str = '', args: tuple = ()) -> List[Dict[str, Any]]:
    cur.execute(f'SELECT r.id, r.counterparty_id, cp.name, r.amount, r.purpose, r.vat_rate, r.week_start, r.status, r.requisites, '
                f'r.requisites_hash, cp.requisites_hash, r.created_by, r.created_at, r.sent_at, r.decided_by, r.decided_at, '
                f'r.reject_reason, r.external_id, r.bank_status, r.bank_comment, r.created_by_user, r.category_id '
                f'FROM {SCHEMA}.sber_requests r LEFT JOIN {SCHEMA}.acc_counterparties cp ON cp.id = r.counterparty_id '
                f'{where} ORDER BY r.week_start DESC, r.id DESC LIMIT 500', args)
    out = []
    for r in cur.fetchall():
        req = r[8] if isinstance(r[8], dict) else json.loads(r[8] or '{}')
        out.append({'id': r[0], 'counterparty_id': r[1], 'counterparty': r[2] or req.get('name'), 'amount': _num(r[3]), 'purpose': r[4],
                    'vat_rate': r[5], 'week_start': r[6], 'status': r[7], 'status_label': STATUS.get(r[7], r[7]),
                    'requisites': req, 'requisites_changed': bool(r[9] and r[10] and r[9] != r[10] and r[7] in ('draft', 'sent')),
                    'created_by': r[11], 'created_at': r[12], 'sent_at': r[13], 'decided_by': r[14], 'decided_at': r[15],
                    'reject_reason': r[16], 'external_id': r[17], 'bank_status': r[18], 'bank_comment': r[19],
                    'mine': False, 'created_by_user': r[20], 'category_id': r[21]})
    return out


def _snapshot(cp: Dict[str, Any]) -> Dict[str, Any]:
    return {k: cp.get(k) or '' for k in ('name', 'inn', 'kpp', 'account', 'bic', 'bank_name', 'corr_account')}


def _paid_today(cur) -> float:
    cur.execute(f"SELECT COALESCE(SUM(amount), 0) FROM {SCHEMA}.sber_requests WHERE status IN ('paying', 'signing', 'paid') "
                f'AND decided_at::date = CURRENT_DATE')
    return _num(cur.fetchone()[0])


def _check_password(cur, user_id: str, password: str) -> bool:
    cur.execute(f"SELECT count(*) FROM {SCHEMA}.sber_pay_attempts WHERE user_id = %s AND NOT ok AND created_at > now() - interval '15 minutes'",
                (user_id,))
    if cur.fetchone()[0] >= 5:
        raise sber.SberError('Слишком много неверных попыток. Подождите 15 минут.')
    cur.execute(f'SELECT password_hash FROM {SCHEMA}.auth_users WHERE id = %s', (user_id,))
    r = cur.fetchone()
    ok = False
    if r and r[0] and '$' in r[0]:
        salt, hx = r[0].split('$', 1)
        try:
            dk = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS)
            ok = secrets.compare_digest(dk.hex(), hx)
        except ValueError:
            ok = False
    cur.execute(f'INSERT INTO {SCHEMA}.sber_pay_attempts (user_id, ok) VALUES (%s, %s)', (user_id, ok))
    return ok


def _org(cur, token: str, s: Dict[str, Any]) -> Dict[str, Any]:
    r = sber.api('GET', '/v1/client-info', token)
    if r.status_code != 200:
        raise sber.SberError(f'Банк не вернул данные организации ({r.status_code})')
    info = r.json()
    accounts = [{'number': a.get('number'), 'currency': a.get('currencyCode'), 'bic': a.get('bic'), 'state': a.get('state')}
                for a in (info.get('accounts') or []) if a.get('number')]
    return {'name': info.get('shortName') or info.get('fullName') or '', 'inn': info.get('inn') or '', 'kpp': info.get('kpp') or '',
            'accounts': accounts}


# ---------------------------------------------------------------- выписка

def _cat_id(cur, kind: str, name: str) -> Optional[int]:
    cur.execute(f'SELECT id FROM {SCHEMA}.acc_categories WHERE kind = %s AND lower(name) = lower(%s) AND NOT archived', (kind, name))
    r = cur.fetchone()
    return r[0] if r else None


def sync_statement(cur, days: int = 3, who: str = 'Автозагрузка') -> Dict[str, Any]:
    """Выписка по расчётному счёту за последние дни → доходы/расходы бухгалтерии (без дублей)."""
    s = _settings(cur)
    account = s.get('account')
    if not account:
        raise sber.SberError('Не выбран расчётный счёт')
    token = _token(cur)
    cur.execute(f"SELECT value FROM {SCHEMA}.app_settings WHERE key = 'accounting'")
    r = cur.fetchone()
    start_period = ((r[0] if r and isinstance(r[0], dict) else {}) or {}).get('start_period') or '2000-01'
    cur.execute(f'SELECT period FROM {SCHEMA}.acc_periods WHERE closed')
    closed = {x[0] for x in cur.fetchall()}
    cur.execute(f'SELECT id, name, inn, default_category_id FROM {SCHEMA}.acc_counterparties')
    cps = [{'id': x[0], 'name': x[1], 'inn': x[2], 'cat': x[3]} for x in cur.fetchall()]
    added = skipped = 0
    for i in range(days, -1, -1):
        day = (date.today() - timedelta(days=i)).isoformat()
        page = 1
        while page <= 20:
            resp = sber.api('GET', '/v2/statement/transactions', token, params={'accountNumber': account, 'statementDate': day, 'page': page})
            if resp.status_code == 404:
                break
            if resp.status_code == 202:
                break
            if resp.status_code != 200:
                raise sber.SberError(f'Банк не отдал выписку за {day} ({resp.status_code})')
            data = resp.json()
            for t in data.get('transactions') or []:
                direction = (t.get('direction') or '').upper()
                kind = 'income' if direction == 'CREDIT' else 'expense'
                amount = abs(_num((t.get('amountRub') or t.get('amount') or {}).get('amount') if isinstance(t.get('amountRub') or t.get('amount'), dict)
                                  else t.get('amountRub') or t.get('amount')))
                op_date = (t.get('operationDate') or day)[:10]
                if amount <= 0 or op_date[:7] < start_period:
                    continue
                if op_date[:7] in closed:
                    skipped += 1
                    continue
                rc = t.get('rurTransfer') or {}
                if kind == 'income':
                    name, inn = rc.get('payerName') or '', rc.get('payerInn') or ''
                else:
                    name, inn = rc.get('payeeName') or '', rc.get('payeeInn') or ''
                purpose = t.get('paymentPurpose') or ''
                uid = t.get('uuid') or f"{op_date}|{kind}|{amount:.2f}|{t.get('number') or ''}|{inn or name[:40]}"
                cur.execute(f"SELECT 1 FROM {SCHEMA}.acc_entries WHERE source = 'bank' AND source_key = %s", (uid,))
                if cur.fetchone():
                    skipped += 1
                    continue
                cur.execute(f"UPDATE {SCHEMA}.sber_requests SET status = 'paid', bank_status = 'EXECUTED', bank_checked_at = now() "
                            f"WHERE status IN ('paying', 'signing') AND external_id = %s RETURNING id", (t.get('externalId') or '',))
                low = name.lower()
                cp = next((c for c in cps if inn and c['inn'] == inn), None) or next((c for c in cps if low and c['name'].lower() == low), None)
                if not cp and name:
                    cur.execute(f'INSERT INTO {SCHEMA}.acc_counterparties (name, kind, inn) VALUES (%s, %s, %s) RETURNING id',
                                (name[:150], 'supplier' if kind == 'expense' else 'customer', inn or None))
                    cp = {'id': cur.fetchone()[0], 'name': name, 'inn': inn, 'cat': None}
                    cps.append(cp)
                cat = cp['cat'] if cp and cp['cat'] else None
                if not cat:
                    g = guess_category({'kind': kind, 'purpose': purpose, 'name': name})
                    cat = _cat_id(cur, kind, g) if g else None
                cur.execute(f"INSERT INTO {SCHEMA}.acc_entries (kind, entry_date, amount, category_id, comment, counterparty_id, period, "
                            f"source, source_key, bank_purpose, created_by) VALUES (%s, %s, %s, %s, %s, %s, %s, 'bank', %s, %s, %s) "
                            f'ON CONFLICT (source, source_key) WHERE source IS NOT NULL DO NOTHING',
                            (kind, op_date, round(amount, 2), cat, f"Банк №{t.get('number') or ''}: {purpose[:400]}",
                             cp['id'] if cp else None, op_date[:7], uid, purpose[:1000], who))
                added += 1
            links = data.get('_links') or []
            if not any((l.get('rel') == 'next') for l in links if isinstance(l, dict)):
                break
            page += 1
    s['last_sync'] = datetime.now().isoformat(timespec='seconds')
    s['last_sync_result'] = {'added': added, 'skipped': skipped}
    _save_settings(cur, s, who)
    return {'added': added, 'skipped': skipped}


def _refresh_statuses(cur) -> None:
    cur.execute(f"SELECT id, external_id FROM {SCHEMA}.sber_requests WHERE status IN ('paying', 'signing') "
                f"AND (bank_checked_at IS NULL OR bank_checked_at < now() - interval '2 minutes') LIMIT 20")
    rows = cur.fetchall()
    if not rows:
        return
    token = _token(cur)
    for rid, ext in rows:
        resp = sber.api('GET', f'/v1/payments/{ext}/state', token)
        if resp.status_code != 200:
            cur.execute(f'UPDATE {SCHEMA}.sber_requests SET bank_checked_at = now() WHERE id = %s', (rid,))
            continue
        st = resp.json()
        bs = (st.get('bankStatus') or '').upper()
        new = 'paid' if bs in ('EXECUTED', 'ACCEPTED_BY_ABS', 'ACCEPTED') else 'failed' if bs in ('REFUSED', 'DECLINED', 'DELETED', 'INVALIDEDS', 'CANCELED', 'REFUSEDBYABS') \
            else 'signing' if bs in ('CREATED', 'NEW', 'IMPLEMENTED', 'PARTSIGNED', 'SIGNED', 'DELIVERED') else None
        cur.execute(f'UPDATE {SCHEMA}.sber_requests SET bank_status = %s, bank_comment = %s, bank_checked_at = now()'
                    f'{", status = %s" if new else ""} WHERE id = %s',
                    (bs, (st.get('bankComment') or '')[:500], *([new] if new else []), rid))


# ---------------------------------------------------------------- обработчик

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Раздел «СБЕР»: подключение СберБизнес API (OAuth + сертификат), ежедневная автозагрузка выписки по расчётному
    счёту в бухгалтерию, реквизиты контрагентов (меняет только замдиректора), недельные заявки на оплату от старшего
    сотрудника и оплата директором через СберБизнес с подтверждением паролем и лимитами.'''
    method = event.get('httpMethod')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}
    qs = event.get('queryStringParameters') or {}
    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.autocommit = True
    cur = conn.cursor()
    try:
        _load_cert(cur)
        if method == 'GET' and qs.get('code') and qs.get('state'):
            return _oauth_callback(cur, qs)
        if method == 'GET' and qs.get('cron') is not None:
            return _cron(cur, qs.get('cron') or '')
        if method != 'POST':
            return _err('Метод не поддерживается', 405)
        body = json.loads(event.get('body') or '{}')
        user = current_user(cur, SCHEMA, event)
        if not user:
            return _err('Нужно войти в систему', 401)
        if '/sber' not in user['sections']:
            return _err('Нет доступа к разделу СБЕР', 403)
        try:
            return _action(cur, user, body.get('action') or '', body)
        except sber.SberError as e:
            return _err(str(e), 502)
    finally:
        cur.close()
        conn.close()


def _cron(cur, key: str) -> Dict[str, Any]:
    s = _settings(cur)
    expected = s.get('cron_key')
    if not expected or key != expected:
        return _err('Нет доступа', 403)
    if not s.get('connected'):
        return _resp(200, {'ok': False, 'reason': 'not_connected'})
    try:
        res = sync_statement(cur, days=3)
        _refresh_statuses(cur)
        return _resp(200, {'ok': True, **res})
    except sber.SberError as e:
        s['last_sync_error'] = str(e)
        _save_settings(cur, s, 'Автозагрузка')
        return _resp(200, {'ok': False, 'error': str(e)})


def _oauth_callback(cur, qs: Dict[str, str]) -> Dict[str, Any]:
    cur.execute(f"UPDATE {SCHEMA}.sber_oauth SET used = true WHERE state = %s AND NOT used AND created_at > now() - interval '15 minutes' "
                f'RETURNING user_id, origin', (qs['state'],))
    r = cur.fetchone()
    back = (r[1] if r and r[1] else '') + '/sber'
    if not r:
        return {'statusCode': 302, 'headers': {'Location': back + '?connect=expired'}, 'body': ''}
    try:
        t = sber.exchange_code(qs['code'])
        _store_tokens(cur, t)
        s = _settings(cur)
        org = _org(cur, t['access_token'], s)
        s.update({'connected': True, 'org': org, 'connected_at': datetime.now().isoformat(timespec='seconds'),
                  'connected_by': r[0]})
        rub = [a for a in org['accounts'] if (a.get('currency') or '643') in ('643', 'RUB', 'RUR')]
        if not s.get('account') and rub:
            s['account'] = rub[0]['number']
        if not s.get('cron_key'):
            s['cron_key'] = sber.new_state()[0]
        s.pop('last_sync_error', None)
        _save_settings(cur, s, 'Подключение')
        cur.execute(f"INSERT INTO {SCHEMA}.acc_log (user_name, action, details) VALUES ('Система', 'СБЕР: подключён', %s)",
                    (org.get('name') or '',))
        return {'statusCode': 302, 'headers': {'Location': back + '?connect=ok'}, 'body': ''}
    except sber.SberError:
        return {'statusCode': 302, 'headers': {'Location': back + '?connect=error'}, 'body': ''}


def _action(cur, user: Dict[str, Any], action: str, body: Dict[str, Any]) -> Dict[str, Any]:
    can = user['actions']
    deputy = user['is_deputy']
    s = _settings(cur)

    if action == 'overview':
        if s.get('connected'):
            try:
                _refresh_statuses(cur)
            except sber.SberError:
                pass
        week = date.fromisoformat(body['week']) if body.get('week') else _week_start(date.today())
        week = _week_start(week)
        if not ({'sber.view', 'sber.request', 'sber.pay'} & can):
            return _err('Нет доступа', 403)
        reqs = _requests(cur, 'WHERE r.week_start = %s', (week,))
        if 'sber.pay' not in can and 'sber.view' not in can:
            reqs = [r for r in reqs if r['created_by_user'] == user['id']]
        cur.execute(f"SELECT r.week_start, count(*), SUM(r.amount) FROM {SCHEMA}.sber_requests r WHERE r.status = 'sent' GROUP BY 1 ORDER BY 1")
        pending = [{'week': x[0], 'count': x[1], 'amount': _num(x[2])} for x in cur.fetchall()]
        cfg = sber.configured()
        cur.execute(f"SELECT id, kind, name FROM {SCHEMA}.acc_categories WHERE kind = 'expense' AND NOT archived ORDER BY name")
        cats = [{'id': x[0], 'kind': x[1], 'name': x[2]} for x in cur.fetchall()]
        return _resp(200, {
            'week': week, 'requests': reqs, 'pending': pending, 'counterparties': _counterparties(cur), 'categories': cats,
            'statuses': STATUS, 'can': sorted(a for a in can if a.startswith('sber.')), 'is_deputy': deputy,
            'bank': {'connected': bool(s.get('connected')), 'configured': cfg, 'ready': all(cfg.values()), 'test': sber.is_test(),
                     'org': s.get('org'), 'account': s.get('account'), 'last_sync': s.get('last_sync'),
                     'last_sync_result': s.get('last_sync_result'), 'last_sync_error': s.get('last_sync_error'),
                     'limit_payment': s.get('limit_payment'), 'limit_day': s.get('limit_day'), 'paid_today': _paid_today(cur),
                     'cron_url_ready': bool(s.get('cron_key')) and deputy, 'cert': s.get('cert'),
                     'scope_v1': s.get('scope_v1') if deputy else None, 'scope_v2': s.get('scope_v2') if deputy else None,
                     'has_tokens': bool(_vault_get(cur, 'refresh_token')) if deputy else None,
                     'sign_url_template': s.get('sign_url_template') if deputy else None,
                     'cron_key': s.get('cron_key') if deputy else None},
        })

    if action in ('scopes_save', 'tokens_save'):
        if not deputy:
            return _err('Только заместитель директора', 403)
        if action == 'scopes_save':
            clean = lambda v: ' '.join(str(v or '').replace(',', ' ').split())[:2000]
            s['scope_v1'], s['scope_v2'] = clean(body.get('scope_v1')), clean(body.get('scope_v2'))
            tpl = str(body.get('sign_url_template') or '').strip()[:500]
            if tpl and (not tpl.startswith('https://') or '{externalId}' not in tpl or not re.match(r'^https://[a-z0-9.-]*sberbank\.ru', tpl)):
                return _err('Ссылка подписания должна вести на сайт Сбербанка и содержать {externalId}')
            s['sign_url_template'] = tpl
            if s['scope_v2']:
                s['scope'] = s['scope_v2']
            _save_settings(cur, s, user['name'])
            _log(cur, user, 'Scope', f"v1: {s['scope_v1'][:200]}; v2: {s['scope_v2'][:200]}")
            return _resp(200, {'ok': True})
        access, refresh_t = str(body.get('access_token') or '').strip(), str(body.get('refresh_token') or '').strip()
        if not refresh_t and not access:
            return _err('Вставьте Access Token и Refresh Token')
        if not sber.configured()['certificate']:
            return _err('Сначала загрузите сертификат организации')
        if refresh_t:
            _vault_set(cur, 'refresh_token', refresh_t)
        if access:
            _vault_set(cur, 'access_token', access)
            _vault_set(cur, 'access_exp', str(sber.now() + 3000))
        else:
            _vault_set(cur, 'access_exp', '0')
        try:
            org = _org(cur, _token(cur), s)
        except sber.SberError as e:
            return _err(f'Ключи сохранены, но банк их не принял: {e}')
        s.update({'connected': True, 'org': org, 'connected_at': datetime.now().isoformat(timespec='seconds'), 'connected_by': user['id']})
        rub = [a for a in org['accounts'] if (a.get('currency') or '643') in ('643', 'RUB', 'RUR')]
        if not s.get('account') and rub:
            s['account'] = rub[0]['number']
        if not s.get('cron_key'):
            s['cron_key'] = sber.new_state()[0]
        s.pop('last_sync_error', None)
        _save_settings(cur, s, user['name'])
        _log(cur, user, 'Подключён по токенам', org.get('name') or '')
        return _resp(200, {'ok': True, 'org': org})

    if action == 'sign_links':
        if 'sber.pay' not in can:
            return _err('Нет права', 403)
        rows = _requests(cur, "WHERE r.id = ANY(%s) AND r.status IN ('paying', 'signing')", ([int(x) for x in body.get('ids') or []][:50],))
        return _resp(200, {'links': [{'id': r['id'], 'url': _sign_url(s, r['external_id'])} for r in rows if r['external_id']]})

    if action in ('cert_upload', 'cert_delete'):
        if not deputy:
            return _err('Сертификат загружает только заместитель директора', 403)
        if action == 'cert_delete':
            cur.execute(f"DELETE FROM {SCHEMA}.sber_vault WHERE key IN ('cert_p12', 'cert_password')")
            s.pop('cert', None)
            _save_settings(cur, s, user['name'])
            _log(cur, user, 'Сертификат удалён', '')
            return _resp(200, {'ok': True})
        name = str(body.get('file_name') or '')
        if not name.lower().endswith(('.p12', '.pfx')):
            return _err('Нужен файл сертификата .p12 или .pfx')
        try:
            raw = base64.b64decode(str(body.get('file') or '').split(',', 1)[-1], validate=True)
        except Exception:
            return _err('Файл повреждён')
        if not 100 < len(raw) < 50000:
            return _err('Файл не похож на сертификат')
        password = str(body.get('password') or '')
        info = sber.inspect_cert(raw, password)
        if info['valid_to'] < date.today().isoformat():
            return _err(f"Сертификат уже истёк ({info['valid_to']}) — загрузите новый")
        _vault_set(cur, 'cert_p12', base64.b64encode(raw).decode())
        _vault_set(cur, 'cert_password', password)
        sber.set_cert(raw, password)
        s['cert'] = {**info, 'file_name': name[:120], 'uploaded_at': datetime.now().isoformat(timespec='seconds'),
                     'uploaded_by': user['name']}
        _save_settings(cur, s, user['name'])
        _log(cur, user, 'Сертификат загружен', f"{info['subject']} до {info['valid_to']}")
        return _resp(200, {'ok': True, 'cert': s['cert']})

    # ---- настройки банка: только замдиректора
    if action in ('connect', 'disconnect', 'bank_settings'):
        if not deputy:
            return _err('Только заместитель директора', 403)
        if action == 'connect':
            cfg = sber.configured()
            if not all(cfg.values()):
                return _err('Сначала добавьте ключи СберБизнес и загрузите сертификат (Админ-панель → СберБизнес)')
            state, nonce = sber.new_state()
            cur.execute(f'INSERT INTO {SCHEMA}.sber_oauth (state, nonce, user_id, origin) VALUES (%s, %s, %s, %s)',
                        (state, nonce, user['id'], str(body.get('origin') or '')[:200]))
            return _resp(200, {'url': sber.authorize_url(state, nonce, s.get('scope_v2') or s['scope'])})
        if action == 'disconnect':
            cur.execute(f"DELETE FROM {SCHEMA}.sber_vault WHERE key IN ('access_token', 'access_exp', 'refresh_token')")
            s['connected'] = False
            _save_settings(cur, s, user['name'])
            _log(cur, user, 'Отключён', '')
            return _resp(200, {'ok': True})
        lp, ld = _money(body.get('limit_payment')), _money(body.get('limit_day'))
        if not lp or not ld or lp > ld:
            return _err('Лимит одного платежа должен быть не больше дневного')
        acc = str(body.get('account') or s.get('account') or '')
        if s.get('org') and acc not in [a['number'] for a in s['org'].get('accounts', [])]:
            return _err('Выберите счёт организации')
        s.update({'limit_payment': float(lp), 'limit_day': float(ld), 'account': acc})
        _save_settings(cur, s, user['name'])
        _log(cur, user, 'Лимиты', f'платёж {lp}, день {ld}, счёт {acc}')
        return _resp(200, {'ok': True})

    if action == 'sync':
        if 'sber.sync' not in can:
            return _err('Нет права обновлять выписку', 403)
        res = sync_statement(cur, days=int(body.get('days') or 3), who=user['name'])
        _refresh_statuses(cur)
        _log(cur, user, 'Выписка', f"добавлено {res['added']}")
        return _resp(200, {'ok': True, **res})

    # ---- реквизиты контрагентов
    if action == 'counterparty_save':
        if 'sber.edit_requisites' not in can:
            return _err('Реквизиты контрагентов меняет только заместитель директора', 403)
        name = str(body.get('name') or '').strip()[:160]
        inn = re.sub(r'\D', '', str(body.get('inn') or ''))
        kpp = re.sub(r'\D', '', str(body.get('kpp') or ''))
        acc = re.sub(r'\D', '', str(body.get('account') or ''))
        bic = re.sub(r'\D', '', str(body.get('bic') or ''))
        corr = re.sub(r'\D', '', str(body.get('corr_account') or ''))
        vat = str(body.get('vat_rate') or 'none')
        if not name:
            return _err('Укажите название получателя, как в банке')
        if inn and not sber.check_inn(inn):
            return _err('ИНН с ошибкой — проверьте цифры')
        if kpp and len(kpp) != 9:
            return _err('КПП — 9 цифр')
        if acc or bic:
            if len(bic) != 9:
                return _err('БИК — 9 цифр')
            if not sber.check_account(acc, bic):
                return _err('Расчётный счёт не сходится с БИК — проверьте реквизиты')
            if corr and len(corr) != 20:
                return _err('Корр. счёт — 20 цифр')
        if vat not in VATS:
            return _err('Неизвестная ставка НДС')
        req = {'name': name, 'inn': inn, 'kpp': kpp, 'account': acc, 'bic': bic}
        h = sber.requisites_hash(req) if acc and bic else None
        vals = (name, body.get('kind') or 'supplier', inn or None, kpp or None, acc or None, bic or None,
                str(body.get('bank_name') or '').strip()[:160] or None, corr or None,
                str(body.get('default_purpose') or '').strip()[:200] or None, vat, body.get('default_category_id') or None,
                str(body.get('phone') or '').strip()[:40] or None, str(body.get('comment') or '').strip()[:300] or None,
                bool(body.get('archived')))
        if body.get('id'):
            old = _cp(cur, int(body['id']))
            if not old:
                return _err('Контрагент не найден', 404)
            changed = old['requisites_hash'] != h
            cur.execute(f'UPDATE {SCHEMA}.acc_counterparties SET name = %s, kind = %s, inn = %s, kpp = %s, account = %s, bank_bic = %s, '
                        f'bank_name = %s, corr_account = %s, default_purpose = %s, vat_rate = %s, default_category_id = %s, phone = %s, '
                        f'comment = %s, archived = %s, requisites_hash = %s'
                        + (', requisites_updated_at = now(), requisites_updated_by = %s' if changed else '') + ' WHERE id = %s',
                        (*vals, h, *([user['name']] if changed else []), body['id']))
            if changed:
                _log(cur, user, 'Реквизиты изменены', f"{name}: счёт {old['account'] or '—'} → {acc or '—'}, БИК {old['bic'] or '—'} → {bic or '—'}")
        else:
            cur.execute(f'INSERT INTO {SCHEMA}.acc_counterparties (name, kind, inn, kpp, account, bank_bic, bank_name, corr_account, '
                        f'default_purpose, vat_rate, default_category_id, phone, comment, archived, requisites_hash, requisites_updated_at, '
                        f'requisites_updated_by) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now(), %s)',
                        (*vals, h, user['name']))
            _log(cur, user, 'Новый контрагент', f'{name}, счёт {acc or "—"}')
        return _resp(200, {'ok': True, 'counterparties': _counterparties(cur)})

    # ---- заявки на оплату
    if action == 'request_save':
        if 'sber.request' not in can:
            return _err('Нет права создавать заявки', 403)
        cp = _cp(cur, int(body.get('counterparty_id') or 0))
        if not cp or cp['archived']:
            return _err('Выберите контрагента')
        if not cp['ready']:
            return _err('У контрагента не заполнены банковские реквизиты — попросите замдиректора')
        amount = _money(body.get('amount'))
        if not amount:
            return _err('Укажите сумму')
        purpose = str(body.get('purpose') or cp['default_purpose'] or '').strip()
        if len(purpose) < 5:
            return _err('Укажите назначение платежа: за что платим')
        week = _week_start(date.fromisoformat(body['week']) if body.get('week') else date.today())
        vat = str(body.get('vat_rate') or cp['vat_rate'] or 'none')
        if vat not in VATS:
            vat = 'none'
        snap = _snapshot(cp)
        if body.get('id'):
            cur.execute(f"UPDATE {SCHEMA}.sber_requests SET counterparty_id = %s, amount = %s, purpose = %s, vat_rate = %s, requisites = %s, "
                        f"requisites_hash = %s, category_id = %s WHERE id = %s AND status IN ('draft', 'rejected') AND (created_by_user = %s OR %s) "
                        f'RETURNING id', (cp['id'], amount, purpose[:200], vat, json.dumps(snap, ensure_ascii=False), cp['requisites_hash'],
                                          body.get('category_id') or cp['default_category_id'], body['id'], user['id'], deputy))
            if not cur.fetchone():
                return _err('Изменить можно только черновик или отклонённую заявку')
            cur.execute(f"UPDATE {SCHEMA}.sber_requests SET status = 'draft', reject_reason = NULL WHERE id = %s", (body['id'],))
        else:
            cur.execute(f'INSERT INTO {SCHEMA}.sber_requests (counterparty_id, amount, purpose, vat_rate, week_start, requisites, requisites_hash, '
                        f'created_by, created_by_user, category_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
                        (cp['id'], amount, purpose[:200], vat, week, json.dumps(snap, ensure_ascii=False), cp['requisites_hash'],
                         user['name'], user['id'], body.get('category_id') or cp['default_category_id']))
        return _resp(200, {'ok': True})

    if action in ('request_delete', 'send_week'):
        if 'sber.request' not in can:
            return _err('Нет права', 403)
        if action == 'request_delete':
            cur.execute(f"UPDATE {SCHEMA}.sber_requests SET status = 'cancelled' WHERE id = %s AND status IN ('draft', 'rejected', 'sent') "
                        f'AND (created_by_user = %s OR %s) RETURNING id', (body.get('id'), user['id'], deputy))
            if not cur.fetchone():
                return _err('Эту заявку уже нельзя отменить')
            return _resp(200, {'ok': True})
        week = _week_start(date.fromisoformat(body['week']))
        cur.execute(f"UPDATE {SCHEMA}.sber_requests SET status = 'sent', sent_at = now() WHERE week_start = %s AND status = 'draft' "
                    f'AND (created_by_user = %s OR %s) RETURNING amount', (week, user['id'], deputy))
        rows = cur.fetchall()
        if not rows:
            return _err('Нет черновиков для отправки')
        _log(cur, user, 'Заявки отправлены директору', f'неделя {week}: {len(rows)} шт. на {sum(_num(x[0]) for x in rows):.2f}')
        return _resp(200, {'ok': True, 'count': len(rows)})

    if action == 'reject':
        if 'sber.pay' not in can:
            return _err('Нет права', 403)
        reason = str(body.get('reason') or '').strip()[:300]
        cur.execute(f"UPDATE {SCHEMA}.sber_requests SET status = 'rejected', reject_reason = %s, decided_by = %s, decided_at = now() "
                    f"WHERE id = %s AND status = 'sent' RETURNING id", (reason or 'Без причины', user['name'], body.get('id')))
        if not cur.fetchone():
            return _err('Заявка уже обработана')
        _log(cur, user, 'Заявка отклонена', f"#{body.get('id')}: {reason}")
        return _resp(200, {'ok': True})

    if action == 'pay':
        return _pay(cur, user, body, s)

    return _err('Неизвестное действие')


def _pay(cur, user: Dict[str, Any], body: Dict[str, Any], s: Dict[str, Any]) -> Dict[str, Any]:
    """Оплата заявок директором: пароль, лимиты, сверка реквизитов, создание платёжки в СберБизнес."""
    if 'sber.pay' not in user['actions']:
        return _err('Оплачивать может только директор', 403)
    if not s.get('connected') or not s.get('account') or not s.get('org'):
        return _err('СберБизнес не подключён')
    if not _check_password(cur, user['id'], str(body.get('password') or '')):
        return _err('Неверный пароль', 403)
    ids = [int(x) for x in (body.get('ids') or [])][:50]
    if not ids:
        return _err('Выберите заявки')
    reqs = [r for r in _requests(cur, 'WHERE r.id = ANY(%s)', (ids,)) if r['status'] == 'sent']
    if len(reqs) != len(ids):
        return _err('Часть заявок уже обработана — обновите страницу')
    for r in reqs:
        cp = _cp(cur, r['counterparty_id'])
        if not cp or cp['requisites_hash'] != sber.requisites_hash(r['requisites']):
            return _err(f'Реквизиты «{r["counterparty"]}» изменились после создания заявки. Отклоните её и создайте заново.')
        if r['amount'] > float(s['limit_payment']):
            return _err(f'«{r["counterparty"]}»: сумма больше лимита одного платежа')
    total = sum(r['amount'] for r in reqs)
    if _paid_today(cur) + total > float(s['limit_day']):
        return _err('Превышен дневной лимит оплат. Его меняет замдиректора в разделе СБЕР.')
    token = _token(cur)
    org = s['org']
    today = date.today().isoformat()
    cur.execute(f"SELECT count(*) FROM {SCHEMA}.sber_requests WHERE external_id IS NOT NULL AND decided_at::date = CURRENT_DATE")
    n = cur.fetchone()[0]
    results = []
    for r in reqs:
        cur.execute(f"UPDATE {SCHEMA}.sber_requests SET status = 'paying', decided_by = %s, decided_at = now(), external_id = COALESCE(external_id, %s) "
                    f"WHERE id = %s AND status = 'sent' RETURNING external_id", (user['name'], sber.new_external_id(), r['id']))
        row = cur.fetchone()
        if not row:
            continue
        ext = row[0]
        n += 1
        pay = sber.payment_body(r, s['account'], org['name'], org['inn'], org.get('kpp') or '', ext,
                                int(datetime.now().strftime('%j')) * 100 + n, today)
        try:
            resp = sber.api('POST', '/v1/payments', token, json=pay, headers={'Content-Type': 'application/json'})
        except sber.SberError as e:
            cur.execute(f"UPDATE {SCHEMA}.sber_requests SET status = 'sent', bank_comment = %s WHERE id = %s", (str(e), r['id']))
            results.append({'id': r['id'], 'ok': False, 'error': str(e)})
            continue
        if resp.status_code in (200, 201):
            data = resp.json() if resp.content else {}
            cur.execute(f"UPDATE {SCHEMA}.sber_requests SET status = 'signing', bank_status = %s, bank_checked_at = now() WHERE id = %s",
                        (str(data.get('bankStatus') or 'CREATED'), r['id']))
            results.append({'id': r['id'], 'ok': True, 'sign_url': _sign_url(s, ext)})
            _log(cur, user, 'Оплата', f"{r['counterparty']} {r['amount']:.2f} ₽, счёт {r['requisites'].get('account')}")
        else:
            try:
                msg = resp.json().get('message') or resp.json().get('error') or ''
            except ValueError:
                msg = ''
            cur.execute(f"UPDATE {SCHEMA}.sber_requests SET status = 'failed', bank_comment = %s, bank_status = %s WHERE id = %s",
                        (f'{resp.status_code}: {msg}'[:500], 'ERROR', r['id']))
            results.append({'id': r['id'], 'ok': False, 'error': msg or f'Банк ответил {resp.status_code}'})
    return _resp(200, {'ok': True, 'results': results})
