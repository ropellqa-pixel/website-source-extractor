CREATE TABLE IF NOT EXISTS skud_block_tokens (
  token varchar(32) PRIMARY KEY,
  card_number text NOT NULL,
  profile_id text NULL,
  door text NOT NULL DEFAULT '',
  event_time timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz NULL
);