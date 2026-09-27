CREATE TABLE IF NOT EXISTS companies (
  id text PRIMARY KEY DEFAULT 'main',
  name text NOT NULL DEFAULT '',
  inn text NOT NULL DEFAULT '',
  ogrn text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'ООО',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_users (
  id text PRIMARY KEY,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  token text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token);

CREATE TABLE IF NOT EXISTS profiles (
  id text PRIMARY KEY,
  user_id text,
  full_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'employee',
  department text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  has_system_access boolean NOT NULL DEFAULT false,
  vk_id text,
  vk_link text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

CREATE TABLE IF NOT EXISTS pin_codes (
  id text PRIMARY KEY,
  user_id text,
  pin varchar(4) NOT NULL,
  email text NOT NULL,
  shortcut_code text DEFAULT 'default',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pin_codes_pin ON pin_codes(pin);
CREATE INDEX IF NOT EXISTS idx_pin_codes_email ON pin_codes(email);

CREATE TABLE IF NOT EXISTS schedule_config (
  id text PRIMARY KEY,
  profile_id text NOT NULL,
  no_day boolean NOT NULL DEFAULT false,
  no_night boolean NOT NULL DEFAULT false,
  break_days int NOT NULL DEFAULT 0,
  priority int NOT NULL DEFAULT 3,
  status text NOT NULL DEFAULT 'ЛБ',
  preferences text NOT NULL DEFAULT '',
  excluded boolean NOT NULL DEFAULT false,
  st_no_day boolean NOT NULL DEFAULT false,
  st_no_night boolean NOT NULL DEFAULT false,
  ml_no_day boolean NOT NULL DEFAULT false,
  ml_no_night boolean NOT NULL DEFAULT false,
  delays text NOT NULL DEFAULT '',
  unavailable text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schedule_config_profile ON schedule_config(profile_id);

CREATE TABLE IF NOT EXISTS employee_schedule_settings (
  id text PRIMARY KEY,
  profile_id text NOT NULL,
  month_year text NOT NULL,
  delay text NOT NULL DEFAULT '',
  unavailable text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ess_profile_month ON employee_schedule_settings(profile_id, month_year);

CREATE TABLE IF NOT EXISTS schedule_data (
  id text PRIMARY KEY,
  month_year text NOT NULL,
  profile_id text NOT NULL,
  shifts jsonb NOT NULL DEFAULT '[]',
  user_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schedule_data_month ON schedule_data(month_year);

CREATE TABLE IF NOT EXISTS schedule_settings (
  id text PRIMARY KEY,
  month_year text,
  is_locked boolean NOT NULL DEFAULT false,
  responsible_profile_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schedule_settings_month ON schedule_settings(month_year);

CREATE TABLE IF NOT EXISTS salary_data (
  id text PRIMARY KEY,
  profile_id text NOT NULL,
  hours_worked numeric NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  days_in_month int NOT NULL DEFAULT 0,
  vacation_pay numeric NOT NULL DEFAULT 0,
  non_cash numeric NOT NULL DEFAULT 0,
  overtime numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  underpayment numeric NOT NULL DEFAULT 0,
  month_year text NOT NULL,
  responsible_user_id text,
  user_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_salary_data_month ON salary_data(month_year);
CREATE INDEX IF NOT EXISTS idx_salary_data_profile ON salary_data(profile_id);

CREATE TABLE IF NOT EXISTS salary_settings (
  id text PRIMARY KEY,
  month_year text,
  percent numeric NOT NULL DEFAULT 2.5,
  is_locked boolean NOT NULL DEFAULT false,
  responsible_profile_id text,
  revenue numeric NOT NULL DEFAULT 0,
  days_in_month int NOT NULL DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_salary_settings_month ON salary_settings(month_year);

CREATE TABLE IF NOT EXISTS manager_data (
  id text PRIMARY KEY,
  profile_id text NOT NULL,
  osn_hours numeric NOT NULL DEFAULT 0,
  dop_hours numeric NOT NULL DEFAULT 0,
  doplaty numeric NOT NULL DEFAULT 0,
  vacation_pay numeric NOT NULL DEFAULT 0,
  non_cash numeric NOT NULL DEFAULT 0,
  underpayment numeric NOT NULL DEFAULT 0,
  hourly_rate numeric NOT NULL DEFAULT 0,
  month_year text NOT NULL,
  user_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_manager_data_month ON manager_data(month_year);

CREATE TABLE IF NOT EXISTS manager_settings (
  id text PRIMARY KEY,
  month_year text,
  manager_percent numeric NOT NULL DEFAULT 5,
  is_locked boolean NOT NULL DEFAULT false,
  responsible_profile_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_manager_settings_month ON manager_settings(month_year);

CREATE TABLE IF NOT EXISTS employee_rotation (
  id text PRIMARY KEY,
  profile_id text NOT NULL,
  position int NOT NULL DEFAULT 1,
  store_name text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employee_rotation_position ON employee_rotation(position);

CREATE TABLE IF NOT EXISTS collection_data (
  id text PRIMARY KEY,
  shift_date text NOT NULL,
  shift_type text NOT NULL,
  sbis_value numeric NOT NULL DEFAULT 0,
  fact_value numeric NOT NULL DEFAULT 0,
  status text,
  responsible_person text NOT NULL DEFAULT '',
  month_year text NOT NULL,
  locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_collection_data_month ON collection_data(month_year);

CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY,
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  author text NOT NULL DEFAULT '',
  tags jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS folders (
  id text PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  parent_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);

CREATE TABLE IF NOT EXISTS base_files (
  id text PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT '',
  size bigint NOT NULL DEFAULT 0,
  folder_id text,
  uploaded_by text NOT NULL DEFAULT '',
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  is_protected boolean NOT NULL DEFAULT false,
  url text
);
CREATE INDEX IF NOT EXISTS idx_base_files_folder ON base_files(folder_id);

CREATE TABLE IF NOT EXISTS dto_categories (
  id text PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dto_templates (
  id text PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  category_id text,
  content text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  usage_count int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chat_rooms (
  id text PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'group',
  participants jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id text PRIMARY KEY,
  room_id text NOT NULL,
  sender_id text NOT NULL DEFAULT '',
  sender_name text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id);
