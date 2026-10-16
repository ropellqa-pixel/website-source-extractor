ALTER TABLE t_p59581145_website_source_extra.skud_controllers
  ADD COLUMN IF NOT EXISTS gate_host text,
  ADD COLUMN IF NOT EXISTS gate_port integer NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS gate_address integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS gate_status text,
  ADD COLUMN IF NOT EXISTS gate_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS emergency_open boolean NOT NULL DEFAULT false;