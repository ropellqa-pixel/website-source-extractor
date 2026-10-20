#!/bin/bash
# Подключает сервер АБИЗ прямо к сайту bizwor.ru по адресу https://bizwor.ru/api/...
# Тогда отдельный сертификат для api.bizwor.ru не нужен — работает сертификат bizwor.ru.
# Запуск:  bash ~/upd/link_site.sh
set -e
API_DIR="$HOME/api.bizwor.ru"
SITE_DIR="$HOME/bizwor.ru"
PUB="$SITE_DIR/public_html"
PY="$API_DIR/venv/bin/python3"

[ -x "$PY" ] || { echo "Не найден $PY — сначала должен быть установлен сервер api.bizwor.ru"; exit 1; }
[ -d "$PUB" ] || { echo "Не найдена папка $PUB"; exit 1; }

cat > "$SITE_DIR/passenger_wsgi.py" <<EOF
import os
import sys

API_DIR = '$API_DIR'
os.environ['ANOD_PUBLIC_DIR'] = '$PUB'
os.environ.setdefault('ANOD_BACKEND_DIR', os.path.join(API_DIR, 'backend'))
sys.path.insert(0, API_DIR)
env_file = os.path.join(API_DIR, '.env')
if os.path.isfile(env_file):
    for line in open(env_file, encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

from app import application  # noqa: E402,F401
EOF

mkdir -p "$SITE_DIR/tmp"
[ -e "$SITE_DIR/public" ] || ln -s public_html "$SITE_DIR/public"

HT='PassengerEnabled On
PassengerPython '"$PY"'
Options -Indexes
DirectoryIndex index.html
<IfModule mod_rewrite.c>
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
RewriteCond %{REQUEST_URI} !^/api/
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]
</IfModule>
<IfModule mod_headers.c>
<FilesMatch "index\.html$">
Header set Cache-Control "no-cache"
</FilesMatch>
</IfModule>'
printf '%s\n' "$HT" > "$PUB/.htaccess"
printf 'PassengerEnabled On\nPassengerPython %s\n' "$PY" > "$SITE_DIR/.htaccess"

touch "$SITE_DIR/tmp/restart.txt"
sleep 3
echo "Проверка:"
curl -s https://bizwor.ru/api/health || true
echo
