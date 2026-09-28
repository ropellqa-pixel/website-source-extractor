ALTER TABLE pin_codes ADD COLUMN IF NOT EXISTS adpod_slug text;
CREATE INDEX IF NOT EXISTS idx_pin_codes_adpod_slug ON pin_codes(adpod_slug);
