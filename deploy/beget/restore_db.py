"""
Загрузка выгрузки АнодБИЗ в вашу базу PostgreSQL на Beget.

Запуск:  python3 restore_db.py anodbiz-db.sql.enc
Строку подключения берёт из файла .env (DATABASE_URL), схему — MAIN_DB_SCHEMA (по умолчанию public).
Имя старой схемы в выгрузке автоматически заменяется на вашу.
Ссылки на файлы старого хранилища заменяются на S3_PUBLIC_URL (если задан).
"""
import os
import re
import sys

import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
OLD_SCHEMA = 't_p59581145_website_source_extra'
OLD_CDN = 'https://cdn.poehali.dev/projects/451dcdd9-845e-4f12-82d1-0501056cd61b/bucket'


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
        print('Укажите файл выгрузки: python3 restore_db.py anodbiz-db.sql.enc')
        sys.exit(1)
    dsn = os.environ.get('DATABASE_URL')
    if not dsn:
        print('В файле .env не задан DATABASE_URL')
        sys.exit(1)
    schema = os.environ.get('MAIN_DB_SCHEMA') or 'public'
    if not re.fullmatch(r'[a-z_][a-z0-9_]*', schema):
        print('Неверное имя схемы:', schema)
        sys.exit(1)

    sql = read_dump(sys.argv[1])
    sql = sql.replace(f'"{OLD_SCHEMA}"', f'"{schema}"').replace(OLD_SCHEMA, schema)
    public_url = (os.environ.get('S3_PUBLIC_URL') or '').rstrip('/')
    if public_url:
        sql = sql.replace(OLD_CDN, public_url)

    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute('SELECT version()')
    print('База:', cur.fetchone()[0].split(',')[0])
    cur.execute('SELECT count(*) FROM information_schema.tables WHERE table_schema = %s', (schema,))
    existing = cur.fetchone()[0]
    if existing and '--force' not in sys.argv:
        print(f'В схеме {schema} уже есть таблицы ({existing}). Чтобы загрузить поверх — добавьте --force.')
        sys.exit(1)
    print(f'Загружаю в схему {schema}...')
    cur.execute(sql)
    cur.execute('SELECT count(*) FROM information_schema.tables WHERE table_schema = %s', (schema,))
    print('Готово. Таблиц в базе:', cur.fetchone()[0])
    for t in ('profiles', 'auth_users', 'schedule_data', 'acc_entries'):
        try:
            cur.execute(f'SELECT count(*) FROM "{schema}"."{t}"')
            print(f'  {t}: {cur.fetchone()[0]} строк')
        except Exception:
            pass
    conn.close()


if __name__ == '__main__':
    main()
