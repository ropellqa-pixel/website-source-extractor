-- Удалённое управление компьютерами (ПК с АБИЗ) заместителем директора.
-- 1) Текущее состояние каждого ПК (онлайн/где находится) — обновляется heartbeat-ом из АБИЗ.
-- 2) Очередь команд серверу->ПК (блокировка, разблокировка, сообщение на экран, скриншот, запуск RuDesktop).
-- 3) Журнал активности, который присылает сам ПК (вход, выход, открытые программы и т.п.).

-- Состояние ПК. presence: 'offline' (выкл/не отвечает), 'login' (на экране пароля),
-- 'working' (сотрудник вошёл в систему). remote_lock — принудительная блокировка замом.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS presence text NOT NULL DEFAULT 'offline';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS current_user_name text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS app_version text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS screenshot_url text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS screenshot_at timestamptz;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS remote_lock boolean NOT NULL DEFAULT false;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS lock_message text;

-- Команды: сервер кладёт команду, ПК при следующем heartbeat её забирает и помечает выполненной.
CREATE TABLE IF NOT EXISTS device_commands (
  id text PRIMARY KEY,
  device_code varchar(9) NOT NULL,
  command text NOT NULL,            -- lock | unlock | message | screenshot | rudesktop | reload | logout
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,                  -- profile_id того, кто отдал команду
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  done_at timestamptz,
  result text
);
CREATE INDEX IF NOT EXISTS idx_device_commands_code ON device_commands(device_code, done_at);

-- Журнал активности ПК (прислал сам ПК) + действия зама над ПК.
CREATE TABLE IF NOT EXISTS device_logs (
  id bigserial PRIMARY KEY,
  device_code varchar(9) NOT NULL,
  kind text NOT NULL,               -- signin | signout | presence | app_open | remote | note
  message text NOT NULL DEFAULT '',
  actor_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_device_logs_code ON device_logs(device_code, created_at DESC);