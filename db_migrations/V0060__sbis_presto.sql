CREATE TABLE IF NOT EXISTS sbis_daily (
  point_id bigint NOT NULL,
  day date NOT NULL,
  cash numeric(14,2) NOT NULL DEFAULT 0,
  bank numeric(14,2) NOT NULL DEFAULT 0,
  certificate numeric(14,2) NOT NULL DEFAULT 0,
  salary numeric(14,2) NOT NULL DEFAULT 0,
  returns numeric(14,2) NOT NULL DEFAULT 0,
  checks integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (point_id, day)
);
CREATE INDEX IF NOT EXISTS idx_sbis_daily_day ON sbis_daily(day);
INSERT INTO acc_categories (kind, name)
SELECT 'income', 'Кассовый оборот'
WHERE NOT EXISTS (SELECT 1 FROM acc_categories WHERE kind = 'income' AND lower(name) = lower('Кассовый оборот'));