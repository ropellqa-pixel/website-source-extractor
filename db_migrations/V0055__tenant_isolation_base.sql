ALTER TABLE biz_organizations ADD COLUMN IF NOT EXISTS data_schema text NULL;
ALTER TABLE biz_organizations ADD COLUMN IF NOT EXISTS owner_name text NOT NULL DEFAULT '';
ALTER TABLE biz_organizations ADD COLUMN IF NOT EXISTS provisioned_at timestamptz NULL;
UPDATE biz_organizations SET data_schema = current_schema() WHERE id = 'org-main' AND data_schema IS NULL;
UPDATE biz_organizations o SET owner_name = p.full_name FROM profiles p JOIN auth_users u ON u.id = p.user_id WHERE u.org_id = o.id AND o.id <> 'org-main' AND p.role = 'director';