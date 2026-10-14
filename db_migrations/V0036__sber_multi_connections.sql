CREATE TABLE IF NOT EXISTS sber_connections (
  id bigserial PRIMARY KEY,
  title text NOT NULL,
  org jsonb,
  account text,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  last_sync timestamptz,
  last_sync_result jsonb,
  last_error text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sber_requests ADD COLUMN IF NOT EXISTS connection_id bigint;
ALTER TABLE acc_entries ADD COLUMN IF NOT EXISTS bank_connection_id bigint;
INSERT INTO app_settings (key, value, updated_by) VALUES ('sber_notify', '{"on_send": true, "on_paid": true, "on_reject": true}'::jsonb, 'Система')
  ON CONFLICT (key) DO NOTHING;