import os
import sys

import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
for line in open(os.path.join(HERE, '.env'), encoding='utf-8'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
schema = os.environ.get('MAIN_DB_SCHEMA') or 'public'
conn = psycopg2.connect(os.environ['DATABASE_URL'])
conn.autocommit = True
cur = conn.cursor()
cur.execute(f'SET search_path = "{schema}"')
for path in sys.argv[1:]:
    cur.execute(open(path, encoding='utf-8').read())
    print('Применено:', os.path.basename(path))
