ALTER TABLE sber_oauth ADD COLUMN IF NOT EXISTS origin text;
CREATE TABLE IF NOT EXISTS sber_pay_attempts (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  ok boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sber_pay_attempts_user ON sber_pay_attempts(user_id, created_at);