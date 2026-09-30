-- Фиксированный тестовый API-токен для демо-директора — нужен статическим тестам (tests.json)
-- data-api и file-upload, которые теперь требуют авторизации на каждый запрос.
INSERT INTO api_tokens (id, user_id, token, label)
VALUES ('demo-director-test-token-id', 'demo-director-user', 'anod_test_static_token_for_ci_only', 'CI-тесты (не использовать в проде)')
ON CONFLICT (id) DO NOTHING;
