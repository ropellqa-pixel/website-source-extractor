#!/bin/bash
# АнодБИЗ 36.20 — установка сервера api.bizwor.ru на хостинге Beget.
# Запуск:  cd ~/api.bizwor.ru && bash setup.sh
set -e
SITE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SITE_DIR"

PY=""
for c in python3.12 python3.11 python3.10 python3.9 python3.8 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)'; then PY="$c"; break; fi
done
[ -z "$PY" ] && { echo "Не найден Python 3.8+. Пришлите Юре вывод: ls /usr/bin/python3*"; exit 1; }
echo "Python: $($PY --version)"

[ -d venv ] || "$PY" -m venv venv
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

./venv/bin/python check.py
touch tmp/restart.txt
echo "Готово. Проверка в браузере: https://api.bizwor.ru/health"
