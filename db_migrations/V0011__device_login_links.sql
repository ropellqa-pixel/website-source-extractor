-- Одноразовые коды автовхода в браузере, которые запрашивает десктоп-программа по своему
-- device-токену. Программа получает код с сервера и сама открывает браузер по ссылке
-- вида /device-login?code=XXXX — сайт обменивает код на полноценную сессию и сразу
-- показывает авторизованный личный кабинет, без ввода логина/пароля.
CREATE TABLE IF NOT EXISTS login_links (
  id text PRIMARY KEY,
  code text UNIQUE NOT NULL,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_login_links_code ON login_links(code);
