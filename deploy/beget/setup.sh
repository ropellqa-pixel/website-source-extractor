#!/bin/bash
# АнодБИЗ — установка сервера на хостинге Beget.
# Запуск из папки сайта:  cd ~/bizwor.ru && bash setup.sh
set -e
SITE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SITE_DIR"

PY=""
for c in python3.12 python3.11 python3.10 python3.9 python3; do
  if command -v "$c" >/dev/null 2>&1; then
    if "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)'; then PY="$c"; break; fi
  fi
done
if [ -z "$PY" ]; then
  echo "Не найден Python 3.8 или новее. Пришлите мне вывод команды: ls /usr/bin/python3*"
  exit 1
fi
echo "Python: $($PY --version)"

if [ ! -d venv ]; then
  "$PY" -m venv venv
fi
./venv/bin/pip install -q --upgrade pip
./venv/bin/pip install -q -r requirements.txt
echo "Библиотеки установлены."

mkdir -p public_html tmp
[ -e public ] || ln -s public_html public
for f in .htaccess public_html/.htaccess; do
  printf 'PassengerEnabled On\nPassengerPython %s/venv/bin/python3\n' "$SITE_DIR" > "$f"
done

if [ ! -f .env ]; then
  cp env.example .env
  chmod 600 .env
  echo "Создан файл .env — заполните его (nano .env) и запустите setup.sh ещё раз."
  exit 0
fi
chmod 600 .env

./venv/bin/python - <<'EOF'
import os, sys
sys.path.insert(0, '.')
for line in open('.env', encoding='utf-8'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
import app
print('Функций загружено:', len(app.HANDLERS), 'из', len([d for d in os.listdir('backend') if os.path.isfile(os.path.join('backend', d, 'index.py'))]))
import psycopg2
try:
    c = psycopg2.connect(os.environ['DATABASE_URL']); c.close(); print('База: подключение есть')
except Exception as e:
    print('База: НЕТ подключения —', str(e).strip().splitlines()[0])
EOF

touch tmp/restart.txt
echo "Готово. Проверка: https://bizwor.ru/api/health"