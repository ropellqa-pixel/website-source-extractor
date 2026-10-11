CREATE TABLE IF NOT EXISTS recorder_keys (
  key text PRIMARY KEY,
  device_code varchar(9) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_recorder_keys_device ON recorder_keys(device_code) WHERE revoked_at IS NULL;