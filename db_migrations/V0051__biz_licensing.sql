CREATE TABLE IF NOT EXISTS biz_organizations (
  id text PRIMARY KEY,
  account_no text NOT NULL UNIQUE,
  org_type text NOT NULL DEFAULT 'ООО',
  name text NOT NULL DEFAULT '',
  full_name text NOT NULL DEFAULT '',
  inn text NOT NULL DEFAULT '',
  kpp text NOT NULL DEFAULT '',
  ogrn text NOT NULL DEFAULT '',
  legal_address text NOT NULL DEFAULT '',
  postal_address text NOT NULL DEFAULT '',
  director_name text NOT NULL DEFAULT '',
  director_position text NOT NULL DEFAULT '',
  director_basis text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  bank_name text NOT NULL DEFAULT '',
  bik text NOT NULL DEFAULT '',
  bank_account text NOT NULL DEFAULT '',
  corr_account text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  license_until date NULL,
  company_id text NULL,
  tariff text NOT NULL DEFAULT 'BIZ',
  monthly_price numeric(12,2) NOT NULL DEFAULT 1790,
  notes text NOT NULL DEFAULT '',
  consent jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_ip text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_biz_org_inn ON biz_organizations(inn);

CREATE TABLE IF NOT EXISTS biz_documents (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  doc_type text NOT NULL,
  number text NOT NULL,
  doc_date date NOT NULL DEFAULT CURRENT_DATE,
  period_from date NULL,
  period_to date NULL,
  months integer NOT NULL DEFAULT 0,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'issued',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT '',
  signed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_biz_docs_org ON biz_documents(org_id);

CREATE TABLE IF NOT EXISTS biz_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS biz_audit (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL DEFAULT '',
  org_id text NOT NULL DEFAULT '',
  action text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'org-main';
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS is_biz_admin boolean NOT NULL DEFAULT false;

INSERT INTO biz_organizations (id, account_no, org_type, name, full_name, inn, ogrn, status, company_id, notes)
SELECT 'org-main', lpad((floor(random()*900000)+100000)::int::text, 6, '0'), COALESCE(NULLIF(c.type,''),'ООО'), c.name, c.name, c.inn, c.ogrn, 'active', 'main', 'Действующая организация, перенесена автоматически'
FROM companies c WHERE c.id = 'main'
ON CONFLICT (id) DO NOTHING;

INSERT INTO biz_organizations (id, account_no, status, company_id, notes)
SELECT 'org-main', lpad((floor(random()*900000)+100000)::int::text, 6, '0'), 'active', 'main', 'Действующая организация'
WHERE NOT EXISTS (SELECT 1 FROM biz_organizations WHERE id = 'org-main');

UPDATE auth_users SET is_biz_admin = true WHERE is_admin = true;

INSERT INTO biz_settings (key, value) VALUES
('vendor', '{"short_name":"ООО \"Компания \"Немзор\"","full_name":"Общество с ограниченной ответственностью \"Компания \"Немзор\"","inn":"2907019688","kpp":"290701001","ogrn":"1262900002947","legal_address":"","postal_address":"","director_name":"","director_position":"Генеральный директор","director_basis":"Устава","bank_name":"","bik":"","bank_account":"","corr_account":"","email":"do@bizwor.ru","phone":"","site":"https://bizwor.ru","city":"","vat_note":"НДС не облагается"}'::jsonb),
('tariff', '{"name":"Пакет БИЗ","code":"BIZ","price":1790,"period":"месяц"}'::jsonb)
ON CONFLICT (key) DO NOTHING;