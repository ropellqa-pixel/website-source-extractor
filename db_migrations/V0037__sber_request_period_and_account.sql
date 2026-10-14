ALTER TABLE sber_requests ADD COLUMN IF NOT EXISTS period text;
UPDATE sber_connections SET account = '40702810004000012851' WHERE id = 1 AND account IS NULL;
UPDATE acc_entries SET period = to_char(entry_date, 'YYYY-MM') WHERE period IS NULL;