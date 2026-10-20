INSERT INTO t_p59581145_website_source_extra.auth_users (id, email, password_hash, is_admin)
VALUES ('root-superadmin', 'echencers76@full.ru', 'HASH_PLACEHOLDER', true)
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_admin = true;