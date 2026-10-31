"""
АнодБИЗ — единый сервер для хостинга Beget (Passenger / WSGI).

Все серверные функции проекта (backend/<имя>/index.py) работают внутри одного
приложения без изменений: запрос https://api.bizwor.ru/<имя> превращается в тот же
event, что давала облачная платформа, и передаётся в handler(event, context).
Всё остальное (страницы сайта) отдаётся из public_html/index.html.
"""
import base64
import importlib.util
import json
import mimetypes
import os
import sys
import time
import traceback
import uuid
from urllib.parse import parse_qsl

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.environ.get('ANOD_BACKEND_DIR') or os.path.join(ROOT, 'backend')
PUBLIC_DIR = os.environ.get('ANOD_PUBLIC_DIR') or os.path.join(ROOT, 'public_html')
REQUEST_TIMEOUT_MS = int(os.environ.get('ANOD_TIMEOUT_MS') or 30000)
MAX_BODY = 60 * 1024 * 1024
VERSION = '36.26'

STATUS_TEXT = {
    200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found',
    304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 413: 'Payload Too Large',
    422: 'Unprocessable Entity', 429: 'Too Many Requests', 500: 'Internal Server Error',
    502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
}


def _load_functions():
    handlers = {}
    if not os.path.isdir(BACKEND_DIR):
        return handlers
    for name in sorted(os.listdir(BACKEND_DIR)):
        fdir = os.path.join(BACKEND_DIR, name)
        entry = os.path.join(fdir, 'index.py')
        if not os.path.isfile(entry):
            continue
        local = [f[:-3] for f in os.listdir(fdir) if f.endswith('.py') and f != 'index.py']
        for m in local:
            sys.modules.pop(m, None)
        sys.path.insert(0, fdir)
        try:
            spec = importlib.util.spec_from_file_location('anod_fn_' + name.replace('-', '_'), entry)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            handlers[name] = mod.handler
        except Exception:
            print('[anodbiz] не удалось загрузить функцию', name, file=sys.stderr)
            traceback.print_exc()
        finally:
            sys.path.remove(fdir)
            if fdir not in sys.path:
                sys.path.append(fdir)
    return handlers


HANDLERS = _load_functions()


class Context:
    def __init__(self, name):
        self.request_id = uuid.uuid4().hex
        self.function_name = name
        self.memory_limit_in_mb = 512
        self._deadline = time.time() + REQUEST_TIMEOUT_MS / 1000.0

    def get_remaining_time_in_millis(self):
        return max(0, int((self._deadline - time.time()) * 1000))


def _canonical(header):
    return '-'.join(p.capitalize() for p in header.split('-'))


def _headers(environ):
    out = {}
    for k, v in environ.items():
        if k.startswith('HTTP_'):
            name = _canonical(k[5:].replace('_', '-'))
        elif k in ('CONTENT_TYPE', 'CONTENT_LENGTH'):
            name = _canonical(k.replace('_', '-'))
        else:
            continue
        if v == '':
            continue
        out[name] = v
    if 'Authorization' in out and 'X-Authorization' not in out:
        out['X-Authorization'] = out['Authorization']
    if 'Cookie' in out and 'X-Cookie' not in out:
        out['X-Cookie'] = out['Cookie']
    for k in list(out):
        out.setdefault(k.lower(), out[k])
    return out


def _client_ip(environ):
    fwd = environ.get('HTTP_X_FORWARDED_FOR') or environ.get('HTTP_X_REAL_IP') or ''
    return fwd.split(',')[0].strip() or environ.get('REMOTE_ADDR', '')


def _read_body(environ):
    try:
        length = int(environ.get('CONTENT_LENGTH') or 0)
    except ValueError:
        length = 0
    if length <= 0:
        return b''
    return environ['wsgi.input'].read(min(length, MAX_BODY))


def _json(start_response, status, payload):
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    start_response(f'{status} {STATUS_TEXT.get(status, "")}', [
        ('Content-Type', 'application/json; charset=utf-8'),
        ('Access-Control-Allow-Origin', '*'),
        ('Content-Length', str(len(data))),
    ])
    return [data]


def _call_function(name, environ, start_response):
    handler = HANDLERS.get(name)
    if handler is None:
        return _json(start_response, 404, {'error': f'Функция {name} не найдена'})
    raw = _read_body(environ)
    try:
        body, is_b64 = raw.decode('utf-8'), False
    except UnicodeDecodeError:
        body, is_b64 = base64.b64encode(raw).decode('ascii'), True
    qs = dict(parse_qsl(environ.get('QUERY_STRING', ''), keep_blank_values=True))
    ip = _client_ip(environ)
    event = {
        'httpMethod': environ.get('REQUEST_METHOD', 'GET').upper(),
        'headers': _headers(environ),
        'queryStringParameters': qs,
        'body': body,
        'isBase64Encoded': is_b64,
        'path': environ.get('PATH_INFO', '/'),
        'requestContext': {'requestId': uuid.uuid4().hex, 'identity': {'sourceIp': ip}, 'httpMethod': environ.get('REQUEST_METHOD', 'GET').upper()},
    }
    try:
        result = handler(event, Context(name)) or {}
    except Exception as ex:
        print(f'[anodbiz] ошибка в функции {name}:', file=sys.stderr)
        traceback.print_exc()
        return _json(start_response, 500, {'error': 'Внутренняя ошибка сервера', 'detail': str(ex)[:300]})

    if not isinstance(result, dict):
        result = {'statusCode': 200, 'body': json.dumps(result, ensure_ascii=False, default=str)}
    status = int(result.get('statusCode') or 200)
    out_body = result.get('body', '')
    if result.get('isBase64Encoded'):
        data = base64.b64decode(out_body or '')
    elif isinstance(out_body, (bytes, bytearray)):
        data = bytes(out_body)
    elif isinstance(out_body, str):
        data = out_body.encode('utf-8')
    else:
        data = json.dumps(out_body, ensure_ascii=False, default=str).encode('utf-8')

    headers = []
    seen = set()
    for k, v in (result.get('headers') or {}).items():
        key = 'Set-Cookie' if k.lower() == 'x-set-cookie' else k
        if key.lower() == 'content-length':
            continue
        headers.append((key, str(v)))
        seen.add(key.lower())
    for k, values in (result.get('multiValueHeaders') or {}).items():
        key = 'Set-Cookie' if k.lower() == 'x-set-cookie' else k
        for v in values or []:
            headers.append((key, str(v)))
            seen.add(key.lower())
    if 'access-control-allow-origin' not in seen:
        headers.append(('Access-Control-Allow-Origin', '*'))
    if 'content-type' not in seen:
        headers.append(('Content-Type', 'application/json; charset=utf-8'))
    headers.append(('Content-Length', str(len(data))))
    start_response(f'{status} {STATUS_TEXT.get(status, "")}', headers)
    return [data]


def _serve_static(path, start_response):
    rel = os.path.normpath(path.lstrip('/'))
    if rel.startswith('..'):
        rel = ''
    full = os.path.join(PUBLIC_DIR, rel)
    if not rel or rel == '.' or not os.path.isfile(full):
        full = os.path.join(PUBLIC_DIR, 'index.html')
    if not os.path.isfile(full):
        return _json(start_response, 404, {'error': 'Сайт ещё не загружен в public_html'})
    with open(full, 'rb') as fh:
        data = fh.read()
    ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
    if ctype.startswith('text/') or ctype in ('application/javascript', 'application/json'):
        ctype += '; charset=utf-8'
    cache = 'no-cache' if full.endswith('index.html') else 'public, max-age=31536000'
    start_response('200 OK', [('Content-Type', ctype), ('Content-Length', str(len(data))), ('Cache-Control', cache)])
    return [data]


def application(environ, start_response):
    path = environ.get('PATH_INFO', '/') or '/'
    rest = path[5:] if path.startswith('/api/') else path
    name = rest.strip('/').split('/')[0]
    if name == 'health':
        return _json(start_response, 200, {'ok': True, 'version': VERSION, 'functions': sorted(HANDLERS)})
    if name in HANDLERS:
        return _call_function(name, environ, start_response)
    if path.startswith('/api/'):
        return _json(start_response, 404, {'error': f'Функция {name} не найдена'})
    return _serve_static(path, start_response)
