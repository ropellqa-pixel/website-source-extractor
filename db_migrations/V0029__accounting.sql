CREATE TABLE IF NOT EXISTS acc_categories (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  name text NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_acc_categories ON acc_categories(kind, lower(name));

CREATE TABLE IF NOT EXISTS acc_entries (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  entry_date date NOT NULL,
  amount numeric(14,2) NOT NULL,
  category_id bigint,
  comment text,
  payment_id bigint,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acc_entries_date ON acc_entries(entry_date DESC);

CREATE TABLE IF NOT EXISTS acc_staff (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  profile_id text,
  position text,
  pay_type text NOT NULL DEFAULT 'salary',
  rate numeric(14,2) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS acc_accruals (
  id bigserial PRIMARY KEY,
  staff_id bigint NOT NULL,
  period text NOT NULL,
  pay_type text NOT NULL,
  rate numeric(14,2) NOT NULL DEFAULT 0,
  base numeric(14,2) NOT NULL DEFAULT 0,
  bonus numeric(14,2) NOT NULL DEFAULT 0,
  amount numeric(14,2) NOT NULL,
  comment text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acc_accruals_staff ON acc_accruals(staff_id, period);

CREATE TABLE IF NOT EXISTS acc_payments (
  id bigserial PRIMARY KEY,
  staff_id bigint NOT NULL,
  pay_date date NOT NULL,
  amount numeric(14,2) NOT NULL,
  period text,
  comment text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acc_payments_staff ON acc_payments(staff_id, pay_date);

CREATE TABLE IF NOT EXISTS acc_access (
  profile_id text PRIMARY KEY,
  can_entries boolean NOT NULL DEFAULT false,
  can_profit boolean NOT NULL DEFAULT false,
  can_salary boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS acc_log (
  id bigserial PRIMARY KEY,
  user_name text,
  action text NOT NULL,
  details text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acc_log_time ON acc_log(created_at DESC);

INSERT INTO acc_categories (kind, name) VALUES
  ('income', 'Продажи'), ('income', 'Услуги'), ('income', 'Прочие доходы'),
  ('expense', 'Аренда'), ('expense', 'Закупка товара'), ('expense', 'Коммунальные услуги'),
  ('expense', 'Зарплата'), ('expense', 'Налоги'), ('expense', 'Связь и интернет'),
  ('expense', 'Транспорт'), ('expense', 'Хозяйственные расходы'), ('expense', 'Прочие расходы')
ON CONFLICT DO NOTHING;