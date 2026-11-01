ALTER TABLE skud_cards ADD COLUMN IF NOT EXISTS chip_uid text;
ALTER TABLE skud_cards ADD COLUMN IF NOT EXISTS chip_written_at timestamptz;
ALTER TABLE skud_cards ADD COLUMN IF NOT EXISTS chip_written_by text;