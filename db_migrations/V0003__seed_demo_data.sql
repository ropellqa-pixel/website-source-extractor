INSERT INTO companies (id, name, inn, ogrn, type)
VALUES ('main', 'ООО «АнодБИЗ»', '7700000000', '1027700000000', 'ООО')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth_users (id, email, password_hash, is_admin)
VALUES (
  'demo-director-user',
  'director@anodbiz.ru',
  'fa70148f93eec0396526d3efd9c4de41$a28860f9e673feff5e765b8a3dcb0c2e129ec409cf323231d971d83e8b5d744b',
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, user_id, full_name, email, role, department, status, has_system_access)
VALUES ('demo-director-profile', 'demo-director-user', 'Иванов Иван Иванович', 'director@anodbiz.ru', 'director', 'Руководство', 'active', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pin_codes (id, user_id, pin, email, shortcut_code)
VALUES ('demo-director-pin', 'demo-director-user', '1234', 'director@anodbiz.ru', 'default')
ON CONFLICT (id) DO NOTHING;

INSERT INTO documents (id, title, content, author, tags, created_at, updated_at) VALUES
('d1', 'Регламент приёмки анодированных деталей', 'Порядок входного и выходного контроля покрытия: толщина слоя, цвет, отсутствие пятен.', 'Иванов И. И.', '["регламент","качество"]', '2026-09-12', '2026-09-20'),
('d2', 'Инструкция по охране труда', 'Работа с кислотными ваннами допускается только в защитной экипировке.', 'Смирнова О. П.', '["охрана труда"]', '2026-08-30', '2026-09-02'),
('d3', 'График технического обслуживания линии', 'Еженедельная проверка выпрямителей и замена электролита раз в квартал.', 'Кузнецов А. С.', '["оборудование"]', '2026-09-18', '2026-09-18')
ON CONFLICT (id) DO NOTHING;

INSERT INTO folders (id, name, parent_id) VALUES
('f1', 'Договоры', NULL),
('f2', 'Сертификаты', NULL),
('f3', 'Кадры', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO dto_templates (id, name, category_id, content, description, usage_count) VALUES
('t1', 'Договор поставки', 'contract', 'ДОГОВОР ПОСТАВКИ №___

ООО «АнодБИЗ», именуемое в дальнейшем «Поставщик»...', 'Типовой договор на поставку продукции', 12),
('t2', 'Акт выполненных работ', 'act', 'АКТ №___

Исполнитель выполнил работы по анодированию...', 'Акт сдачи-приёмки работ', 7)
ON CONFLICT (id) DO NOTHING;

INSERT INTO chat_rooms (id, name, type, participants) VALUES
('r1', 'Общий чат', 'group', '[]'),
('r2', 'Производство', 'group', '[]')
ON CONFLICT (id) DO NOTHING;

INSERT INTO chat_messages (id, room_id, sender_id, sender_name, content, read, created_at) VALUES
('m1', 'r1', 'u-dep', 'Смирнова Ольга Петровна', 'Коллеги, табель за сентябрь закрыт. Проверьте свои смены.', false, '2026-09-25T09:12:00.000Z'),
('m2', 'r1', 'u-sen', 'Кузнецов Андрей Сергеевич', 'Принято, всё сходится.', false, '2026-09-25T09:20:00.000Z')
ON CONFLICT (id) DO NOTHING;
