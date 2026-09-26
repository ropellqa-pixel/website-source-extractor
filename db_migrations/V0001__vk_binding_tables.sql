CREATE TABLE IF NOT EXISTS vk_bind_codes (
  id bigserial PRIMARY KEY,
  profile_id text NOT NULL,
  code varchar(6) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vk_bind_codes_code ON vk_bind_codes(code);
CREATE INDEX IF NOT EXISTS idx_vk_bind_codes_profile ON vk_bind_codes(profile_id);

CREATE TABLE IF NOT EXISTS vk_bindings (
  id bigserial PRIMARY KEY,
  profile_id text NOT NULL UNIQUE,
  vk_user_id bigint,
  vk_link text,
  status varchar(20) NOT NULL DEFAULT 'pending',
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
