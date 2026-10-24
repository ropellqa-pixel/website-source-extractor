UPDATE auth_users SET is_biz_admin = false WHERE email = 'biz-selftest@example.com';
UPDATE biz_organizations SET status = 'terminated', license_until = NULL WHERE id = 'org-7b11dc2d7d6c';