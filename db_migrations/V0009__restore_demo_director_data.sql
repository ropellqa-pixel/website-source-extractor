-- Восстанавливаем демо-данные директора (были удалены в ходе реальной эксплуатации) —
-- на них рассчитаны статические тесты auth-api (pin_lookup, signin).
INSERT INTO profiles (id, user_id, full_name, email, role, department, status, has_system_access)
VALUES ('demo-director-profile', 'demo-director-user', 'Иванов Иван Иванович', 'director@anodbiz.ru', 'director', 'Руководство', 'active', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pin_codes (id, user_id, pin, email, shortcut_code)
VALUES ('demo-director-pin', 'demo-director-user', '1234', 'director@anodbiz.ru', 'default')
ON CONFLICT (id) DO NOTHING;
