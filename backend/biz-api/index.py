import json
import os
import re
import secrets
import uuid as uuidlib
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional

import psycopg2

import tenant as _tenant

SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')
CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Authorization',
    'Access-Control-Max-Age': '86400',
}

EXTRA_KEYS = {
    'skud_commissioning': ['object_name', 'object_address', 'controller_model', 'controller_serial', 'reader_model', 'reader_serial',
                           'button_model', 'button_count', 'lock_type', 'doors', 'installer', 'commission_date'],
    'skud_access': ['person_position', 'card_1', 'card_2', 'card_3', 'card_4', 'card_type', 'zones', 'schedule'],
    'legal_registration': [],
    'legal_data': ['data_location'],
}

DOC_TYPES = {
    'license_agreement': {'prefix': 'ЛД', 'title': 'Лицензионный договор'},
    'contract': {'prefix': 'Д', 'title': 'Договор'},
    'service_contract': {'prefix': 'ДС', 'title': 'Договор на оказание услуг сопровождения'},
    'license_issue': {'prefix': 'ВЛ', 'title': 'Акт о выдаче лицензии'},
    'usage_certificate': {'prefix': 'СП', 'title': 'Свидетельство о праве пользования (БИЗ)'},
    'certificate_web': {'prefix': 'СП-А', 'title': 'Свидетельство о праве пользования АнодБИЗ'},
    'certificate_win': {'prefix': 'СП-П', 'title': 'Свидетельство о праве пользования ПО АБИЗ'},
    'access_director': {'prefix': 'СД-Д', 'title': 'Свидетельство о предоставлении доступа директора'},
    'access_deputy': {'prefix': 'СД-З', 'title': 'Свидетельство о предоставлении доступа заместителя директора'},
    'access_senior': {'prefix': 'СД-С', 'title': 'Свидетельство о предоставлении доступа старшего сотрудника'},
    'skud_commissioning': {'prefix': 'СВ-С', 'title': 'Свидетельство о вводе СКУД в эксплуатацию'},
    'skud_access': {'prefix': 'СД-К', 'title': 'Свидетельство о предоставлении доступа к СКУД'},
    'legal_registration': {'prefix': 'СР-Л', 'title': 'Свидетельство о регистрации и присвоении лицевого счёта'},
    'legal_data': {'prefix': 'СХ-Д', 'title': 'Свидетельство о раздельном хранении и защите данных'},
    'invoice': {'prefix': 'СЧ', 'title': 'Счёт на оплату'},
    'act': {'prefix': 'АКТ', 'title': 'Акт предоставления прав'},
    'pd_assignment': {'prefix': 'ПОР', 'title': 'Поручение на обработку персональных данных'},
    'pd_consent': {'prefix': 'СОГ', 'title': 'Согласие на обработку персональных данных'},
    'nda': {'prefix': 'СК', 'title': 'Соглашение о конфиденциальности'},
    'edo_agreement': {'prefix': 'ЭДО', 'title': 'Соглашение об электронном документообороте'},
    'supplementary': {'prefix': 'ДС-', 'title': 'Дополнительное соглашение'},
    'reconciliation': {'prefix': 'АС', 'title': 'Акт сверки взаимных расчётов'},
    'suspension_notice': {'prefix': 'УВ', 'title': 'Уведомление о приостановлении доступа'},
    'termination': {'prefix': 'СР', 'title': 'Соглашение о расторжении договора'},
}
REGISTER_DOCS = ['license_agreement', 'contract', 'pd_assignment', 'pd_consent', 'edo_agreement']
ACTIVATE_DOCS = ['license_issue', 'usage_certificate', 'certificate_web', 'certificate_win', 'act']

ORG_FIELDS = [
    'org_type', 'name', 'full_name', 'inn', 'kpp', 'ogrn', 'okved', 'legal_address', 'postal_address',
    'director_name', 'director_position', 'director_basis', 'contact_name', 'email', 'phone',
    'bank_name', 'bik', 'bank_account', 'corr_account',
]
ADMIN_ORG_FIELDS = ORG_FIELDS + ['status', 'license_until', 'monthly_price', 'notes', 'users_limit', 'tariff']
STATUSES = ('pending', 'active', 'suspended', 'blocked', 'terminated')
FIELD_LIMITS = {'legal_address': 400, 'postal_address': 400, 'notes': 4000, 'full_name': 400}


def _resp(status: int, payload: Any) -> Dict[str, Any]:
    return {'statusCode': status, 'headers': {**CORS, 'Content-Type': 'application/json'},
            'body': json.dumps(payload, ensure_ascii=False, default=_json_default)}


def _json_default(v: Any) -> Any:
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    return str(v)


def _t(name: str) -> str:
    return f'"{SCHEMA}"."{name}"'


def _rows(cur) -> List[Dict[str, Any]]:
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _one(cur) -> Optional[Dict[str, Any]]:
    r = _rows(cur)
    return r[0] if r else None


def _token(event: Dict[str, Any], body: Dict[str, Any]) -> str:
    h = event.get('headers') or {}
    t = h.get('X-Authorization') or h.get('x-authorization') or body.get('token') or ''
    return t[7:].strip() if t.startswith('Bearer ') else t.strip()


def _user(cur, token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    cur.execute(
        f'SELECT u.id, u.email, u.is_admin, u.is_biz_admin, u.org_id FROM {_t("auth_sessions")} s '
        f'JOIN {_t("auth_users")} u ON u.id = s.user_id WHERE s.token = %s AND s.expires_at > now()', (token,))
    row = _one(cur)
    if row:
        return row
    cur.execute(
        f'SELECT u.id, u.email, u.is_admin, u.is_biz_admin, u.org_id FROM {_t("api_tokens")} t '
        f'JOIN {_t("auth_users")} u ON u.id = t.user_id WHERE t.token = %s AND t.revoked_at IS NULL', (token,))
    return _one(cur)


def _settings(cur) -> Dict[str, Any]:
    cur.execute(f'SELECT key, value FROM {_t("biz_settings")}')
    return {r[0]: r[1] for r in cur.fetchall()}


def _audit(cur, actor: str, org_id: str, action: str, details: Dict[str, Any]) -> None:
    cur.execute(f'INSERT INTO {_t("biz_audit")} (actor, org_id, action, details) VALUES (%s, %s, %s, %s)',
                (actor, org_id, action, json.dumps(details, ensure_ascii=False, default=_json_default)))


def _new_account(cur) -> str:
    for _ in range(50):
        acc = str(secrets.randbelow(900000) + 100000)
        cur.execute(f'SELECT 1 FROM {_t("biz_organizations")} WHERE account_no = %s', (acc,))
        if not cur.fetchone():
            return acc
    raise RuntimeError('Не удалось подобрать лицевой счёт')


def _digits(s: str) -> str:
    return re.sub(r'\D', '', s or '')


def _inn_ok(inn: str) -> bool:
    d = [int(c) for c in inn]
    def chk(w: List[int]) -> int:
        return sum(a * b for a, b in zip(w, d)) % 11 % 10
    if len(d) == 10:
        return chk([2, 4, 10, 3, 5, 9, 4, 6, 8]) == d[9]
    if len(d) == 12:
        return (chk([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) == d[10]
                and chk([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) == d[11])
    return False


def _ogrn_ok(ogrn: str) -> bool:
    if len(ogrn) == 13:
        return int(ogrn[:12]) % 11 % 10 == int(ogrn[12])
    if len(ogrn) == 15:
        return int(ogrn[:14]) % 13 % 10 == int(ogrn[14])
    return False


def _validate_org(d: Dict[str, Any]) -> Optional[str]:
    t = d.get('org_type')
    if t not in ('ООО', 'ИП', 'АО', 'ПАО', 'НКО'):
        return 'Выберите форму: ООО, АО, ИП и т.д.'
    inn, ogrn = _digits(d.get('inn', '')), _digits(d.get('ogrn', ''))
    is_ip = t == 'ИП'
    if is_ip and len(inn) != 12:
        return 'ИНН индивидуального предпринимателя — 12 цифр'
    if not is_ip and len(inn) != 10:
        return 'ИНН организации — 10 цифр'
    if not _inn_ok(inn):
        return 'ИНН указан с ошибкой (не сходится контрольная цифра)'
    if is_ip and len(ogrn) != 15:
        return 'ОГРНИП — 15 цифр'
    if not is_ip and len(ogrn) != 13:
        return 'ОГРН — 13 цифр'
    if not _ogrn_ok(ogrn):
        return 'ОГРН указан с ошибкой (не сходится контрольная цифра)'
    if not is_ip and len(_digits(d.get('kpp', ''))) != 9:
        return 'КПП — 9 цифр'
    if len((d.get('name') or '').strip()) < 3:
        return 'Укажите наименование'
    if len((d.get('director_name') or '').strip()) < 5:
        return 'Укажите ФИО руководителя' if not is_ip else 'Укажите ФИО предпринимателя'
    if len((d.get('legal_address') or '').strip()) < 10:
        return 'Укажите юридический адрес' if not is_ip else 'Укажите адрес регистрации'
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', (d.get('email') or '').strip()):
        return 'Укажите корректный email'
    if len(_digits(d.get('phone', ''))) < 10:
        return 'Укажите телефон'
    bik, acc, corr = _digits(d.get('bik', '')), _digits(d.get('bank_account', '')), _digits(d.get('corr_account', ''))
    if bik and len(bik) != 9:
        return 'БИК — 9 цифр'
    if acc and len(acc) != 20:
        return 'Расчётный счёт — 20 цифр'
    if corr and len(corr) != 20:
        return 'Корр. счёт — 20 цифр'
    return None


def _clean_org(d: Dict[str, Any], fields: List[str]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for f in fields:
        if f not in d:
            continue
        v = d[f]
        if f in ('inn', 'kpp', 'ogrn', 'bik', 'bank_account', 'corr_account'):
            v = _digits(str(v or ''))
        elif f == 'license_until':
            v = v or None
        elif f in ('monthly_price', 'users_limit'):
            v = float(v or 0) if f == 'monthly_price' else int(v or 0)
        elif f == 'status':
            if v not in STATUSES:
                continue
        else:
            v = str(v or '').strip()[:FIELD_LIMITS.get(f, 250)]
        out[f] = v
    if out.get('org_type') == 'ИП':
        out['kpp'] = ''
        if not out.get('director_position'):
            out['director_position'] = 'Индивидуальный предприниматель'
        if not out.get('director_basis'):
            out['director_basis'] = 'Свидетельства о государственной регистрации (ОГРНИП)'
    elif 'org_type' in out:
        out.setdefault('director_position', 'Генеральный директор')
        if not out.get('director_position'):
            out['director_position'] = 'Генеральный директор'
        if not out.get('director_basis'):
            out['director_basis'] = 'Устава'
    if 'full_name' in out and not out['full_name'] and out.get('name'):
        out['full_name'] = out['name']
    return out


def _next_number(cur, doc_type: str, account: str, on: date) -> str:
    prefix = DOC_TYPES[doc_type]['prefix']
    cur.execute(f'SELECT count(*) FROM {_t("biz_documents")} WHERE doc_type = %s AND EXTRACT(YEAR FROM doc_date) = %s',
                (doc_type, on.year))
    n = cur.fetchone()[0] + 1
    sep = '' if prefix.endswith('-') else '-'
    while True:
        num = f'{prefix}{sep}{account}/{on.strftime("%y")}-{n:03d}'
        cur.execute(f'SELECT 1 FROM {_t("biz_documents")} WHERE number = %s', (num,))
        if not cur.fetchone():
            return num
        n += 1


def _add_months(d: date, m: int) -> date:
    y, mo = divmod(d.month - 1 + m, 12)
    y += d.year
    mo += 1
    import calendar
    last = calendar.monthrange(y, mo)[1]
    return date(y, mo, min(d.day, last))


def _issue(cur, org: Dict[str, Any], doc_type: str, actor: str, months: int = 0, amount: float = 0.0,
           period_from: Optional[date] = None, base_id: str = '', doc_date: Optional[date] = None,
           extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    on = doc_date or date.today()
    settings = _settings(cur)
    pf = period_from or on
    pt = _add_months(pf, months) - timedelta(days=1) if months else None
    snap = {
        'vendor': settings.get('vendor', {}), 'tariff': settings.get('tariff', {}),
        'org': {k: org.get(k) for k in ORG_FIELDS + ['account_no', 'users_limit']},
        'base_id': base_id,
        **(extra or {}),
    }
    if base_id:
        cur.execute(f'SELECT number, doc_date FROM {_t("biz_documents")} WHERE id = %s', (base_id,))
        b = cur.fetchone()
        if b:
            snap['base_number'], snap['base_date'] = b[0], b[1].isoformat()
    doc = {
        'id': str(uuidlib.uuid4()), 'org_id': org['id'], 'doc_type': doc_type,
        'number': _next_number(cur, doc_type, org['account_no'], on), 'doc_date': on,
        'period_from': pf if months else None, 'period_to': pt, 'months': months, 'amount': amount,
        'status': 'issued', 'snapshot': json.dumps(snap, ensure_ascii=False, default=_json_default), 'created_by': actor,
    }
    cols = ', '.join(doc.keys())
    cur.execute(f'INSERT INTO {_t("biz_documents")} ({cols}) VALUES ({", ".join(["%s"] * len(doc))})', list(doc.values()))
    _audit(cur, actor, org['id'], 'issue_doc', {'type': doc_type, 'number': doc['number']})
    return doc


def _org_by_user(cur, user: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    cur.execute(f'SELECT * FROM {_t("biz_organizations")} WHERE id = %s', (user.get('org_id') or 'org-main',))
    return _one(cur)


def _docs_of(cur, org_id: str) -> List[Dict[str, Any]]:
    cur.execute(f'SELECT * FROM {_t("biz_documents")} WHERE org_id = %s ORDER BY doc_date DESC, created_at DESC', (org_id,))
    return _rows(cur)


def _public_org(o: Dict[str, Any]) -> Dict[str, Any]:
    o = dict(o)
    o.pop('draft_token', None)
    o.pop('created_ip', None)
    return o


def _license_state(o: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not o:
        return {'allowed': False, 'reason': 'no_org'}
    st = o['status']
    until = o.get('license_until')
    if st == 'active' and (until is None or until >= date.today()):
        if o['id'] != 'org-main' and not o.get('data_schema'):
            return {'allowed': False, 'status': st, 'reason': 'workspace', 'license_until': until}
        return {'allowed': True, 'status': st, 'license_until': until}
    reason = 'expired' if st == 'active' else st
    return {'allowed': False, 'status': st, 'reason': reason, 'license_until': until}


def _provision_safe(org_id: str) -> str:
    """Создаёт отдельное хранилище организации отдельной транзакцией.
    Возвращает текст ошибки (пусто — успешно)."""
    c = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        with c.cursor() as cur:
            cur.execute(f'SELECT * FROM {_t("biz_organizations")} WHERE id = %s', (org_id,))
            org = _one(cur)
            if not org:
                return 'Организация не найдена'
            _tenant.provision(cur, org)
        c.commit()
        return ''
    except Exception as e:
        c.rollback()
        print('provision error', org_id, repr(e))
        return 'Не удалось создать отдельное хранилище данных: ' + str(e)[:200]
    finally:
        c.close()


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Лицензирование подписки БИЗ (АнодБИЗ и ПО АБИЗ): регистрация организаций и ИП с проверкой
    ИНН/ОГРН, лицевой счёт из 6 цифр, статус лицензии, выпуск и нумерация документов (лицензионный
    договор, договор, акт о выдаче лицензии, свидетельство о праве пользования, счёт, акт),
    публичные юридические документы и админ-панель БИЗ (все организации, договоры, журнал).'''
    method = event.get('httpMethod', 'GET')
    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}
    try:
        body = json.loads(event.get('body') or '{}') if method == 'POST' else {}
    except Exception:
        return _resp(400, {'error': 'Некорректный JSON'})
    action = body.get('action') or (event.get('queryStringParameters') or {}).get('action') or ''
    ip = ((event.get('requestContext') or {}).get('identity') or {}).get('sourceIp', '')

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        with conn.cursor() as cur:
            if action == 'public_info':
                s = _settings(cur)
                return _resp(200, {'vendor': s.get('vendor', {}), 'tariff': s.get('tariff', {})})

            if action == 'register':
                from_auth = body.get('auth') or {}
                email = (from_auth.get('email') or '').strip().lower()
                password = from_auth.get('password') or ''
                full_name = (from_auth.get('full_name') or '').strip()
                consent = body.get('consent') or {}
                if not (consent.get('offer') and consent.get('license') and consent.get('privacy') and consent.get('pd')):
                    return _resp(400, {'error': 'Нужно принять оферту, лицензионный договор, политику и дать согласие на обработку персональных данных'})
                if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
                    return _resp(400, {'error': 'Укажите корректный email для входа'})
                if len(password) < 8:
                    return _resp(400, {'error': 'Пароль — не менее 8 символов'})
                if len(full_name) < 5:
                    return _resp(400, {'error': 'Укажите ФИО пользователя'})
                org = _clean_org(body.get('org') or {}, ORG_FIELDS)
                err = _validate_org(org)
                if err:
                    return _resp(400, {'error': err})
                cur.execute(f'SELECT 1 FROM {_t("auth_users")} WHERE lower(email) = %s', (email,))
                if cur.fetchone():
                    return _resp(409, {'error': 'Пользователь с таким email уже зарегистрирован'})
                cur.execute(f"SELECT account_no FROM {_t('biz_organizations')} WHERE inn = %s AND status <> 'terminated'", (org['inn'],))
                dup = cur.fetchone()
                if dup:
                    return _resp(409, {'error': f'Организация с этим ИНН уже зарегистрирована (лицевой счёт {dup[0]}). Напишите на do@bizwor.ru'})
                import hashlib
                salt = secrets.token_hex(16)
                ph = f"{salt}${hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 150000).hex()}"
                org_id = 'org-' + uuidlib.uuid4().hex[:12]
                acc = _new_account(cur)
                consent_rec = {**{k: bool(consent.get(k)) for k in ('offer', 'license', 'privacy', 'pd')},
                               'at': datetime.utcnow().isoformat() + 'Z', 'ip': ip,
                               'ua': ((event.get('headers') or {}).get('User-Agent') or (event.get('headers') or {}).get('user-agent') or '')[:300]}
                rec = {**org, 'id': org_id, 'account_no': acc, 'status': 'pending', 'company_id': None,
                       'consent': json.dumps(consent_rec, ensure_ascii=False), 'created_ip': ip}
                cols = ', '.join(rec.keys())
                cur.execute(f'INSERT INTO {_t("biz_organizations")} ({cols}) VALUES ({", ".join(["%s"] * len(rec))})', list(rec.values()))
                user_id = str(uuidlib.uuid4())
                cur.execute(f'INSERT INTO {_t("auth_users")} (id, email, password_hash, is_admin, org_id) VALUES (%s, %s, %s, false, %s)',
                            (user_id, email, ph, org_id))
                cur.execute(f'UPDATE {_t("biz_organizations")} SET owner_name = %s WHERE id = %s', (full_name, org_id))
                cur.execute(f'SELECT * FROM {_t("biz_organizations")} WHERE id = %s', (org_id,))
                o = _one(cur)
                tariff = _settings(cur).get('tariff', {})
                price = float(tariff.get('price') or 1790)
                lic = _issue(cur, o, 'license_agreement', 'регистрация', months=12, amount=price)
                for t in REGISTER_DOCS[1:]:
                    _issue(cur, o, t, 'регистрация', base_id=lic['id'])
                _issue(cur, o, 'invoice', 'регистрация', months=1, amount=price, base_id=lic['id'])
                _audit(cur, email, org_id, 'register', {'inn': org['inn'], 'name': org['name'], 'account_no': acc, 'ip': ip})
                conn.commit()
                return _resp(200, {'ok': True, 'account_no': acc, 'org_id': org_id})

            token = _token(event, body)
            user = _user(cur, token)
            if not user:
                return _resp(401, {'error': 'Нужно войти в систему'})

            if action == 'my_license':
                o = _org_by_user(cur, user)
                state = _license_state(o)
                if user.get('is_biz_admin'):
                    state = {**state, 'allowed': True}
                docs = _docs_of(cur, o['id']) if o else []
                return _resp(200, {'org': _public_org(o) if o else None, 'license': state, 'documents': docs,
                                   'is_biz_admin': bool(user.get('is_biz_admin')), **{k: v for k, v in [('settings', _settings(cur))]}})

            if action == 'my_document':
                o = _org_by_user(cur, user)
                cur.execute(f'SELECT * FROM {_t("biz_documents")} WHERE id = %s AND org_id = %s', (body.get('id'), o['id'] if o else ''))
                d = _one(cur)
                return _resp(200 if d else 404, {'document': d} if d else {'error': 'Документ не найден'})

            if not user.get('is_biz_admin'):
                return _resp(403, {'error': 'Доступ только для администраторов БИЗ'})
            actor = user['email']

            if action == 'admin_overview':
                cur.execute(
                    f'SELECT o.*, (SELECT count(*) FROM {_t("auth_users")} u WHERE u.org_id = o.id) AS users_count, '
                    f'(SELECT count(*) FROM {_t("biz_documents")} d WHERE d.org_id = o.id) AS docs_count, '
                    f'(SELECT max(s.created_at) FROM {_t("auth_sessions")} s JOIN {_t("auth_users")} u ON u.id = s.user_id WHERE u.org_id = o.id) AS last_login '
                    f'FROM {_t("biz_organizations")} o ORDER BY o.created_at DESC')
                orgs = [_public_org(o) for o in _rows(cur)]
                cur.execute(f'SELECT d.*, o.name AS org_name, o.account_no FROM {_t("biz_documents")} d '
                            f'JOIN {_t("biz_organizations")} o ON o.id = d.org_id ORDER BY d.doc_date DESC, d.created_at DESC LIMIT 1000')
                docs = _rows(cur)
                cur.execute(f'SELECT * FROM {_t("biz_audit")} ORDER BY at DESC LIMIT 300')
                audit = _rows(cur)
                return _resp(200, {'organizations': orgs, 'documents': docs, 'audit': audit, 'settings': _settings(cur),
                                   'doc_types': DOC_TYPES})

            if action == 'admin_org':
                cur.execute(f'SELECT * FROM {_t("biz_organizations")} WHERE id = %s', (body.get('id'),))
                o = _one(cur)
                if not o:
                    return _resp(404, {'error': 'Организация не найдена'})
                cur.execute(f'SELECT u.id, u.email, u.created_at, u.is_biz_admin, p.full_name, p.role, '
                            f'(SELECT max(s.created_at) FROM {_t("auth_sessions")} s WHERE s.user_id = u.id) AS last_login '
                            f'FROM {_t("auth_users")} u LEFT JOIN {_t("profiles")} p ON p.user_id = u.id WHERE u.org_id = %s ORDER BY u.created_at', (o['id'],))
                users = _rows(cur)
                cur.execute(f'SELECT * FROM {_t("biz_audit")} WHERE org_id = %s ORDER BY at DESC LIMIT 200', (o['id'],))
                return _resp(200, {'org': o, 'users': users, 'documents': _docs_of(cur, o['id']), 'audit': _rows(cur)})

            if action == 'admin_save_org':
                oid = body.get('id')
                data = _clean_org(body.get('org') or {}, ADMIN_ORG_FIELDS)
                if not data:
                    return _resp(400, {'error': 'Нет данных'})
                sets = ', '.join(f'{k} = %s' for k in data) + ', updated_at = now()'
                cur.execute(f'UPDATE {_t("biz_organizations")} SET {sets} WHERE id = %s', [*data.values(), oid])
                _audit(cur, actor, oid, 'update_org', data)
                conn.commit()
                return _resp(200, {'ok': True})

            if action == 'admin_activate':
                oid = body.get('id')
                months = max(1, min(60, int(body.get('months') or 1)))
                cur.execute(f'SELECT * FROM {_t("biz_organizations")} WHERE id = %s', (oid,))
                o = _one(cur)
                if not o:
                    return _resp(404, {'error': 'Организация не найдена'})
                explicit = bool(body.get('start'))
                start = date.fromisoformat(body['start']) if explicit else date.today()
                cur_until = o.get('license_until')
                if not explicit and cur_until and cur_until >= start and o['status'] == 'active':
                    start = cur_until + timedelta(days=1)
                until = _add_months(start, months) - timedelta(days=1)
                ddate = start if explicit else None
                price = float(o.get('monthly_price') or 1790)
                lic = [d for d in _docs_of(cur, oid) if d['doc_type'] == 'license_agreement' and d['status'] != 'cancelled']
                base = lic[-1] if lic else _issue(cur, o, 'license_agreement', actor, months=12, amount=price, doc_date=ddate)
                issued = []
                for t in body.get('docs') or ACTIVATE_DOCS:
                    if t in DOC_TYPES and t != 'license_agreement':
                        issued.append(_issue(cur, o, t, actor, months=months, amount=price * months, period_from=start, base_id=base['id'], doc_date=ddate)['number'])
                cur.execute(f"UPDATE {_t('biz_organizations')} SET status = 'active', license_until = %s, updated_at = now() WHERE id = %s", (until, oid))

                if lic:
                    cur.execute(f"UPDATE {_t('biz_documents')} SET status = 'signed', signed_at = COALESCE(signed_at, now()) WHERE id = %s", (base['id'],))
                _audit(cur, actor, oid, 'activate', {'months': months, 'from': start, 'until': until, 'docs': issued})
                conn.commit()
                ws_error = _provision_safe(oid) if oid != _tenant.MAIN_ORG else ''
                return _resp(200, {'ok': True, 'license_until': until, 'issued': issued, 'workspace_error': ws_error})

            if action == 'admin_set_status':
                oid, st = body.get('id'), body.get('status')
                if st not in STATUSES:
                    return _resp(400, {'error': 'Неизвестный статус'})
                cur.execute(f'UPDATE {_t("biz_organizations")} SET status = %s, updated_at = now() WHERE id = %s', (st, oid))
                if st in ('blocked', 'terminated', 'suspended'):
                    cur.execute(f'DELETE FROM {_t("auth_sessions")} WHERE user_id IN (SELECT id FROM {_t("auth_users")} WHERE org_id = %s AND is_biz_admin = false)', (oid,))
                _audit(cur, actor, oid, 'set_status', {'status': st, 'reason': body.get('reason') or ''})
                conn.commit()
                return _resp(200, {'ok': True})

            if action == 'admin_issue':
                cur.execute(f'SELECT * FROM {_t("biz_organizations")} WHERE id = %s', (body.get('org_id'),))
                o = _one(cur)
                t = body.get('doc_type')
                if not o or t not in DOC_TYPES:
                    return _resp(400, {'error': 'Неверные данные'})
                months = max(0, min(60, int(body.get('months') or 0)))
                price = float(o.get('monthly_price') or 1790)
                amount = float(body['amount']) if body.get('amount') not in (None, '') else price * max(1, months)
                pf = date.fromisoformat(body['period_from']) if body.get('period_from') else None
                dd = date.fromisoformat(body['doc_date']) if body.get('doc_date') else None
                extra = {}
                if t in EXTRA_KEYS:
                    pn = str(body.get('print_no') or '').strip().upper().translate(str.maketrans('ABEKMHOPCTXY', 'АВЕКМНОРСТХУ'))
                    if pn and not re.match(r'^[А-ЯЁA-Z]\d{6}$', pn):
                        return _resp(400, {'error': 'Номер отпечатка: 1 буква и 6 цифр, например А123456'})
                    ex = body.get('extra') if isinstance(body.get('extra'), dict) else {}
                    extra = {k: str(ex.get(k) or '').strip()[:300] for k in EXTRA_KEYS[t]}
                    extra['print_no'] = pn
                    if t == 'skud_access':
                        extra['person_name'] = str(body.get('person_name') or '').strip()[:200]
                    if t != 'skud_access':
                        months, pf = 0, None
                    elif not pf and o.get('license_until'):
                        lu = o['license_until']
                        pf = date.today()
                        months = max(1, (lu.year - pf.year) * 12 + lu.month - pf.month + (1 if lu.day >= pf.day else 0))
                    amount = 0.0
                elif t.startswith('access_'):
                    extra = {'person_name': str(body.get('person_name') or '')[:200], 'person_email': str(body.get('person_email') or '')[:200]}
                    if not pf and o.get('license_until'):
                        lu = o['license_until']
                        pf = date.today()
                        months = max(1, (lu.year - pf.year) * 12 + lu.month - pf.month + (1 if lu.day >= pf.day else 0))
                    amount = 0.0
                d = _issue(cur, o, t, actor, months=months, amount=amount, period_from=pf, base_id=body.get('base_id') or '', doc_date=dd, extra=extra)
                conn.commit()
                return _resp(200, {'ok': True, 'number': d['number'], 'id': d['id']})

            if action == 'admin_doc_status':
                st = body.get('status')
                if st not in ('issued', 'sent', 'signed', 'paid', 'cancelled'):
                    return _resp(400, {'error': 'Неизвестный статус'})
                cur.execute(f'UPDATE {_t("biz_documents")} SET status = %s, note = COALESCE(%s, note), '
                            f"signed_at = CASE WHEN %s IN ('signed','paid') THEN COALESCE(signed_at, now()) ELSE signed_at END "
                            f'WHERE id = %s RETURNING org_id, number', (st, body.get('note'), st, body.get('id')))
                r = cur.fetchone()
                if r:
                    _audit(cur, actor, r[0], 'doc_status', {'number': r[1], 'status': st})
                conn.commit()
                return _resp(200, {'ok': True})

            if action == 'admin_provision':
                err = _provision_safe(str(body.get('id') or ''))
                _audit(cur, actor, str(body.get('id') or ''), 'provision', {'error': err})
                conn.commit()
                return _resp(200 if not err else 500, {'ok': not err, 'error': err or None})

            if action == 'admin_sync_schemas':
                c2 = psycopg2.connect(os.environ['DATABASE_URL'])
                try:
                    with c2.cursor() as cur2:
                        res = _tenant.sync_all(cur2)
                    c2.commit()
                finally:
                    c2.close()
                return _resp(200, {'ok': True, 'result': res})

            if action == 'admin_doc_delete':
                did = body.get('id')
                cur.execute(f'SELECT org_id, number, doc_type, status FROM {_t("biz_documents")} WHERE id = %s', (did,))
                r = cur.fetchone()
                if not r:
                    return _resp(404, {'error': 'Документ не найден'})
                if r[3] in ('signed', 'paid') and not body.get('force'):
                    return _resp(409, {'error': 'Документ подписан или оплачен. Для бухгалтерского учёта такие документы рекомендуется аннулировать, а не удалять. Подтвердите удаление ещё раз.', 'need_force': True})
                cur.execute(f'DELETE FROM {_t("biz_documents")} WHERE id = %s', (did,))
                _audit(cur, actor, r[0], 'doc_delete', {'number': r[1], 'type': r[2], 'status': r[3], 'reason': str(body.get('reason') or '')[:300]})
                conn.commit()
                return _resp(200, {'ok': True})

            if action == 'admin_org_people':
                cur.execute(f'SELECT data_schema FROM {_t("biz_organizations")} WHERE id = %s', (body.get('id'),))
                r = cur.fetchone()
                schema = (r[0] if r and r[0] else _tenant.MAIN)
                try:
                    cur.execute(f'SELECT p.full_name, p.email, p.role FROM "{schema}".profiles p '
                                f"WHERE p.role IN ('director','deputy_director','senior_employee') AND COALESCE(p.status,'active') <> 'moved' "
                                f'ORDER BY p.role, p.full_name')
                    people = [{'full_name': x[0], 'email': x[1], 'role': x[2]} for x in cur.fetchall()]
                except Exception:
                    conn.rollback()
                    people = []
                return _resp(200, {'people': people})

            if action == 'admin_doc_save':
                did = body.get('id')
                cur.execute(f'SELECT org_id, number FROM {_t("biz_documents")} WHERE id = %s', (did,))
                cur_doc = cur.fetchone()
                if not cur_doc:
                    return _resp(404, {'error': 'Документ не найден'})
                upd: Dict[str, Any] = {}
                if 'custom_html' in body:
                    html = str(body.get('custom_html') or '')
                    if len(html) > 400000:
                        return _resp(400, {'error': 'Документ слишком большой'})
                    upd['custom_html'] = html
                num = str(body.get('number') or '').strip()
                if num and num != cur_doc[1]:
                    cur.execute(f'SELECT 1 FROM {_t("biz_documents")} WHERE number = %s AND id <> %s', (num, did))
                    if cur.fetchone():
                        return _resp(409, {'error': f'Номер {num} уже занят другим документом'})
                    upd['number'] = num[:60]
                for k in ('doc_date', 'period_from', 'period_to'):
                    if k in body:
                        upd[k] = body.get(k) or None
                if upd.get('doc_date') is None and 'doc_date' in upd:
                    upd.pop('doc_date')
                if 'amount' in body and body.get('amount') not in (None, ''):
                    upd['amount'] = float(body['amount'])
                if 'months' in body and body.get('months') not in (None, ''):
                    upd['months'] = int(body['months'])
                for k in ('title', 'note'):
                    if k in body:
                        upd[k] = str(body.get(k) or '')[:500]
                if not upd:
                    return _resp(400, {'error': 'Нет изменений'})
                sets = ', '.join(f'{k} = %s' for k in upd) + ', edited_at = now(), edited_by = %s'
                cur.execute(f'UPDATE {_t("biz_documents")} SET {sets} WHERE id = %s', [*upd.values(), actor, did])
                _audit(cur, actor, cur_doc[0], 'doc_edit', {'number': upd.get('number', cur_doc[1]), 'fields': [k for k in upd if k != 'custom_html'] + (['текст'] if 'custom_html' in upd else [])})
                conn.commit()
                return _resp(200, {'ok': True})

            if action == 'admin_doc_refresh':
                did = body.get('id')
                cur.execute(f'SELECT d.snapshot, d.org_id, d.number FROM {_t("biz_documents")} d WHERE d.id = %s', (did,))
                r = cur.fetchone()
                if not r:
                    return _resp(404, {'error': 'Документ не найден'})
                cur.execute(f'SELECT * FROM {_t("biz_organizations")} WHERE id = %s', (r[1],))
                o = _one(cur)
                st = _settings(cur)
                snap = dict(r[0] or {})
                snap.update({'vendor': st.get('vendor', {}), 'tariff': st.get('tariff', {}),
                             'org': {k: o.get(k) for k in ORG_FIELDS + ['account_no', 'users_limit']}})
                cur.execute(f'UPDATE {_t("biz_documents")} SET snapshot = %s, edited_at = now(), edited_by = %s WHERE id = %s',
                            (json.dumps(snap, ensure_ascii=False, default=_json_default), actor, did))
                _audit(cur, actor, r[1], 'doc_refresh', {'number': r[2]})
                conn.commit()
                return _resp(200, {'ok': True})

            if action == 'admin_document':
                cur.execute(f'SELECT * FROM {_t("biz_documents")} WHERE id = %s', (body.get('id'),))
                d = _one(cur)
                return _resp(200 if d else 404, {'document': d} if d else {'error': 'Документ не найден'})

            if action == 'admin_save_settings':
                for key in ('vendor', 'tariff'):
                    if isinstance(body.get(key), dict):
                        cur.execute(f'INSERT INTO {_t("biz_settings")} (key, value) VALUES (%s, %s) '
                                    f'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
                                    (key, json.dumps(body[key], ensure_ascii=False)))
                        _audit(cur, actor, '', 'settings', {'key': key})
                conn.commit()
                return _resp(200, {'ok': True})

            if action == 'admin_set_biz_admin':
                cur.execute(f'UPDATE {_t("auth_users")} SET is_biz_admin = %s WHERE id = %s RETURNING email, org_id',
                            (bool(body.get('value')), body.get('user_id')))
                r = cur.fetchone()
                if r:
                    _audit(cur, actor, r[1], 'biz_admin', {'email': r[0], 'value': bool(body.get('value'))})
                conn.commit()
                return _resp(200, {'ok': True})

            return _resp(400, {'error': f'Неизвестное действие: {action}'})
    finally:
        conn.close()
