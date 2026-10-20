"""
Перенос файлов (документы, видео СКУД, ffmpeg для программы АБИЗ) в хранилище S3 Beget.

Запуск после migrate_db.py:  ./venv/bin/python migrate_files.py
Находит в новой базе все ссылки на файлы, скачивает их со старого хранилища и кладёт
в ваш бакет с тем же путём. Повторный запуск пропускает уже перенесённые файлы.
"""
import os
import re
import sys

import boto3
import psycopg2
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
OLD_CDN = 'https://cdn.poehali.dev/projects/451dcdd9-845e-4f12-82d1-0501056cd61b/bucket'
FFMPEG = 'skud/tools/ffmpeg-9.0.2.zip'
FFMPEG_PARTS = 37


def load_env(path):
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main():
    load_env(os.path.join(HERE, '.env'))
    for k in ('DATABASE_URL', 'S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET', 'S3_PUBLIC_URL'):
        if not os.environ.get(k):
            sys.exit('В файле .env не задан ' + k)
    public = os.environ['S3_PUBLIC_URL'].rstrip('/')
    schema = os.environ.get('MAIN_DB_SCHEMA') or 'public'

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    cur = conn.cursor()
    cur.execute("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = %s "
                "AND data_type IN ('text', 'character varying', 'jsonb')", (schema,))
    keys = set()
    pat = re.compile(re.escape(public) + r"/([A-Za-z0-9_\-./]+)")
    for t, c in cur.fetchall():
        cur.execute(f'SELECT "{c}"::text FROM "{schema}"."{t}" WHERE "{c}"::text LIKE %s', ('%' + public + '/%',))
        for (v,) in cur.fetchall():
            keys.update(k.rstrip('.') for k in pat.findall(v or ''))
    conn.close()
    keys = sorted(keys) + [f'{FFMPEG}.part{i:04d}' for i in range(FFMPEG_PARTS)]
    print('Файлов к переносу:', len(keys))

    s3 = boto3.client('s3', endpoint_url=os.environ['S3_ENDPOINT'], region_name=os.environ.get('S3_REGION') or None,
                      aws_access_key_id=os.environ['S3_ACCESS_KEY'], aws_secret_access_key=os.environ['S3_SECRET_KEY'])
    bucket = os.environ['S3_BUCKET']
    ok = skipped = failed = 0
    for key in keys:
        try:
            s3.head_object(Bucket=bucket, Key=key)
            skipped += 1
            continue
        except Exception:
            pass
        try:
            r = requests.get(f'{OLD_CDN}/{key}', timeout=180)
        except requests.RequestException as e:
            print('  ошибка сети:', key, e)
            failed += 1
            continue
        if r.status_code != 200:
            print(f'  нет на старом хранилище ({r.status_code}): {key}')
            failed += 1
            continue
        s3.put_object(Bucket=bucket, Key=key, Body=r.content,
                      ContentType=r.headers.get('Content-Type') or 'application/octet-stream')
        ok += 1
        print(f'  ок: {key} ({len(r.content) // 1024} КБ)')
    print(f'Готово: перенесено {ok}, уже было {skipped}, не найдено {failed}')


if __name__ == '__main__':
    main()
