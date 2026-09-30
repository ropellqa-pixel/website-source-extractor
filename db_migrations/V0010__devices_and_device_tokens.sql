-- Устройства (ПК с установленным десктоп-приложением). Каждый компьютер при первом запуске
-- получает свой 9-значный код (device_code) и регистрируется как "pending" (не привязан).
-- Директор в личном кабинете видит список таких кодов и привязывает конкретный код
-- к сотруднику, при необходимости задавая ему пароль для входа. После привязки устройство
-- получает собственный постоянный API-токен (в таблице api_tokens, колонка device_code) —
-- это позволяет впоследствии отозвать доступ ровно одному ПК, не трогая остальные.
CREATE TABLE IF NOT EXISTS devices (
  id text PRIMARY KEY,
  device_code varchar(9) UNIQUE NOT NULL,
  hostname text NOT NULL DEFAULT '',
  profile_id text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  linked_at timestamptz,
  last_seen_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_devices_code ON devices(device_code);
CREATE INDEX IF NOT EXISTS idx_devices_profile ON devices(profile_id);

ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS device_code text;
CREATE INDEX IF NOT EXISTS idx_api_tokens_device_code ON api_tokens(device_code);
