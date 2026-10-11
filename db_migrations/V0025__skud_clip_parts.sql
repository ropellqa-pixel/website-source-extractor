ALTER TABLE skud_clips ADD COLUMN IF NOT EXISTS parts text;
ALTER TABLE skud_clips ADD COLUMN IF NOT EXISTS duration_sec integer;