CREATE TABLE IF NOT EXISTS schedule_configurators (
  id text PRIMARY KEY DEFAULT md5(random()::text || clock_timestamp()::text),
  company_id text,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'condition',
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sched_conf_company ON schedule_configurators(company_id);
ALTER TABLE schedule_config ADD COLUMN IF NOT EXISTS configurator_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS login_cards (
  card_number text PRIMARY KEY,
  user_id text NOT NULL,
  profile_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_cards_user ON login_cards(user_id);