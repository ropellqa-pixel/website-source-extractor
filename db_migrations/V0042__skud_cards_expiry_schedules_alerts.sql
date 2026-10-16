ALTER TABLE t_p59581145_website_source_extra.skud_cards
  ADD COLUMN IF NOT EXISTS card_type text NOT NULL DEFAULT 'employee',
  ADD COLUMN IF NOT EXISTS pin_code text,
  ADD COLUMN IF NOT EXISTS schedule_id integer,
  ADD COLUMN IF NOT EXISTS written_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS written_by text;

ALTER TABLE t_p59581145_website_source_extra.skud_controllers
  ADD COLUMN IF NOT EXISTS antipassback boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS outputs text;

CREATE TABLE IF NOT EXISTS t_p59581145_website_source_extra.skud_schedules (
  id serial PRIMARY KEY,
  name text NOT NULL,
  days integer NOT NULL DEFAULT 31,
  time_from text NOT NULL DEFAULT '08:00',
  time_to text NOT NULL DEFAULT '20:00',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS t_p59581145_website_source_extra.skud_notice_dismiss (
  user_id text NOT NULL,
  card_id text NOT NULL,
  cycle timestamptz NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, card_id, cycle)
);

CREATE TABLE IF NOT EXISTS t_p59581145_website_source_extra.skud_vk_sent (
  key text PRIMARY KEY,
  sent_at timestamptz NOT NULL DEFAULT now()
);