"""
Перенос файлов (документы, видео СКУД, ffmpeg для программы АБИЗ) в ваше хранилище S3 Beget.

Запуск:  python3 migrate_files.py anodbiz-db.sql.enc
Берёт из выгрузки все ссылки на старое хранилище, скачивает файлы и кладёт
в ваш бакет с тем же путём. Повторный запуск пропускает уже перенесённые файлы.
"""
import os
import re
import sys

import boto3
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
OLD_CDN = 'https://cdn.poehali.dev/projects/451dcdd9-845e-4f12-82d1-0501056cd61b/bucket'
FFMPEG = 'skud/tools/ffmpeg-9.0.2.zip'
FFMPEG_PARTS = 37


def load_env(path):
    if not os.path.isfile(path):
        return
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def read_dump(path):
    if not path.endswith('.enc'):
        return open(path, encoding='utf-8').read()
    import base64
    import getpass
    import hashlib
    from cryptography.fernet import Fernet, InvalidToken
    pw = os.environ.get('DUMP_PASSWORD') or getpass.getpass('Пароль от выгрузки: ')
    key = base64.urlsafe_b64encode(hashlib.sha256(('anodbiz-dump:' + pw).encode()).digest())
    try:
        return Fernet(key).decrypt(open(path, 'rb').read()).decode('utf-8')
    except InvalidToken:
        print('Неверный пароль от выгрузки')
        sys.exit(1)


def main():
    load_env(os.path.join(HERE, '.env'))
    if len(sys.argv) < 2:
        print('Укажите файл выгрузки: python3 migrate_files.py anodbiz-db.sql.enc')
        sys.exit(1)
    for k in ('S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET'):
        if not os.environ.get(k):
            print('В файле .env не задан', k)
            sys.exit(1)
    s3 = boto3.client('s3', endpoint_url=os.environ['S3_ENDPOINT'], region_name=os.environ.get('S3_REGION') or None,
                      aws_access_key_id=os.environ['S3_ACCESS_KEY'], aws_secret_access_key=os.environ['S3_SECRET_KEY'])
    bucket = os.environ['S3_BUCKET']

    sql = read_dump(sys.argv[1])
    keys = sorted(set(re.findall(re.escape(OLD_CDN) + r"/([^'\"\s,)]+)", sql)))
    keys += [f'{FFMPEG}.part{i:04d}' for i in range(FFMPEG_PARTS)]
    print('Файлов к переносу:', len(keys))

    ok = skipped = failed = 0
    for key in keys:
        try:
            s3.head_object(Bucket=bucket, Key=key)
            skipped += 1
            continue
        except Exception:
            pass
        r = requests.get(f'{OLD_CDN}/{key}', timeout=120)
        if r.status_code != 200:
            print(f'  нет файла ({r.status_code}): {key}')
            failed += 1
            continue
        s3.put_object(Bucket=bucket, Key=key, Body=r.content,
                      ContentType=r.headers.get('Content-Type') or 'application/octet-stream')
        ok += 1
        print(f'  ок: {key} ({len(r.content) // 1024} КБ)')
    print(f'Готово: перенесено {ok}, уже было {skipped}, не найдено {failed}')


if __name__ == '__main__':
    main()
