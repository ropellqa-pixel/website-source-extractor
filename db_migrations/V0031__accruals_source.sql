ALTER TABLE acc_accruals ADD COLUMN IF NOT EXISTS source_key text;
ALTER TABLE acc_accruals ADD COLUMN IF NOT EXISTS details jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS uq_acc_accruals_source ON acc_accruals(source_key) WHERE source_key IS NOT NULL;
UPDATE acc_categories SET name = 'Зарплата сотрудников' WHERE kind = 'expense' AND name = 'Зарплата';
INSERT INTO acc_categories (kind, name) VALUES ('expense', 'Зарплата руководителей') ON CONFLICT DO NOTHING;