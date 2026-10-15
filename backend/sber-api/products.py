import base64
import json
import os
from datetime import date, datetime
from typing import Any, Callable, Dict

import sber

MAIN = 'b2bsaas'
PRODUCTS = {
    'b2bsaas': {'title': 'Платформам', 'app': '2907011706_B2BSaaS'},
    'pay': {'title': 'Моментальные платежи', 'app': '2907011706_PAY'},
    'company': {'title': 'Компаниям', 'app': '2907011706_Company'},
    'holding': {'title': 'Холдингам', 'app': '2907011706_HOLDING'},
    'sbbid': {'title': 'СберБизнес ID', 'app': '2907011706_SBBID'},
}
SECRET_FIELDS = ('client_secret',)
TEXT_FIELDS = ('client_id', 'redirect_uri', 'back_url')
SCOPE_FIELDS = ('scope', 'scope_v1', 'scope_v2')


def _load(cur, schema: str) -> Dict[str, Any]:
    cur.execute(f"SELECT value FROM {schema}.app_settings WHERE key = 'sber_products'")
    r = cur.fetchone()
    v = (r[0] if isinstance(r[0], dict) else json.loads(r[0])) if r else {}
    return v if isinstance(v, dict) else {}


def _save(cur, schema: str, v: Dict[str, Any], who: str) -> None:
    cur.execute(f"INSERT INTO {schema}.app_settings (key, value, updated_by) VALUES ('sber_products', %s, %s) "
                f'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()',
                (json.dumps(v, ensure_ascii=False), who))


def _migrate(cur, schema: str, saved: Dict[str, Any], vault_get: Callable, vault_set: Callable) -> bool:
    changed = False
    for code, p in saved.items():
        if not p.get('client_id'):
            old = vault_get(cur, f'p:{code}:client_id')
            if old:
                p['client_id'] = old
                changed = True
    if 'pay' not in saved:
        cur.execute(f"SELECT value FROM {schema}.app_settings WHERE key = 'sber'")
        r = cur.fetchone()
        old = (r[0] if isinstance(r[0], dict) else json.loads(r[0])) if r else {}
        p = {'active': True}
        for f in ('scope', 'scope_v1', 'scope_v2', 'cert'):
            if old.get(f):
                p[f] = old[f]
        for f in ('client_id', 'redirect_uri'):
            v = (os.environ.get('SBER_' + f.upper()) or '').strip()
            if v:
                p[f] = v
        for k in ('cert_p12', 'cert_password'):
            v = vault_get(cur, k)
            if v is not None:
                vault_set(cur, f'p:pay:{k}', v)
        sec = (os.environ.get('SBER_CLIENT_SECRET') or '').strip()
        if sec:
            vault_set(cur, 'p:pay:client_secret', sec)
        saved['pay'] = p
        changed = True
    return changed


def ensure(cur, schema: str, vault_get: Callable, vault_set: Callable) -> None:
    saved = _load(cur, schema)
    if _migrate(cur, schema, saved, vault_get, vault_set):
        _save(cur, schema, saved, 'Система')


def _config(cur, saved: Dict[str, Any], code: str, vault_get: Callable) -> Dict[str, Any]:
    p = saved.get(code) or {}
    raw = vault_get(cur, f'p:{code}:cert_p12')
    return {**p, 'code': code, 'client_secret': vault_get(cur, f'p:{code}:client_secret') or '',
            'cert_p12': base64.b64decode(raw) if raw else None, 'cert_password': vault_get(cur, f'p:{code}:cert_password') or ''}


def main_config(cur, schema: str, vault_get: Callable) -> Dict[str, Any]:
    saved = _load(cur, schema)
    m = _config(cur, saved, MAIN, vault_get)
    if m.get('client_id') and m['client_secret'] and m['cert_p12']:
        return m
    return _config(cur, saved, 'pay', vault_get)


def overview(cur, schema: str, vault_get: Callable) -> Dict[str, Any]:
    saved = _load(cur, schema)
    in_use = main_config(cur, schema, vault_get)['code']
    out = []
    for code, meta in PRODUCTS.items():
        p = saved.get(code) or {}
        out.append({
            'code': code, 'title': meta['title'], 'app': meta['app'],
            'active': bool(p.get('active', True)),
            'main': code == MAIN, 'in_use': code == in_use,
            **{f: p.get(f) or '' for f in TEXT_FIELDS + SCOPE_FIELDS},
            'cert': p.get('cert'),
            'configured': {'client_id': bool(p.get('client_id')), 'client_secret': bool(vault_get(cur, f'p:{code}:client_secret'))},
            'updated_at': p.get('updated_at'), 'updated_by': p.get('updated_by'),
        })
    return {'products': out}


def handle(cur, schema: str, user: Dict[str, Any], action: str, body: Dict[str, Any],
           vault_get: Callable, vault_set: Callable, log: Callable) -> Dict[str, Any]:
    if action == 'products':
        return overview(cur, schema, vault_get)
    code = str(body.get('code') or '')
    if code not in PRODUCTS:
        raise sber.SberError('Неизвестный раздел Sber API')
    if not user['is_deputy']:
        raise PermissionError('Настройки меняет только заместитель директора')
    saved = _load(cur, schema)
    p = saved.get(code) or {}
    title = PRODUCTS[code]['title']

    if action == 'product_save':
        if 'active' in body:
            p['active'] = bool(body['active'])
        for f in SCOPE_FIELDS:
            if f in body:
                p[f] = ' '.join(str(body.get(f) or '').replace(',', ' ').split())[:2000]
        for f in TEXT_FIELDS:
            if f in body:
                v = str(body.get(f) or '').strip()[:500]
                if v and f != 'client_id' and not v.startswith('https://'):
                    raise sber.SberError('Адрес должен начинаться с https://')
                p[f] = v
        for f in SECRET_FIELDS:
            val = str(body.get(f) or '').strip()
            if val:
                vault_set(cur, f'p:{code}:{f}', val)
        log(cur, user, f'Sber API «{title}»: настройки', '')
    elif action == 'product_cert_upload':
        name = str(body.get('file_name') or '')
        if not name.lower().endswith(('.p12', '.pfx')):
            raise sber.SberError('Нужен файл сертификата .p12 или .pfx')
        try:
            raw = base64.b64decode(str(body.get('file') or '').split(',', 1)[-1], validate=True)
        except Exception:
            raise sber.SberError('Файл повреждён')
        if not 100 < len(raw) < 50000:
            raise sber.SberError('Файл не похож на сертификат')
        password = str(body.get('password') or '')
        info = sber.inspect_cert(raw, password)
        if info['valid_to'] < date.today().isoformat():
            raise sber.SberError(f"Сертификат уже истёк ({info['valid_to']}) — загрузите новый")
        vault_set(cur, f'p:{code}:cert_p12', base64.b64encode(raw).decode())
        vault_set(cur, f'p:{code}:cert_password', password)
        p['cert'] = {**info, 'file_name': name[:120], 'uploaded_at': datetime.now().isoformat(timespec='seconds'),
                     'uploaded_by': user['name']}
        log(cur, user, f'Sber API «{title}»: сертификат загружен', f"{info['subject']} до {info['valid_to']}")
    elif action == 'product_cert_delete':
        cur.execute(f"DELETE FROM {schema}.sber_vault WHERE key IN (%s, %s)", (f'p:{code}:cert_p12', f'p:{code}:cert_password'))
        p.pop('cert', None)
        log(cur, user, f'Sber API «{title}»: сертификат удалён', '')
    elif action == 'product_keys_delete':
        cur.execute(f"DELETE FROM {schema}.sber_vault WHERE key IN (%s, %s)", (f'p:{code}:client_secret', f'p:{code}:client_id'))
        p.pop('client_id', None)
        log(cur, user, f'Sber API «{title}»: ключи удалены', '')
    else:
        raise sber.SberError('Неизвестное действие')

    p['updated_at'] = datetime.now().isoformat(timespec='seconds')
    p['updated_by'] = user['name']
    saved[code] = p
    _save(cur, schema, saved, user['name'])
    return overview(cur, schema, vault_get)
