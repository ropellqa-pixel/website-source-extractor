import base64
import json
from datetime import date, datetime
from typing import Any, Callable, Dict

import sber

PRODUCTS = {
    'company': {'title': 'Компаниям', 'app': '2907011706_Company'},
    'b2bsaas': {'title': 'Платформам', 'app': '2907011706_B2BSaaS'},
    'holding': {'title': 'Холдингам', 'app': '2907011706_HOLDING'},
    'sbbid': {'title': 'СберБизнес ID', 'app': '2907011706_SBBID'},
}
SECRET_FIELDS = ('client_id', 'client_secret')


def _load(cur, schema: str) -> Dict[str, Any]:
    cur.execute(f"SELECT value FROM {schema}.app_settings WHERE key = 'sber_products'")
    r = cur.fetchone()
    v = (r[0] if isinstance(r[0], dict) else json.loads(r[0])) if r else {}
    return v if isinstance(v, dict) else {}


def _save(cur, schema: str, v: Dict[str, Any], who: str) -> None:
    cur.execute(f"INSERT INTO {schema}.app_settings (key, value, updated_by) VALUES ('sber_products', %s, %s) "
                f'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()',
                (json.dumps(v, ensure_ascii=False), who))


def overview(cur, schema: str, vault_get: Callable) -> Dict[str, Any]:
    saved = _load(cur, schema)
    out = []
    for code, meta in PRODUCTS.items():
        p = saved.get(code) or {}
        out.append({
            'code': code, 'title': meta['title'], 'app': meta['app'],
            'active': bool(p.get('active', True)),
            'scope': p.get('scope') or '',
            'redirect_uri': p.get('redirect_uri') or '',
            'cert': p.get('cert'),
            'configured': {f: bool(vault_get(cur, f'p:{code}:{f}')) for f in SECRET_FIELDS},
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
        if 'scope' in body:
            p['scope'] = ' '.join(str(body.get('scope') or '').replace(',', ' ').split())[:2000]
        if 'redirect_uri' in body:
            p['redirect_uri'] = str(body.get('redirect_uri') or '').strip()[:500]
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
        cur.execute(f"DELETE FROM {schema}.sber_vault WHERE key IN (%s, %s)", (f'p:{code}:client_id', f'p:{code}:client_secret'))
        log(cur, user, f'Sber API «{title}»: ключи удалены', '')
    else:
        raise sber.SberError('Неизвестное действие')

    p['updated_at'] = datetime.now().isoformat(timespec='seconds')
    p['updated_by'] = user['name']
    saved[code] = p
    _save(cur, schema, saved, user['name'])
    return overview(cur, schema, vault_get)
