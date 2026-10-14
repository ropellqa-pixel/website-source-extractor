CREATE TABLE IF NOT EXISTS positions (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS position_id bigint;

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE salary_data ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE manager_data ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE collection_data ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS acc_periods (
  period text PRIMARY KEY,
  closed boolean NOT NULL DEFAULT false,
  closed_at timestamptz,
  closed_by text,
  synced_at timestamptz,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE acc_entries ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE acc_entries ADD COLUMN IF NOT EXISTS source_key text;
ALTER TABLE acc_entries ADD COLUMN IF NOT EXISTS period text;
ALTER TABLE acc_entries ADD COLUMN IF NOT EXISTS counterparty_id bigint;
CREATE UNIQUE INDEX IF NOT EXISTS uq_acc_entries_source ON acc_entries(source, source_key) WHERE source IS NOT NULL;

CREATE TABLE IF NOT EXISTS acc_counterparties (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'supplier',
  inn text,
  phone text,
  comment text,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS acc_cp_docs (
  id bigserial PRIMARY KEY,
  counterparty_id bigint NOT NULL,
  direction text NOT NULL,
  doc_date date NOT NULL,
  amount numeric(14,2) NOT NULL,
  category_id bigint,
  comment text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acc_cp_docs_cp ON acc_cp_docs(counterparty_id);

CREATE TABLE IF NOT EXISTS acc_budget (
  period text NOT NULL,
  category_id bigint NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (period, category_id)
);

UPDATE acc_categories SET archived = true WHERE name IN ('а', 'ааа');
INSERT INTO acc_categories (kind, name) VALUES ('income', 'Инкассация') ON CONFLICT DO NOTHING;