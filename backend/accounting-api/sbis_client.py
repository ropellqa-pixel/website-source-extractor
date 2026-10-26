"""Клиент API Saby (СБИС) Retail/Presto: сервисная авторизация и продажи по точкам."""
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

AUTH_URL = 'https://online.sbis.ru/oauth/service/'
API = 'https://api.sbis.ru/retail'
PAGE = 100
PAUSE = 1.25


class SbisError(Exception):
    pass


class RateLimit(SbisError):
    pass


def _http(url: str, data: Optional[bytes] = None, headers: Optional[Dict[str, str]] = None, timeout: int = 15) -> Tuple[int, Any]:
    req = urllib.request.Request(url, data=data, headers=headers or {}, method='POST' if data is not None else 'GET')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode('utf-8', 'ignore')
            return r.status, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'ignore')
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {'error': raw[:300]}
    except Exception as e:
        raise SbisError(f'Нет связи с СБИС: {e}')


def login(client_id: str, app_secret: str, secret_key: str) -> str:
    body = json.dumps({'app_client_id': client_id, 'app_secret': app_secret, 'secret_key': secret_key}).encode()
    code, j = _http(AUTH_URL, body, {'Content-Type': 'application/json; charset=utf-8'})
    token = (j or {}).get('token') or (j or {}).get('access_token')
    if code != 200 or not token:
        msg = (j or {}).get('error') or (j or {}).get('message') or f'код {code}'
        if isinstance(msg, dict):
            msg = msg.get('message') or json.dumps(msg, ensure_ascii=False)
        raise SbisError(f'СБИС не принял ключи приложения: {str(msg)[:200]}')
    return token


class Client:
    def __init__(self, token: str):
        self.token = token
        self.last = 0.0
        self.calls = 0

    def get(self, path: str, params: Dict[str, Any]) -> Dict[str, Any]:
        wait = PAUSE - (time.time() - self.last)
        if self.calls and wait > 0:
            time.sleep(wait)
        self.last = time.time()
        self.calls += 1
        q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        code, j = _http(f'{API}{path}?{q}', None, {'X-SBISAccessToken': self.token})
        if code == 429:
            raise RateLimit('СБИС ограничил частоту запросов, продолжим через минуту')
        if code == 401:
            raise SbisError('auth')
        if code != 200:
            msg = (j or {}).get('error') or (j or {}).get('message') or ''
            if isinstance(msg, dict):
                msg = msg.get('message') or json.dumps(msg, ensure_ascii=False)
            raise SbisError(f'СБИС ответил {code}: {str(msg)[:200]}')
        return j or {}

    def points(self) -> List[Dict[str, Any]]:
        j = self.get('/point/list', {'pageSize': 500, 'page': 0})
        return [{'id': p.get('id'), 'name': p.get('name') or p.get('companyName') or f"Точка {p.get('id')}",
                 'address': p.get('address') or ''} for p in (j.get('salesPoints') or [])]

    def orders(self, point_id: int, d_from: str, d_to: str, page: int) -> List[Dict[str, Any]]:
        j = self.get('/order/list', {'pointId': point_id, 'fromDateTime': f'{d_from} 00:00:00',
                                     'toDateTime': f'{d_to} 23:59:59', 'page': page, 'pageSize': PAGE})
        return j.get('orders') or []


def _n(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def order_sums(o: Dict[str, Any]) -> Dict[str, float]:
    """Суммы продажи по видам оплаты. Возврат — с минусом."""
    pays = o.get('Payments') or []
    s = {'cash': 0.0, 'bank': 0.0, 'certificate': 0.0, 'salary': 0.0}
    for p in pays:
        s['cash'] += _n(p.get('CashSum') if p.get('CashSum') is not None else p.get('PayCash'))
        s['bank'] += _n(p.get('BankSum') if p.get('BankSum') is not None else p.get('PayBank'))
        s['certificate'] += _n(p.get('CertificateSum') if p.get('CertificateSum') is not None else p.get('PayCertificate'))
        s['salary'] += _n(p.get('SalarySum') if p.get('SalarySum') is not None else p.get('PaySalary'))
    if not pays:
        s['cash'] = _n(o.get('TotalPrice'))
    if o.get('Return'):
        s = {k: -abs(v) for k, v in s.items()}
    return s


def order_day(o: Dict[str, Any]) -> str:
    for k in ('DateWTZ', 'ClosedWTZ', 'OpenedWTZ'):
        v = str(o.get(k) or '')
        if len(v) >= 10:
            return v[:10]
    return ''
