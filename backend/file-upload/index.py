import base64
import json
import os
import uuid as uuidlib
from typing import Any, Dict, Optional

import boto3
import psycopg2

SCHEMA = os.environ.get('MAIN_DB_SCHEMA', 'public')

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Authorization',
    'Access-Control-Max-Age': '86400',
}

BUCKET = 'files'


def _resp(status: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        'statusCode': status,
        'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
        'body': json.dumps(payload, ensure_ascii=False),
    }


def _extract_token(event: Dict[str, Any], body: Dict[str, Any]) -> str:
    headers = event.get('headers') or {}
    token = headers.get('X-Authorization') or headers.get('x-authorization') or body.get('token') or ''
    if token.startswith('Bearer '):
        token = token[7:]
    return token.strip()


def _authenticate(token: str) -> Optional[str]:
    """Проверяет сессию сайта или постоянный API-токен десктоп-приложения.
    Возвращает user_id или None, если токен невалиден."""
    if not token:
        return None
    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        with conn.cursor() as cur:
            cur.execute(
                f'SELECT user_id FROM {SCHEMA}.auth_sessions WHERE token = %s AND expires_at > now()',
                (token,),
            )
            row = cur.fetchone()
            if row:
                return row[0]
            cur.execute(
                f'SELECT user_id FROM {SCHEMA}.api_tokens WHERE token = %s AND revoked_at IS NULL',
                (token,),
            )
            row = cur.fetchone()
            if row:
                cur.execute(f'UPDATE {SCHEMA}.api_tokens SET last_used_at = now() WHERE token = %s', (token,))
                conn.commit()
                return row[0]
            return None
    finally:
        conn.close()


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Загружает файл (документ из базы документов) в S3-совместимое хранилище и
    возвращает публичную CDN-ссылку. Доступ только для авторизованных запросов: сессия
    сайта либо постоянный API-токен десктоп-приложения (заголовок X-Authorization).'''
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    if event.get('httpMethod') != 'POST':
        return _resp(405, {'error': 'Используйте POST'})

    try:
        body = json.loads(event.get('body') or '{}')

        token = _extract_token(event, body)
        if not _authenticate(token):
            return _resp(401, {'error': 'Не авторизован: нужен действующий токен входа'})

        file_base64 = body.get('file_base64', '')
        file_name = body.get('file_name', 'file')
        content_type = body.get('content_type', 'application/octet-stream')
        folder = body.get('folder', 'documents')

        if ',' in file_base64:
            file_base64 = file_base64.split(',', 1)[1]
        file_bytes = base64.b64decode(file_base64)

        ext = ''
        if '.' in file_name:
            ext = '.' + file_name.rsplit('.', 1)[-1]
        key = f'{folder}/{uuidlib.uuid4()}{ext}'

        s3 = boto3.client(
            's3',
            endpoint_url='https://bucket.poehali.dev',
            aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
            aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
        )
        s3.put_object(Bucket=BUCKET, Key=key, Body=file_bytes, ContentType=content_type)

        cdn_url = f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"
        return _resp(200, {'url': cdn_url})
    except Exception as e:
        return _resp(500, {'error': str(e)})
