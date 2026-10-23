INSERT INTO schedule_configurators (id, name, kind, params, is_active, created_by) VALUES
('cfg-equal-all', 'Поровну смен у всех', 'function', '{"template":"equal_all","weight":"max"}'::jsonb, true, 'Юра'),
('cfg-st-dn-pair', 'СТ: после Д — сразу Н', 'condition', '{"template":"required_sequence","from":"Д","then":"Н"}'::jsonb, true, 'Юра')
ON CONFLICT (id) DO NOTHING;
UPDATE schedule_config SET configurator_ids = '["cfg-equal-all"]'::jsonb
WHERE profile_id IN ('9815ba9f-0eb2-4deb-8bcd-1d5b6fb91f56','6995e8ed-fe3e-4dc0-8837-6b7f9070ab81','43a8b8c5-f98e-43c5-a3cf-f5c6f563aaed','9eb5f934-9fd4-4e4b-bd7f-ff44af054cb3','11cef024-390b-46e6-b1bc-523a2e288edc','9f0bf41e-e1b8-4619-b8e6-5238417d7e2f');
UPDATE schedule_config SET configurator_ids = '["cfg-equal-all","cfg-st-dn-pair"]'::jsonb
WHERE profile_id IN ('36c9bd61-420d-4611-8040-8ba9880958fe','1d0506e8-8478-4dfd-a877-db96ff197fb3','19594e88-97a0-4ee3-b4c3-e52bda08cb8f');
UPDATE schedule_config SET break_days = 1
WHERE profile_id IN ('6995e8ed-fe3e-4dc0-8837-6b7f9070ab81','9f0bf41e-e1b8-4619-b8e6-5238417d7e2f');