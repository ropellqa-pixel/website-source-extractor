ALTER TABLE acc_counterparties ADD COLUMN IF NOT EXISTS kpp text;
ALTER TABLE acc_counterparties ADD COLUMN IF NOT EXISTS account text;
ALTER TABLE acc_counterparties ADD COLUMN IF NOT EXISTS bank_bic text;
ALTER TABLE acc_counterparties ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE acc_counterparties ADD COLUMN IF NOT EXISTS corr_account text;
ALTER TABLE acc_counterparties ADD COLUMN IF NOT EXISTS default_purpose text;
ALTER TABLE acc_counterparties ADD COLUMN IF NOT EXISTS vat_rate text NOT NULL DEFAULT 'none';
ALTER TABLE acc_counterparties ADD COLUMN IF NOT EXISTS requisites_hash text;
ALTER TABLE acc_counterparties ADD COLUMN IF NOT EXISTS requisites_updated_at timestamptz;
ALTER TABLE acc_counterparties ADD COLUMN IF NOT EXISTS requisites_updated_by text;

CREATE TABLE IF NOT EXISTS sber_vault (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sber_oauth (
  state text PRIMARY KEY,
  nonce text NOT NULL,
  user_id text NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sber_requests (
  id bigserial PRIMARY KEY,
  counterparty_id bigint NOT NULL,
  amount numeric(14,2) NOT NULL,
  purpose text NOT NULL,
  vat_rate text NOT NULL DEFAULT 'none',
  week_start date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  requisites jsonb NOT NULL DEFAULT '{}'::jsonb,
  requisites_hash text,
  created_by text,
  created_by_user text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  decided_by text,
  decided_at timestamptz,
  reject_reason text,
  external_id text UNIQUE,
  bank_status text,
  bank_comment text,
  bank_checked_at timestamptz,
  entry_id bigint,
  category_id bigint
);
CREATE INDEX IF NOT EXISTS idx_sber_requests_status ON sber_requests(status);
CREATE INDEX IF NOT EXISTS idx_sber_requests_week ON sber_requests(week_start);

INSERT INTO app_settings (key, value, updated_by) VALUES ('sber', '{"connected": false, "limit_payment": 300000, "limit_day": 1000000, "scope": "openid GET_CLIENT_ACCOUNTS GET_STATEMENT_ACCOUNT GET_STATEMENT_TRANSACTION PAY_DOC_RU"}'::jsonb, 'Система')
  ON CONFLICT (key) DO NOTHING;