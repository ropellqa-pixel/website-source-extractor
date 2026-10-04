-- Что сейчас происходит с обновлением программы на ПК (скачивание, готово, ошибка) —
-- видно заму на странице «Управление ПК».
ALTER TABLE devices ADD COLUMN IF NOT EXISTS update_status text;
-- Выпуск с ошибочным номером версии «v16 - 3.4» не распознавался программой как новый.
UPDATE app_releases SET version = '3.4' WHERE version = 'v16 - 3.4';