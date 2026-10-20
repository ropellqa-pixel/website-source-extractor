"""
Перенос базы АнодБИЗ со старого сервера в вашу базу PostgreSQL на Beget.

Запуск (из папки ~/api.bizwor.ru):
    ./venv/bin/python migrate_db.py            — перенести всё (если в базе пусто)
    ./venv/bin/python migrate_db.py --force    — удалить таблицы АнодБИЗ в новой базе и перенести заново

Данные берутся напрямую со старого сервера по ключу MIGRATE_KEY из .env.
Ключи СберБизнеса перешифровываются под ваш SBER_VAULT_KEY — банк подключать заново не нужно.
Ссылки на файлы старого хранилища меняются на S3_PUBLIC_URL.
"""
import os
import re
import sys
import time

import psycopg2
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORT_URL = 'https://functions.poehali.dev/d67752b4-262e-44d3-820b-ae7d8d055069'
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


def export(body):
    for attempt in range(5):
        try:
            r = requests.post(EXPORT_URL, json=body, timeout=60, headers={'X-Export-Key': os.environ['MIGRATE_KEY']})
            if r.status_code == 200:
                return r.json()
            print('  старый сервер ответил', r.status_code, r.text[:200])
            if r.status_code in (400, 403):
                sys.exit(1)
        except requests.RequestException as e:
            print('  нет связи со старым сервером:', e)
        time.sleep(3 * (attempt + 1))
    sys.exit('Не удалось получить данные со старого сервера')


def main():
    load_env(os.path.join(HERE, '.env'))
    for k in ('DATABASE_URL', 'MIGRATE_KEY', 'SBER_VAULT_KEY'):
        if not os.environ.get(k):
            sys.exit(f'В файле .env не задан {k}')
    if len(os.environ['SBER_VAULT_KEY']) < 16:
        sys.exit('SBER_VAULT_KEY должен быть не короче 16 символов')
    schema = os.environ.get('MAIN_DB_SCHEMA') or 'public'
    if not re.fullmatch(r'[a-z_][a-z0-9_]*', schema):
        sys.exit('Неверное имя схемы: ' + schema)
    force = '--force' in sys.argv
    public_url = (os.environ.get('S3_PUBLIC_URL') or '').rstrip('/')

    pre = open(os.path.join(HERE, 'schema', 'tables.sql'), encoding='utf-8').read()
    post = open(os.path.join(HERE, 'schema', 'indexes.sql'), encoding='utf-8').read()

    info = export({'action': 'schema'})
    tables = info['tables']
    print('На старом сервере таблиц:', len(tables))

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    cur = conn.cursor()
    cur.execute('SELECT version()')
    print('Новая база:', cur.fetchone()[0].split(',')[0])
    cur.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
    cur.execute(f'SET search_path = "{schema}"')
    cur.execute('SELECT table_name FROM information_schema.tables WHERE table_schema = %s', (schema,))
    existing = {r[0] for r in cur.fetchall()} & set(tables)
    if existing and not force:
        sys.exit(f'В новой базе уже есть таблицы АнодБИЗ ({len(existing)}). Чтобы перенести заново — добавьте --force.')
    for t in sorted(existing):
        cur.execute(f'DROP TABLE IF EXISTS "{t}" CASCADE')
    cur.execute("SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = %s", (schema,))
    for (s,) in cur.fetchall():
        if s.endswith('_id_seq') and s[:-7] in tables:
            cur.execute(f'DROP SEQUENCE IF EXISTS "{s}" CASCADE')

    cur.execute(pre)
    total = 0
    for t in tables:
        offset, n = 0, 0
        while offset is not None:
            page = export({'action': 'table', 'table': t, 'offset': offset, 'new_vault_key': os.environ['SBER_VAULT_KEY']})
            if page.get('error'):
                sys.exit(f'{t}: {page["error"]}')
            for q in page['sql']:
                if public_url:
                    q = q.replace(OLD_CDN, public_url)
                cur.execute(q)
            n += len(page['sql'])
            offset = page.get('next')
        total += n
        print(f'  {t}: {n}')
    cur.execute(post)

    cur.execute("SELECT s.relname, t.relname, a.attname FROM pg_class s JOIN pg_namespace ns ON ns.oid = s.relnamespace "
                "JOIN pg_depend d ON d.objid = s.oid AND d.deptype = 'a' JOIN pg_class t ON t.oid = d.refobjid "
                "JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid "
                "WHERE s.relkind = 'S' AND ns.nspname = %s", (schema,))
    for seq, table, col in cur.fetchall():
        cur.execute(f'SELECT setval(%s, COALESCE((SELECT MAX("{col}") FROM "{table}"), 0) + 1, false)', (seq,))
    conn.commit()

    print(f'Готово: перенесено таблиц {len(tables)}, строк {total}.')
    for t in ('profiles', 'auth_users', 'salary_data', 'acc_entries'):
        cur.execute(f'SELECT count(*) FROM "{t}"')
        print(f'  проверка {t}: {cur.fetchone()[0]}')
    conn.close()


if __name__ == '__main__':
    main()
