ALTER TABLE biz_organizations ADD COLUMN IF NOT EXISTS draft_token text NOT NULL DEFAULT '';
ALTER TABLE biz_organizations ADD COLUMN IF NOT EXISTS okved text NOT NULL DEFAULT '';
ALTER TABLE biz_organizations ADD COLUMN IF NOT EXISTS contact_name text NOT NULL DEFAULT '';
ALTER TABLE biz_organizations ADD COLUMN IF NOT EXISTS users_limit integer NOT NULL DEFAULT 0;