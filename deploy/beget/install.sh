#!/bin/bash
set -e
export LC_COLLATE=C
if ! "$HOME/api.bizwor.ru/venv/bin/python" -c "import encodings" >/dev/null 2>&1; then
  echo "Сначала войдите в окружение сервера командой:  ssh localhost -p222"
  echo "(в начале строки должно появиться (docker)), затем снова: bash ~/upd/install.sh"
  exit 1
fi
U="$(cd "$(dirname "$0")" && pwd)"
SITE="$HOME/bizwor.ru/public_html"
API="$HOME/api.bizwor.ru"
echo "1/5 Сайт"
if [ -f "$U/site/index.html" ]; then rm -rf "$SITE/assets"; cp -r "$U/site/." "$SITE/"; else echo "  сайт в этом пакете не меняется"; fi
echo "2/5 Сервер"
cp -r "$U/backend/." "$API/backend/"
cp "$U/apply_sql.py" "$API/"; cp "$U/app.py" "$API/"
echo "3/5 База"
if ls "$U"/sql/*.sql >/dev/null 2>&1; then cd "$API" && ./venv/bin/python apply_sql.py "$U"/sql/*.sql; else echo "  изменений базы нет"; fi
mkdir -p "$API/tmp" && touch "$API/tmp/restart.txt"
echo "4/5 Адрес bizwor.ru/api"
bash "$U/link_site.sh"
echo "5/5 Проверка"
if [ ! -f "$U/site/index.html" ]; then curl -s https://bizwor.ru/api/health; echo; exit 0; fi
NEED=$(grep -o 'assets/index-[^"]*\.js' "$U/site/index.html" | head -1)
LIVE=$(curl -s "https://bizwor.ru/?v=$RANDOM" | grep -o 'assets/index-[^"]*\.js' | head -1)
if [ "$NEED" = "$LIVE" ]; then echo "Сайт: новая версия на месте ($NEED)"; else echo "ВНИМАНИЕ: сайт отдаёт $LIVE, а должен $NEED. Пришлите Юре вывод: ls -la ~/bizwor.ru ~/bizwor.ru/public_html | head -40"; fi