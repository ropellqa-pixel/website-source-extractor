ALTER TABLE acc_counterparties ADD COLUMN IF NOT EXISTS default_category_id bigint;
ALTER TABLE acc_entries ADD COLUMN IF NOT EXISTS bank_purpose text;
CREATE TABLE IF NOT EXISTS acc_bank_imports (
  id bigserial PRIMARY KEY,
  file_name text,
  account text,
  date_from date,
  date_to date,
  added integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO acc_categories (kind, name) VALUES ('expense', 'Банковские комиссии') ON CONFLICT DO NOTHING;
INSERT INTO acc_categories (kind, name) VALUES ('expense', 'Налоги и взносы') ON CONFLICT DO NOTHING;
INSERT INTO acc_categories (kind, name) VALUES ('income', 'Эквайринг (оплата картой)') ON CONFLICT DO NOTHING;