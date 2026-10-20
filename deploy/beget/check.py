"""Проверка настроек сервера АнодБИЗ: функции, база, хранилище."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
for line in open(os.path.join(HERE, '.env'), encoding='utf-8'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

import app  # noqa: E402

total = len([d for d in os.listdir(os.path.join(HERE, 'backend')) if os.path.isfile(os.path.join(HERE, 'backend', d, 'index.py'))])
print(f'Функций загружено: {len(app.HANDLERS)} из {total}')

import psycopg2  # noqa: E402
try:
    c = psycopg2.connect(os.environ['DATABASE_URL'], connect_timeout=10)
    cur = c.cursor()
    cur.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema = %s", (os.environ.get('MAIN_DB_SCHEMA') or 'public',))
    print('База: подключение есть, таблиц:', cur.fetchone()[0])
    c.close()
except Exception as e:
    print('База: НЕТ подключения —', str(e).strip().splitlines()[0])

import boto3  # noqa: E402
try:
    s3 = boto3.client('s3', endpoint_url=os.environ['S3_ENDPOINT'], region_name=os.environ.get('S3_REGION') or None,
                      aws_access_key_id=os.environ['S3_ACCESS_KEY'], aws_secret_access_key=os.environ['S3_SECRET_KEY'])
    s3.put_object(Bucket=os.environ['S3_BUCKET'], Key='check/ok.txt', Body=b'ok', ContentType='text/plain')
    import requests
    r = requests.get(os.environ['S3_PUBLIC_URL'].rstrip('/') + '/check/ok.txt', timeout=15)
    print('Хранилище: запись есть,', 'файлы открываются по ссылке' if r.status_code == 200 else f'НО файлы по ссылке не открываются ({r.status_code}) — бакет нужно сделать публичным на чтение')
except Exception as e:
    print('Хранилище: ОШИБКА —', str(e).strip().splitlines()[0][:200])

for k in ('SBER_VAULT_KEY', 'MIGRATE_KEY', 'VK_GROUP_TOKEN', 'SBER_CLIENT_ID'):
    print(f'{k}:', 'задан' if os.environ.get(k) else 'пусто')
