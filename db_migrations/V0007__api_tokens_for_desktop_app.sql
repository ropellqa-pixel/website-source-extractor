-- Постоянные API-токены для внешних приложений (например, десктоп-клиент на C#).
-- В отличие от auth_sessions (30 дней, обновляются при каждом входе), эти токены выдаются
-- один раз на пользователя и не истекают — пока их вручную не отозвать (revoked_at).
CREATE TABLE IF NOT EXISTS api_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  token text UNIQUE NOT NULL,
  label text NOT NULL DEFAULT 'Десктоп-приложение',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_token ON api_tokens(token);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
