UPDATE schedule_config SET configurator_ids = '[]'::jsonb;
UPDATE schedule_configurators SET is_active = false, name = '(старый) ' || name WHERE id IN ('cfg-equal-all','cfg-st-dn-pair','cfg-transfer') AND name NOT LIKE '(старый)%';
INSERT INTO schedule_configurators (id, name, kind, params, is_active, created_by) VALUES
('cfg-oct-afanaseva', 'Афанасьева — СТ: Д, Н, 3 выходных', 'mode', '{"template":"mode_custom","cycle":"Д,Н,В,В,В","offset":2}'::jsonb, true, 'Юра'),
('cfg-oct-shestakova', 'Шестакова — СТ: Д, Н, 3 выходных', 'mode', '{"template":"mode_custom","cycle":"Н,В,В,В,Д","offset":2}'::jsonb, true, 'Юра'),
('cfg-oct-shpynova-k', 'Шпынова К. — СТ: Д, Н, 3 выходных', 'mode', '{"template":"mode_custom","cycle":"В,В,Д,Н,В","offset":2}'::jsonb, true, 'Юра'),
('cfg-oct-pozhenskaya', 'Поженская — СТ: только Д', 'mode', '{"template":"mode_custom","cycle":"В,Д,В,Д,В","offset":2}'::jsonb, true, 'Юра'),
('cfg-oct-biryukova', 'Бирюкова — ночи за Поженскую', 'mode', '{"template":"mode_custom","cycle":"В,В,Н,В,Н","offset":2}'::jsonb, true, 'Юра'),
('cfg-oct-kuznetsova', 'Кузнецова — МЛ: 3 Дп, 3 выходных', 'mode', '{"template":"mode_custom","cycle":"Дп,Дп,Дп,В,В,В","offset":2}'::jsonb, true, 'Юра'),
('cfg-oct-shpynova-m', 'Шпынова М. — МЛ: 3 Дп, 3 выходных', 'mode', '{"template":"mode_custom","cycle":"В,В,В,Дп,Дп,Дп","offset":2}'::jsonb, true, 'Юра'),
('cfg-oct-aspednikova', 'Аспедникова — МЛ: Нп через день', 'mode', '{"template":"mode_custom","cycle":"Нп,В,Нп,В,Нп,В","offset":2}'::jsonb, true, 'Юра'),
('cfg-oct-orlova', 'Орлова — МЛ: Нп через день', 'mode', '{"template":"mode_custom","cycle":"В,Нп,В,Нп,В,Нп","offset":2}'::jsonb, true, 'Юра')
ON CONFLICT (id) DO NOTHING;
UPDATE schedule_config SET configurator_ids = '["cfg-oct-afanaseva"]'::jsonb WHERE profile_id = '19594e88-97a0-4ee3-b4c3-e52bda08cb8f';
UPDATE schedule_config SET configurator_ids = '["cfg-oct-shestakova"]'::jsonb WHERE profile_id = '36c9bd61-420d-4611-8040-8ba9880958fe';
UPDATE schedule_config SET configurator_ids = '["cfg-oct-shpynova-k"]'::jsonb WHERE profile_id = '1d0506e8-8478-4dfd-a877-db96ff197fb3';
UPDATE schedule_config SET configurator_ids = '["cfg-oct-pozhenskaya"]'::jsonb WHERE profile_id = '11cef024-390b-46e6-b1bc-523a2e288edc';
UPDATE schedule_config SET configurator_ids = '["cfg-oct-biryukova"]'::jsonb WHERE profile_id = '9eb5f934-9fd4-4e4b-bd7f-ff44af054cb3';
UPDATE schedule_config SET configurator_ids = '["cfg-oct-kuznetsova"]'::jsonb WHERE profile_id = '43a8b8c5-f98e-43c5-a3cf-f5c6f563aaed';
UPDATE schedule_config SET configurator_ids = '["cfg-oct-shpynova-m"]'::jsonb WHERE profile_id = '9815ba9f-0eb2-4deb-8bcd-1d5b6fb91f56';
UPDATE schedule_config SET configurator_ids = '["cfg-oct-aspednikova"]'::jsonb WHERE profile_id = '6995e8ed-fe3e-4dc0-8837-6b7f9070ab81';
UPDATE schedule_config SET configurator_ids = '["cfg-oct-orlova"]'::jsonb WHERE profile_id = '9f0bf41e-e1b8-4619-b8e6-5238417d7e2f';