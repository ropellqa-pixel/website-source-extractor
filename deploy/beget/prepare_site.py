"""
Очистка собранного сайта от служебных скриптов прежней платформы.

Запуск:  python3 prepare_site.py public_html
- убирает служебные скрипты, метку автора и чужой счётчик Метрики из index.html;
- скачивает иконку и картинку для соцсетей на ваш хостинг и меняет ссылки на них.
"""
import os
import re
import sys

import requests

ICON = 'https://cdn.poehali.dev/projects/451dcdd9-845e-4f12-82d1-0501056cd61b/files/favicon-1790446602264.jpg'
OG = 'https://cdn.poehali.dev/projects/451dcdd9-845e-4f12-82d1-0501056cd61b/files/og-image-1791114521100.png'
SITE = 'https://bizwor.ru'
API = 'https://bizwor.ru/api'
HTACCESS = '''Options -Indexes
DirectoryIndex index.html
<IfModule mod_rewrite.c>
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]
</IfModule>
<IfModule mod_headers.c>
<FilesMatch "index\\.html$">
Header set Cache-Control "no-cache"
</FilesMatch>
</IfModule>
'''
FUNCTIONS = {
    '2685bd53-f16f-4cc2-9db7-1c023c825cdb': 'sber-api',
    'b105a470-7b26-48ea-8129-af36d5557d4e': 'admin-api',
    '00b79d7d-cf52-4550-8ab2-7eea1f41c991': 'accounting-api',
    '150e30dd-bd2d-45c5-8db8-a4055bf55fd9': 'skud-api',
    'f01f3da3-3368-428a-919d-fe5933bc5ab8': 'device-control',
    '246cb9d5-b997-40d1-8f46-082cafe7879e': 'cameras-api',
    '0cc75331-123f-465b-a6da-01ba5f142bfa': 'auth-api',
    'e40aca0d-1c72-49c0-84a1-cf57b44984ec': 'data-api',
    '5250ef3b-f3ae-4031-9d3c-2ca46f38a8bc': 'file-upload',
    'ac301249-d3c3-47ba-bf45-516a862afcb6': 'vk-webhook',
    '8052b0a3-f890-4e4c-a096-d88bf48724e0': 'vk-api',
    'ac29b336-1607-4440-b864-0aaee5c432b1': 'biz-api',
}


def fetch(url, dest):
    if os.path.isfile(dest):
        return True
    try:
        r = requests.get(url, timeout=60)
        if r.status_code == 200:
            open(dest, 'wb').write(r.content)
            return True
    except Exception:
        pass
    return False


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else 'public_html'
    path = os.path.join(root, 'index.html')
    html = open(path, encoding='utf-8').read()

    html = re.sub(r'\s*<!-- IMPORTANT: DO NOT REMOVE[^>]*-->', '', html)
    html = re.sub(r'\s*<script[^>]+cdn\.poehali\.dev/intertnal[^>]*></script>', '', html)
    html = re.sub(r'\s*<meta name="pp-name"[^>]*>', '', html)
    html = re.sub(r'\s*<meta name="author" content="poehali\.dev"\s*/?>', '', html)
    html = re.sub(r'\s*<!-- Yandex\.Metrika counter -->.*?<!-- /Yandex\.Metrika counter -->', '', html, flags=re.S)

    if fetch(ICON, os.path.join(root, 'favicon.jpg')):
        html = html.replace(ICON, '/favicon.jpg')
    if fetch(OG, os.path.join(root, 'og-image.png')):
        html = html.replace(OG, SITE + '/og-image.png')

    open(path, 'w', encoding='utf-8').write(html)
    open(os.path.join(root, '.htaccess'), 'w').write(HTACCESS)
    left = re.findall(r'[^"\'\s]*poehali[^"\'\s]*', html)
    print('index.html очищен.' if not left else 'Остались ссылки: ' + ', '.join(left))

    fixed, left = 0, []
    for dp, _, files in os.walk(root):
        for f in files:
            if not f.endswith(('.js', '.css', '.html', '.json')):
                continue
            p = os.path.join(dp, f)
            text = open(p, encoding='utf-8', errors='ignore').read()
            if 'poehali.dev' not in text:
                continue
            new = re.sub(r'"migrate-export":`https://functions\.poehali\.dev/[0-9a-f-]+`,', '', text)
            for fid, name in FUNCTIONS.items():
                new = new.replace(f'https://functions.poehali.dev/{fid}', f'{API}/{name}')
            if new != text:
                open(p, 'w', encoding='utf-8').write(new)
                fixed += 1
            if 'poehali.dev' in new:
                left.append(f)
    print('Адреса сервера заменены на api.bizwor.ru в файлах:', fixed)
    if left:
        print('ВНИМАНИЕ, ещё есть упоминания в:', ', '.join(left))


if __name__ == '__main__':
    main()
