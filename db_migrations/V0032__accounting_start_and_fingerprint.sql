ALTER TABLE acc_periods ADD COLUMN IF NOT EXISTS fingerprint text;
ALTER TABLE acc_accruals ADD COLUMN IF NOT EXISTS void boolean NOT NULL DEFAULT false;
ALTER TABLE acc_entries ADD COLUMN IF NOT EXISTS void boolean NOT NULL DEFAULT false;
INSERT INTO app_settings (key, value, updated_by) VALUES ('accounting', '{"start_period": "2026-09"}'::jsonb, 'Система')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_by) VALUES ('shift_hours', '{"Д": 12, "Н": 12, "Дп": 12, "Нп": 12}'::jsonb, 'Система')
  ON CONFLICT (key) DO NOTHING;
UPDATE acc_accruals SET void = true WHERE source_key IS NOT NULL AND period < '2026-09';
UPDATE acc_entries SET void = true WHERE source IS NOT NULL AND period < '2026-09';