"""Клиент СберБизнес API (Sber API для юрлиц): OAuth 2.0 + mTLS-сертификат организации.
Все ключи — только в секретах проекта; токены банка хранятся в БД зашифрованными."""
import base64
import hashlib
import json
import os
import secrets
import tempfile
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote, urlencode

import requests
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat, pkcs12

PROD_API = 'https://fintech.sberbank.ru:9443'
PROD_AUTH = 'https://fintech.sberbank.ru:9443'
TEST_API = 'https://iftfintech.testsbi.sberbank.ru:9443'
TEST_AUTH = 'https://iftfintech.testsbi.sberbank.ru:9443'


class SberError(Exception):
    pass


def _env(name: str) -> str:
    return (os.environ.get(name) or '').strip()


_cert_p12: Optional[bytes] = None
_cert_pass: str = ''


def set_cert(p12: Optional[bytes], password: str) -> None:
    global _cert_p12, _cert_pass, _cert_files
    if p12 != _cert_p12 or password != _cert_pass:
        _cert_files = None
    _cert_p12, _cert_pass = p12, password or ''


def configured() -> Dict[str, bool]:
    return {
        'client_id': bool(_env('SBER_CLIENT_ID')),
        'client_secret': bool(_env('SBER_CLIENT_SECRET')),
        'certificate': bool(_cert_p12),
    }


def inspect_cert(p12: bytes, password: str) -> Dict[str, Any]:
    """Проверка файла сертификата: открывается ли паролем, кому выдан, до какого числа действует."""
    try:
        key, cert, _ = pkcs12.load_key_and_certificates(p12, (password or '').encode() or None)
    except Exception:
        raise SberError('Не удалось открыть файл: неверный пароль или это не сертификат .p12/.pfx')
    if not key or not cert:
        raise SberError('В файле нет закрытого ключа или сертификата — выгрузите сертификат вместе с ключом')
    def attr(name, oid):
        try:
            return cert.subject.get_attributes_for_oid(oid)[0].value
        except IndexError:
            return ''
    from cryptography.x509.oid import NameOID
    valid_to = getattr(cert, 'not_valid_after_utc', None) or cert.not_valid_after
    valid_from = getattr(cert, 'not_valid_before_utc', None) or cert.not_valid_before
    return {'subject': attr('cn', NameOID.COMMON_NAME), 'org': attr('o', NameOID.ORGANIZATION_NAME),
            'serial': format(cert.serial_number, 'x')[-12:], 'valid_from': valid_from.date().isoformat(),
            'valid_to': valid_to.date().isoformat()}


def is_test() -> bool:
    return _env('SBER_ENV').lower() in ('test', 'ift', 'sandbox')


def api_base() -> str:
    return TEST_API if is_test() else PROD_API


def auth_base() -> str:
    return TEST_AUTH if is_test() else PROD_AUTH


def _fernet() -> Fernet:
    seed = _env('SBER_VAULT_KEY') or _env('AWS_SECRET_ACCESS_KEY')
    if not seed:
        raise SberError('Не настроено шифрование хранилища')
    key = hashlib.sha256(('sber-vault-v2:' + seed).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt(text: str) -> str:
    return _fernet().encrypt(text.encode()).decode()


def decrypt(token: str) -> Optional[str]:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except Exception:
        return None


_cert_files: Optional[Tuple[str, str]] = None


def diagnose() -> List[Dict[str, Any]]:
    """Пошаговая проверка: сертификат → TLS к банку → ответ банка на наш сертификат."""
    import socket
    import ssl
    steps: List[Dict[str, Any]] = []
    try:
        cp, kp = cert_files()
        info = inspect_cert(_cert_p12 or b'', _cert_pass)
        steps.append({'step': 'Сертификат организации', 'ok': True, 'text': f"{info['subject']}, до {info['valid_to']}"})
    except SberError as e:
        return [{'step': 'Сертификат организации', 'ok': False, 'text': str(e)}]
    host = api_base().split('//')[1].split(':')[0]
    try:
        ctx = ssl.create_default_context(cafile=_verify() if isinstance(_verify(), str) else None)
        ctx.load_cert_chain(cp, kp)
        with socket.create_connection((host, 9443), timeout=10) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as t:
                issuer = dict(x[0] for x in t.getpeercert()['issuer']).get('commonName')
        steps.append({'step': 'Соединение с банком', 'ok': True, 'text': f'{host}, сервер подтверждён ({issuer})'})
    except Exception as e:
        steps.append({'step': 'Соединение с банком', 'ok': False, 'text': str(e)[:200]})
        return steps
    try:
        r = requests.post(f'{auth_base()}/ic/sso/api/v2/oauth/token', cert=(cp, kp), verify=_verify(), timeout=15,
                          data={'grant_type': 'refresh_token', 'refresh_token': 'check', 'client_id': _env('SBER_CLIENT_ID'),
                                'client_secret': _env('SBER_CLIENT_SECRET')})
        body = r.text[:300]
        if 'No required SSL certificate' in body or 'SSL certificate' in body:
            steps.append({'step': 'Банк принял сертификат', 'ok': False, 'text': 'Банк не принял сертификат организации'})
        else:
            low = body.lower()
            bad_client = 'invalid_client' in low
            steps.append({'step': 'Банк принял сертификат', 'ok': True, 'text': f'ответ банка {r.status_code}'})
            steps.append({'step': 'Client ID и Client Secret', 'ok': not bad_client,
                          'text': 'банк их не узнал — проверьте секреты' if bad_client else 'банк их принял'})
    except requests.exceptions.SSLError as e:
        steps.append({'step': 'Банк принял сертификат', 'ok': False, 'text': str(e)[:200]})
    except requests.exceptions.RequestException as e:
        steps.append({'step': 'Банк принял сертификат', 'ok': False, 'text': f'нет ответа: {str(e)[:120]}'})
    return steps


def cert_files() -> Tuple[str, str]:
    """Сертификат организации (.p12/.pfx из СберБизнес) → временные PEM-файлы для mTLS."""
    global _cert_files
    if _cert_files and all(os.path.exists(p) for p in _cert_files):
        return _cert_files
    if not _cert_p12:
        raise SberError('Не загружен сертификат СберБизнес — замдиректора: Админ-панель → СберБизнес')
    try:
        key, cert, extra = pkcs12.load_key_and_certificates(_cert_p12, _cert_pass.encode() or None)
    except Exception:
        raise SberError('Не удалось открыть сертификат: проверьте файл и пароль от него')
    d = tempfile.mkdtemp(prefix='sber_')
    cp, kp = os.path.join(d, 'cert.pem'), os.path.join(d, 'key.pem')
    with open(cp, 'wb') as f:
        f.write(cert.public_bytes(Encoding.PEM))
        for c in extra or []:
            f.write(c.public_bytes(Encoding.PEM))
    with open(kp, 'wb') as f:
        f.write(key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()))
    os.chmod(kp, 0o600)
    _cert_files = (cp, kp)
    return _cert_files


def _verify() -> Any:
    ca = os.path.join(os.path.dirname(__file__), 'russian_trusted_ca.pem')
    return ca if os.path.exists(ca) else True


def _request(method: str, url: str, **kw) -> requests.Response:
    try:
        return requests.request(method, url, cert=cert_files(), verify=_verify(), timeout=kw.pop('timeout', 20), **kw)
    except requests.exceptions.SSLError as e:
        t = str(e).lower()
        if 'certificate verify failed' in t:
            raise SberError('Не удалось проверить сертификат сервера банка (цепочка доверенных сертификатов)')
        if 'unknown ca' in t or 'bad certificate' in t or 'certificate required' in t or 'alert' in t:
            raise SberError('Банк отклонил сертификат организации: загрузите сертификат, выпущенный для Sber API (.p12 из СберБизнес → Сертификаты)')
        raise SberError(f'Ошибка защищённого соединения с банком: {str(e)[:160]}')
    except requests.exceptions.RequestException:
        raise SberError('Банк не отвечает, попробуйте позже')


def sign_url(external_id: str, back_url: str = '') -> str:
    """Страница подписания черновика платёжки СМС-пользователем (документация Sber API)."""
    host = 'https://sbi-test.sberbank.ru' if is_test() else 'https://sbi.sberbank.ru:9443'
    url = f'{host}/ic/ufs/rpp-light/index.html#/payment-creator/{external_id}'
    return url + (f'?backUrl={quote(back_url, safe="")}' if back_url else '')


def authorize_url(state: str, nonce: str, scope: str) -> str:
    if not _env('SBER_REDIRECT_URI'):
        raise SberError('Для входа через СберБизнес нужен секрет SBER_REDIRECT_URI — или вставьте Access/Refresh Token в админ-панели')
    q = {'response_type': 'code', 'client_id': _env('SBER_CLIENT_ID'), 'redirect_uri': _env('SBER_REDIRECT_URI'),
         'scope': scope, 'state': state, 'nonce': nonce}
    host = 'https://efs-sbbol-ift-web.testsbi.sberbank.ru:9443' if is_test() else 'https://sbi.sberbank.ru:9443'
    return f'{host}/ic/sso/api/v2/oauth/authorize?{urlencode(q)}'


def _token_call(data: Dict[str, str]) -> Dict[str, Any]:
    data = {**data, 'client_id': _env('SBER_CLIENT_ID'), 'client_secret': _env('SBER_CLIENT_SECRET')}
    r = _request('POST', f'{auth_base()}/ic/sso/api/v2/oauth/token', data=data,
                 headers={'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json'})
    if r.status_code != 200:
        if 'SSL certificate' in r.text:
            raise SberError('Банк не принял сертификат организации — загрузите сертификат, выпущенный для Sber API')
        try:
            j = r.json()
            detail = j.get('error_description') or j.get('error') or j.get('message') or ''
        except ValueError:
            detail = r.text[:120]
        hint = {'invalid_client': 'неверный Client ID или Client Secret', 'invalid_grant': 'ключ устарел или уже использован — получите новый',
                'unauthorized_client': 'приложению не разрешён этот вход'}.get(str(detail).split()[0] if detail else '', '')
        raise SberError(f'Банк отказал ({r.status_code}): {hint or detail}'.strip())
    return r.json()


def exchange_code(code: str) -> Dict[str, Any]:
    return _token_call({'grant_type': 'authorization_code', 'code': code, 'redirect_uri': _env('SBER_REDIRECT_URI')})


def refresh(refresh_token: str) -> Dict[str, Any]:
    return _token_call({'grant_type': 'refresh_token', 'refresh_token': refresh_token})


def api(method: str, path: str, token: str, **kw) -> requests.Response:
    headers = {'Authorization': f'Bearer {token}', 'Accept': 'application/json', **kw.pop('headers', {})}
    r = _request(method, f'{api_base()}/fintech/api{path}', headers=headers, **kw)
    if r.status_code == 400 and 'SSL certificate' in r.text:
        raise SberError('Банк не принял сертификат организации — загрузите сертификат, выпущенный для Sber API')
    if r.status_code == 401:
        raise SberError('Банк не принял ключ доступа (Access Token) — обновите ключи подключения')
    return r


def new_external_id() -> str:
    return str(uuid.uuid4())


def new_state() -> Tuple[str, str]:
    return secrets.token_urlsafe(24), secrets.token_urlsafe(16)


def now() -> int:
    return int(time.time())


def payment_body(req: Dict[str, Any], payer_account: str, payer_name: str, payer_inn: str, payer_kpp: str,
                 external_id: str, doc_number: int, today: str) -> Dict[str, Any]:
    r = req['requisites']
    vat = req.get('vat_rate') or 'none'
    amount = float(req['amount'])
    if vat == 'none':
        vat_info = {'type': 'NO_VAT', 'amount': 0}
        purpose_vat = 'НДС не облагается'
    else:
        rate = float(vat)
        vat_amount = round(amount * rate / (100 + rate), 2)
        vat_info = {'type': 'INCLUDED', 'rate': str(int(rate)), 'amount': vat_amount}
        purpose_vat = f'В т.ч. НДС {int(rate)}% - {vat_amount:.2f} руб.'
    purpose = req['purpose'].strip()
    if 'ндс' not in purpose.lower():
        purpose = f'{purpose}. {purpose_vat}'
    return {
        'externalId': external_id, 'number': str(doc_number), 'date': today, 'amount': amount, 'operationCode': '01',
        'deliveryKind': 'электронно', 'priority': '5', 'purpose': purpose[:210], 'vat': vat_info,
        'payerName': payer_name, 'payerInn': payer_inn, 'payerKpp': payer_kpp or '0', 'payerAccount': payer_account,
        'payeeName': r['name'], 'payeeInn': r.get('inn') or '0', 'payeeKpp': r.get('kpp') or '0', 'payeeAccount': r['account'],
        'payeeBankBic': r['bic'], 'payeeBankCorrAccount': r.get('corr_account') or '',
    }


def check_account(account: str, bic: str) -> bool:
    """Контрольный ключ счёта по ЦБ (защита от опечаток в реквизитах)."""
    if not (len(account) == 20 and account.isdigit() and len(bic) == 9 and bic.isdigit()):
        return False
    weights = [7, 1, 3] * 8
    for prefix in (bic[-3:], '0' + bic[4:6]):
        s = prefix + account
        if sum(int(c) * w for c, w in zip(s, weights)) % 10 == 0:
            return True
    return False


def check_inn(inn: str) -> bool:
    if not inn.isdigit() or len(inn) not in (10, 12):
        return False
    d = [int(c) for c in inn]
    def ctrl(ws):
        return sum(a * b for a, b in zip(d, ws)) % 11 % 10
    if len(inn) == 10:
        return ctrl([2, 4, 10, 3, 5, 9, 4, 6, 8]) == d[9]
    return ctrl([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) == d[10] and ctrl([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) == d[11]


def requisites_hash(r: Dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps({k: r.get(k) or '' for k in ('name', 'inn', 'kpp', 'account', 'bic')},
                                     sort_keys=True, ensure_ascii=False).encode()).hexdigest()
