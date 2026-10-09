-- СКУД: контроллеры (Z5R-Web / Gate-4000-Ethernet), ключ-карты сотрудников, события прохода, очередь команд.
CREATE TABLE IF NOT EXISTS skud_controllers (
  id text PRIMARY KEY DEFAULT md5(random()::text || clock_timestamp()::text),
  name text NOT NULL DEFAULT 'Склад',
  serial text UNIQUE,
  model text,
  secret text NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
  camera_id text,
  open_seconds integer NOT NULL DEFAULT 3,
  last_seen_at timestamptz,
  last_ip text,
  fw_version text,
  conn_fw text,
  door_open boolean,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skud_cards (
  id text PRIMARY KEY DEFAULT md5(random()::text || clock_timestamp()::text),
  card_number text NOT NULL UNIQUE,
  profile_id text,
  label text,
  status text NOT NULL DEFAULT 'active',
  valid_from date,
  valid_to date,
  synced boolean NOT NULL DEFAULT false,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_skud_cards_profile ON skud_cards(profile_id);

CREATE TABLE IF NOT EXISTS skud_events (
  id bigserial PRIMARY KEY,
  controller_id text,
  event_time timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  event_code integer,
  event_kind text NOT NULL,
  direction text,
  granted boolean,
  card_number text,
  profile_id text,
  person_name text,
  note text,
  source text NOT NULL DEFAULT 'controller',
  raw text,
  UNIQUE (controller_id, event_time, event_code, card_number)
);
CREATE INDEX IF NOT EXISTS idx_skud_events_time ON skud_events(event_time DESC);
CREATE INDEX IF NOT EXISTS idx_skud_events_profile ON skud_events(profile_id, event_time DESC);

CREATE TABLE IF NOT EXISTS skud_commands (
  id bigserial PRIMARY KEY,
  controller_id text NOT NULL,
  operation text NOT NULL,
  payload text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  done_at timestamptz,
  result text
);
CREATE INDEX IF NOT EXISTS idx_skud_commands_pending ON skud_commands(controller_id) WHERE sent_at IS NULL;

-- Режим «ждём карту»: следующая поднесённая неизвестная карта запишется сюда (для привязки к сотруднику).
CREATE TABLE IF NOT EXISTS skud_enroll (
  id integer PRIMARY KEY DEFAULT 1,
  until_at timestamptz,
  card_number text,
  captured_at timestamptz
);
INSERT INTO skud_enroll (id) VALUES (1) ON CONFLICT DO NOTHING;