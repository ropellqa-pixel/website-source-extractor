import base64
import json
import os
import uuid as uuidlib
from typing import Any, Dict

import boto3

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
}

BUCKET = 'files'


def _resp(status: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        'statusCode': status,
        'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
        'body': json.dumps(payload, ensure_ascii=False),
    }


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    '''Загружает файл (документ из базы документов) в S3-совместимое хранилище и
    возвращает публичную CDN-ссылку. Заменяет прежнее хранение файлов как base64 в браузере.'''
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': ''}

    if event.get('httpMethod') != 'POST':
        return _resp(405, {'error': 'Используйте POST'})

    try:
        body = json.loads(event.get('body') or '{}')
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
