-- Кэш готовых ссылок на живое видео камер: ссылка облака живёт долго, повторно её можно отдавать
-- мгновенно, без 1-4 секунд ожидания облака. Отдельно для обычного (sd) и высокого (hd) качества.
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS live_url_sd text;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS live_url_sd_at timestamptz;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS live_url_hd text;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS live_url_hd_at timestamptz;