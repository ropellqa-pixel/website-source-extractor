-- Блокируем демо-аккаунт director@anodbiz.ru: входа в него быть не должно.
-- Пароль заменён на невозможный хеш, адрес переименован (вход по нему не найдётся),
-- PIN 1234 отключён, сессии истекли, токены отозваны, права администратора сняты.
UPDATE auth_users SET password_hash = 'disabled-' || md5(random()::text || clock_timestamp()::text),
       is_admin = false, email = 'disabled-demo@invalid.local'
 WHERE id = 'demo-director-user' OR lower(email) = 'director@anodbiz.ru';
UPDATE auth_sessions SET expires_at = now() - interval '1 day' WHERE user_id = 'demo-director-user';
UPDATE api_tokens SET revoked_at = now() WHERE user_id = 'demo-director-user' AND revoked_at IS NULL;
UPDATE pin_codes SET pin = 'disabled-' || substr(md5(random()::text), 1, 12), email = 'disabled-demo@invalid.local'
 WHERE user_id = 'demo-director-user' OR lower(email) = 'director@anodbiz.ru';
UPDATE profiles SET email = 'disabled-demo@invalid.local', role = 'employee', full_name = 'Отключённый демо-аккаунт'
 WHERE id = 'demo-director-profile' OR lower(email) = 'director@anodbiz.ru';
UPDATE schedule_config SET excluded = true WHERE profile_id = 'demo-director-profile';
UPDATE devices SET profile_id = NULL WHERE profile_id = 'demo-director-profile';