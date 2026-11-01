ALTER TABLE skud_controllers ADD COLUMN IF NOT EXISTS outage_at timestamptz;
ALTER TABLE skud_controllers ADD COLUMN IF NOT EXISTS outage_kind text;
ALTER TABLE skud_controllers ADD COLUMN IF NOT EXISTS pc_boot_at timestamptz;