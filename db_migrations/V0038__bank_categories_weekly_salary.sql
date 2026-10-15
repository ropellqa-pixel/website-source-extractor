INSERT INTO t_p59581145_website_source_extra.acc_categories (kind, name) VALUES
  ('expense', 'Покупка по карте'),
  ('income', 'Возврат по карте'),
  ('expense', 'Коммунальные услуги (Отопление)'),
  ('expense', 'Коммунальные услуги (Электроэнергия)'),
  ('expense', 'Коммунальные услуги (Вода и вывоз мусора)'),
  ('expense', 'Программы и электронный документооборот'),
  ('income', 'Связь и интернет')
ON CONFLICT DO NOTHING;

ALTER TABLE t_p59581145_website_source_extra.acc_payments ADD COLUMN IF NOT EXISTS source_key text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_acc_payments_source_key ON t_p59581145_website_source_extra.acc_payments(source_key) WHERE source_key IS NOT NULL;