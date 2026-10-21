#!/bin/bash
# Подключает сервер АБИЗ к сайту по адресу https://bizwor.ru/api/... через маленький PHP-переходник.
# Сам сервер остаётся на api.bizwor.ru, браузер ходит только на bizwor.ru (там рабочий сертификат).
# Запуск:  bash ~/upd/link_site.sh
set -e
SITE_DIR="$HOME/bizwor.ru"
PUB="$SITE_DIR/public_html"
SRC="$(cd "$(dirname "$0")" && pwd)"

[ -d "$PUB" ] || { echo "Не найдена папка $PUB"; exit 1; }

rm -f "$SITE_DIR/passenger_wsgi.py" "$SITE_DIR/.htaccess"
[ -L "$SITE_DIR/public" ] && rm -f "$SITE_DIR/public"

mkdir -p "$PUB/api"
cp "$SRC/api_proxy.php" "$PUB/api/index.php"
chmod 644 "$PUB/api/index.php"
chmod 755 "$PUB/api"
rm -f "$PUB/api/.htaccess"

cat > "$PUB/.htaccess" <<'EOF'
Options -Indexes
DirectoryIndex index.html index.php
<IfModule mod_rewrite.c>
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
RewriteRule ^api/index\.php$ - [L]
RewriteRule ^api(/.*)?$ api/index.php [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]
</IfModule>
<IfModule mod_headers.c>
<FilesMatch "index\.html$">
Header set Cache-Control "no-cache"
</FilesMatch>
</IfModule>
EOF

sleep 2
echo "Проверка:"
curl -s -w "  [код %{http_code}]" https://bizwor.ru/api/health | head -c 400 || true
echo
