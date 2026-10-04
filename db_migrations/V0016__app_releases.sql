-- Выпуски (релизы) программы АБИЗ для удалённого автообновления.
-- Зам. директора загружает на сайте ZIP новой версии и нажимает «Выпустить» — все ПК
-- при следующей проверке (каждые 10 минут, при запуске или по кнопке) скачивают и ставят её.
CREATE TABLE IF NOT EXISTS app_releases (
  id text PRIMARY KEY,
  edition text NOT NULL DEFAULT 'abiz',      -- abiz (киоск) | admin (АБИЗ-Админ)
  version text NOT NULL,                     -- например 3.4
  url text NOT NULL,                         -- ссылка на ZIP с файлами программы
  sha256 text NOT NULL DEFAULT '',
  size_bytes bigint NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,   -- текущая выпущенная версия для этой редакции
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_releases_edition ON app_releases(edition, is_active, created_at DESC);