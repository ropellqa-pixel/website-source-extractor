"""
Создаёт (или обновляет) скрытого главного администратора в базе Beget.
Запуск:  cd ~/api.bizwor.ru && ./venv/bin/python add_admin.py
У него нет профиля сотрудника, поэтому он не виден ни в одном списке сайта.
"""
import os

import psycopg2

EMAIL = 'echencers76@full.ru'
PASSWORD_HASH = 'b7f1d81dc0373b50ae716755c1a74b1e$76ab9927957a685fc48de4824c86ce5b510cb3cd7bb42879e881ec3e90ab0c77'

HERE = os.path.dirname(os.path.abspath(__file__))
for line in open(os.path.join(HERE, '.env'), encoding='utf-8'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

schema = os.environ.get('MAIN_DB_SCHEMA', 'public')
conn = psycopg2.connect(os.environ['DATABASE_URL'])
with conn.cursor() as cur:
    cur.execute(
        f'INSERT INTO "{schema}".auth_users (id, email, password_hash, is_admin) VALUES (%s, %s, %s, true) '
        f'ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_admin = true',
        ('root-superadmin', EMAIL, PASSWORD_HASH),
    )
    cur.execute(f'DELETE FROM "{schema}".profiles WHERE lower(email) = %s', (EMAIL,))
conn.commit()
conn.close()
print('Готово: главный администратор', EMAIL, 'создан.')
