ALTER TABLE skud_events ADD COLUMN IF NOT EXISTS processed boolean NOT NULL DEFAULT false;
UPDATE skud_events SET processed = true;
CREATE INDEX IF NOT EXISTS idx_skud_events_unprocessed ON skud_events(controller_id, event_time) WHERE NOT processed;

ALTER TABLE skud_controllers ADD COLUMN IF NOT EXISTS inside_camera_id text;
ALTER TABLE skud_controllers ADD COLUMN IF NOT EXISTS pre_seconds integer NOT NULL DEFAULT 10;
ALTER TABLE skud_controllers ADD COLUMN IF NOT EXISTS post_seconds integer NOT NULL DEFAULT 10;
ALTER TABLE skud_controllers ADD COLUMN IF NOT EXISTS recorder_device text;
ALTER TABLE skud_controllers ADD COLUMN IF NOT EXISTS recorder_quality text NOT NULL DEFAULT 'sd';
ALTER TABLE skud_controllers ADD COLUMN IF NOT EXISTS recorder_status text;
ALTER TABLE skud_controllers ADD COLUMN IF NOT EXISTS recorder_seen_at timestamptz;

CREATE TABLE IF NOT EXISTS skud_visits (
  id bigserial PRIMARY KEY,
  controller_id text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  inside integer NOT NULL DEFAULT 0,
  entries integer NOT NULL DEFAULT 0,
  exits integer NOT NULL DEFAULT 0,
  people text NOT NULL DEFAULT '[]',
  alarm boolean NOT NULL DEFAULT false,
  note text,
  inside_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_skud_visits_time ON skud_visits(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_skud_visits_open ON skud_visits(controller_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS skud_openings (
  id bigserial PRIMARY KEY,
  visit_id bigint NOT NULL,
  controller_id text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL,
  last_open_at timestamptz NOT NULL,
  closed_at timestamptz,
  closed_assumed boolean NOT NULL DEFAULT false,
  held boolean NOT NULL DEFAULT false,
  marks text NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_skud_openings_visit ON skud_openings(visit_id);
CREATE INDEX IF NOT EXISTS idx_skud_openings_open ON skud_openings(controller_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS skud_clips (
  id bigserial PRIMARY KEY,
  visit_id bigint NOT NULL,
  opening_id bigint,
  camera_id text NOT NULL,
  mode text NOT NULL,
  part_no integer NOT NULL DEFAULT 0,
  clip_from timestamptz NOT NULL,
  clip_to timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  taken_at timestamptz,
  url text,
  size_bytes bigint,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_skud_clips_visit ON skud_clips(visit_id);
CREATE INDEX IF NOT EXISTS idx_skud_clips_pending ON skud_clips(status, clip_to) WHERE status IN ('pending', 'taken');