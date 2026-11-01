"""Делает сайт устанавливаемым приложением (Android/Chrome): кладёт манифест, иконки, sw.js
и вставляет ссылки в index.html, даже если сайт собран старой версией."""
import json
import os
import re
import shutil
import sys

PINS = {
    '/pin-cod-sallet-inword-okredfit-offsdin': '/manifest-pin1.webmanifest',
    '/pin-cod-tutokenswe-ruidfal-manu-direst': '/manifest-pin2.webmanifest',
    '/pin-cod-famolderreg-hoocind-injoorenaz': '/manifest-pin3.webmanifest',
}
PIN_JS = ('<script>var P=' + json.dumps(PINS) + ';var m=P[location.pathname.replace(/[/]$/,"")];'
          'if(m){var l=document.querySelector("link[rel=manifest]");if(l)l.href=m;}</script>')
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pwa')
SW = ("<script>if('serviceWorker' in navigator&&!/AbizShell|AbizAdmin|ABIZ\\//.test(navigator.userAgent))"
      "window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})});</script>")


def main():
    root = sys.argv[1]
    for name in os.listdir(SRC):
        if name.endswith('.webmanifest') or name == 'sw.js':
            shutil.copy(os.path.join(SRC, name), os.path.join(root, name))
    os.makedirs(os.path.join(root, 'icons'), exist_ok=True)
    for f in os.listdir(os.path.join(SRC, 'icons')):
        shutil.copy(os.path.join(SRC, 'icons', f), os.path.join(root, 'icons', f))
    path = os.path.join(root, 'index.html')
    html = open(path, encoding='utf-8').read()
    head = ''
    if 'rel="manifest"' not in html:
        head += '<link rel="manifest" href="/manifest.webmanifest">'
    if 'apple-touch-icon' not in html:
        head += '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">'
    if 'mobile-web-app-capable' not in html:
        head += '<meta name="mobile-web-app-capable" content="yes">'
    if head:
        html = re.sub(r'</head>', head + '</head>', html, count=1, flags=re.I)
    if 'manifest-pin' not in html:
        html = html.replace('<link rel="manifest" href="/manifest.webmanifest">',
                            '<link rel="manifest" href="/manifest.webmanifest">' + PIN_JS, 1)
    if "register('/sw.js')" not in html and 'startPwa' not in html:
        html = re.sub(r'</body>', SW + '</body>', html, count=1, flags=re.I)
    open(path, 'w', encoding='utf-8').write(html)
    print('  приложение для Android: манифест и иконки на месте')


if __name__ == '__main__':
    main()
