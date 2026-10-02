-- Кнопки киоска десктоп-программы: надпись, цвет, тип действия (web/app), цель и порядок.
-- Администратор в программе расставляет кнопки и нажимает «Сохранить» — порядок уходит
-- на сервер через data-api и одинаково подтягивается на всех ПК.
CREATE TABLE IF NOT EXISTS kiosk_buttons (
  id text PRIMARY KEY,
  text text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#125499',
  action text NOT NULL DEFAULT 'web',
  target text NOT NULL DEFAULT '',
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kiosk_buttons_order ON kiosk_buttons(order_index);
