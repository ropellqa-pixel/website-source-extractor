INSERT INTO schedule_configurators (id, name, kind, params, is_active, created_by) VALUES
('cfg-transfer', 'Передача', 'function', '{"template":"transfer","codes":["Д","Н"],"strength":"rare"}'::jsonb, true, 'Юра')
ON CONFLICT (id) DO NOTHING;
UPDATE schedule_config SET configurator_ids = '["cfg-transfer"]'::jsonb, preferences = ''
WHERE profile_id = '9eb5f934-9fd4-4e4b-bd7f-ff44af054cb3';