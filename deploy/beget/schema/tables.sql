CREATE SEQUENCE IF NOT EXISTS "acc_accruals_id_seq";
CREATE SEQUENCE IF NOT EXISTS "acc_bank_imports_id_seq";
CREATE SEQUENCE IF NOT EXISTS "acc_categories_id_seq";
CREATE SEQUENCE IF NOT EXISTS "acc_counterparties_id_seq";
CREATE SEQUENCE IF NOT EXISTS "acc_cp_docs_id_seq";
CREATE SEQUENCE IF NOT EXISTS "acc_entries_id_seq";
CREATE SEQUENCE IF NOT EXISTS "acc_log_id_seq";
CREATE SEQUENCE IF NOT EXISTS "acc_payments_id_seq";
CREATE SEQUENCE IF NOT EXISTS "acc_staff_id_seq";
CREATE SEQUENCE IF NOT EXISTS "device_logs_id_seq";
CREATE SEQUENCE IF NOT EXISTS "positions_id_seq";
CREATE SEQUENCE IF NOT EXISTS "sber_connections_id_seq";
CREATE SEQUENCE IF NOT EXISTS "sber_pay_attempts_id_seq";
CREATE SEQUENCE IF NOT EXISTS "sber_requests_id_seq";
CREATE SEQUENCE IF NOT EXISTS "skud_clips_id_seq";
CREATE SEQUENCE IF NOT EXISTS "skud_commands_id_seq";
CREATE SEQUENCE IF NOT EXISTS "skud_events_id_seq";
CREATE SEQUENCE IF NOT EXISTS "skud_openings_id_seq";
CREATE SEQUENCE IF NOT EXISTS "skud_schedules_id_seq";
CREATE SEQUENCE IF NOT EXISTS "skud_visits_id_seq";
CREATE SEQUENCE IF NOT EXISTS "vk_bind_codes_id_seq";
CREATE SEQUENCE IF NOT EXISTS "vk_bindings_id_seq";

CREATE TABLE IF NOT EXISTS "acc_access" (
    "profile_id" text NOT NULL,
    "can_entries" boolean DEFAULT false NOT NULL,
    "can_profit" boolean DEFAULT false NOT NULL,
    "can_salary" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "acc_access_pkey" PRIMARY KEY ("profile_id")
);

CREATE TABLE IF NOT EXISTS "acc_accruals" (
    "id" bigint DEFAULT nextval('acc_accruals_id_seq'::regclass) NOT NULL,
    "staff_id" bigint NOT NULL,
    "period" text NOT NULL,
    "pay_type" text NOT NULL,
    "rate" numeric(14,2) DEFAULT 0 NOT NULL,
    "base" numeric(14,2) DEFAULT 0 NOT NULL,
    "bonus" numeric(14,2) DEFAULT 0 NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "comment" text,
    "created_by" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "source_key" text,
    "details" jsonb,
    "void" boolean DEFAULT false NOT NULL,
    CONSTRAINT "acc_accruals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "acc_bank_imports" (
    "id" bigint DEFAULT nextval('acc_bank_imports_id_seq'::regclass) NOT NULL,
    "file_name" text,
    "account" text,
    "date_from" date,
    "date_to" date,
    "added" integer DEFAULT 0 NOT NULL,
    "skipped" integer DEFAULT 0 NOT NULL,
    "created_by" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "acc_bank_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "acc_budget" (
    "period" text NOT NULL,
    "category_id" bigint NOT NULL,
    "amount" numeric(14,2) DEFAULT 0 NOT NULL,
    CONSTRAINT "acc_budget_pkey" PRIMARY KEY ("period", "category_id")
);

CREATE TABLE IF NOT EXISTS "acc_categories" (
    "id" bigint DEFAULT nextval('acc_categories_id_seq'::regclass) NOT NULL,
    "kind" text NOT NULL,
    "name" text NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "acc_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "acc_counterparties" (
    "id" bigint DEFAULT nextval('acc_counterparties_id_seq'::regclass) NOT NULL,
    "name" text NOT NULL,
    "kind" text DEFAULT 'supplier'::text NOT NULL,
    "inn" text,
    "phone" text,
    "comment" text,
    "archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "default_category_id" bigint,
    "kpp" text,
    "account" text,
    "bank_bic" text,
    "bank_name" text,
    "corr_account" text,
    "default_purpose" text,
    "vat_rate" text DEFAULT 'none'::text NOT NULL,
    "requisites_hash" text,
    "requisites_updated_at" timestamp with time zone,
    "requisites_updated_by" text,
    CONSTRAINT "acc_counterparties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "acc_cp_docs" (
    "id" bigint DEFAULT nextval('acc_cp_docs_id_seq'::regclass) NOT NULL,
    "counterparty_id" bigint NOT NULL,
    "direction" text NOT NULL,
    "doc_date" date NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "category_id" bigint,
    "comment" text,
    "created_by" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "acc_cp_docs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "acc_entries" (
    "id" bigint DEFAULT nextval('acc_entries_id_seq'::regclass) NOT NULL,
    "kind" text NOT NULL,
    "entry_date" date NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "category_id" bigint,
    "comment" text,
    "payment_id" bigint,
    "created_by" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "source" text,
    "source_key" text,
    "period" text,
    "counterparty_id" bigint,
    "void" boolean DEFAULT false NOT NULL,
    "bank_purpose" text,
    "bank_connection_id" bigint,
    CONSTRAINT "acc_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "acc_log" (
    "id" bigint DEFAULT nextval('acc_log_id_seq'::regclass) NOT NULL,
    "user_name" text,
    "action" text NOT NULL,
    "details" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "acc_log_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "acc_payments" (
    "id" bigint DEFAULT nextval('acc_payments_id_seq'::regclass) NOT NULL,
    "staff_id" bigint NOT NULL,
    "pay_date" date NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "period" text,
    "comment" text,
    "created_by" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "source_key" text,
    CONSTRAINT "acc_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "acc_periods" (
    "period" text NOT NULL,
    "closed" boolean DEFAULT false NOT NULL,
    "closed_at" timestamp with time zone,
    "closed_by" text,
    "synced_at" timestamp with time zone,
    "snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "fingerprint" text,
    CONSTRAINT "acc_periods_pkey" PRIMARY KEY ("period")
);

CREATE TABLE IF NOT EXISTS "acc_staff" (
    "id" bigint DEFAULT nextval('acc_staff_id_seq'::regclass) NOT NULL,
    "name" text NOT NULL,
    "profile_id" text,
    "position" text,
    "pay_type" text DEFAULT 'salary'::text NOT NULL,
    "rate" numeric(14,2) DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "acc_staff_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "api_tokens" (
    "id" text NOT NULL,
    "user_id" text NOT NULL,
    "token" text NOT NULL,
    "label" text DEFAULT 'Десктоп-приложение'::text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "last_used_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "device_code" text,
    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "api_tokens_token_key" UNIQUE ("token")
);

CREATE TABLE IF NOT EXISTS "app_releases" (
    "id" text NOT NULL,
    "edition" text DEFAULT 'abiz'::text NOT NULL,
    "version" text NOT NULL,
    "url" text NOT NULL,
    "sha256" text DEFAULT ''::text NOT NULL,
    "size_bytes" bigint DEFAULT 0 NOT NULL,
    "notes" text DEFAULT ''::text NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "app_releases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "app_settings" (
    "key" text NOT NULL,
    "value" jsonb NOT NULL,
    "updated_by" text,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "auth_sessions" (
    "id" text NOT NULL,
    "user_id" text NOT NULL,
    "token" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auth_sessions_token_key" UNIQUE ("token")
);

CREATE TABLE IF NOT EXISTS "auth_users" (
    "id" text NOT NULL,
    "email" text NOT NULL,
    "password_hash" text NOT NULL,
    "is_admin" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "auth_users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auth_users_email_key" UNIQUE ("email")
);

CREATE TABLE IF NOT EXISTS "base_files" (
    "id" text NOT NULL,
    "name" text DEFAULT ''::text NOT NULL,
    "type" text DEFAULT ''::text NOT NULL,
    "size" bigint DEFAULT 0 NOT NULL,
    "folder_id" text,
    "uploaded_by" text DEFAULT ''::text NOT NULL,
    "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
    "is_protected" boolean DEFAULT false NOT NULL,
    "url" text,
    CONSTRAINT "base_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "cameras" (
    "id" text NOT NULL,
    "name" text NOT NULL,
    "serial" text NOT NULL,
    "username" text DEFAULT 'admin'::text NOT NULL,
    "password" text DEFAULT ''::text NOT NULL,
    "network_mode" text DEFAULT 'RPS'::text NOT NULL,
    "order_index" integer DEFAULT 0 NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "cloud_token" text,
    "cloud_token_expires" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "live_url_sd" text,
    "live_url_sd_at" timestamp with time zone,
    "live_url_hd" text,
    "live_url_hd_at" timestamp with time zone,
    CONSTRAINT "cameras_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chat_messages" (
    "id" text NOT NULL,
    "room_id" text NOT NULL,
    "sender_id" text DEFAULT ''::text NOT NULL,
    "sender_name" text DEFAULT ''::text NOT NULL,
    "content" text DEFAULT ''::text NOT NULL,
    "read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chat_reads" (
    "user_id" text NOT NULL,
    "room_id" text NOT NULL,
    "last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "chat_reads_pkey" PRIMARY KEY ("user_id", "room_id")
);

CREATE TABLE IF NOT EXISTS "chat_rooms" (
    "id" text NOT NULL,
    "name" text DEFAULT ''::text NOT NULL,
    "type" text DEFAULT 'group'::text NOT NULL,
    "participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "chat_rooms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "collection_data" (
    "id" text NOT NULL,
    "shift_date" text NOT NULL,
    "shift_type" text NOT NULL,
    "sbis_value" numeric DEFAULT 0 NOT NULL,
    "fact_value" numeric DEFAULT 0 NOT NULL,
    "status" text,
    "responsible_person" text DEFAULT ''::text NOT NULL,
    "month_year" text NOT NULL,
    "locked" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT "collection_data_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "companies" (
    "id" text DEFAULT 'main'::text NOT NULL,
    "name" text DEFAULT ''::text NOT NULL,
    "inn" text DEFAULT ''::text NOT NULL,
    "ogrn" text DEFAULT ''::text NOT NULL,
    "type" text DEFAULT 'ООО'::text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "device_commands" (
    "id" text NOT NULL,
    "device_code" varchar(9) NOT NULL,
    "command" text NOT NULL,
    "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_by" text,
    "created_by_name" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "delivered_at" timestamp with time zone,
    "done_at" timestamp with time zone,
    "result" text,
    CONSTRAINT "device_commands_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "device_logs" (
    "id" bigint DEFAULT nextval('device_logs_id_seq'::regclass) NOT NULL,
    "device_code" varchar(9) NOT NULL,
    "kind" text NOT NULL,
    "message" text DEFAULT ''::text NOT NULL,
    "actor_name" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "device_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "devices" (
    "id" text NOT NULL,
    "device_code" varchar(9) NOT NULL,
    "hostname" text DEFAULT ''::text NOT NULL,
    "profile_id" text,
    "status" text DEFAULT 'pending'::text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "linked_at" timestamp with time zone,
    "last_seen_at" timestamp with time zone,
    "presence" text DEFAULT 'offline'::text NOT NULL,
    "heartbeat_at" timestamp with time zone,
    "current_user_name" text,
    "app_version" text,
    "screenshot_url" text,
    "screenshot_at" timestamp with time zone,
    "remote_lock" boolean DEFAULT false NOT NULL,
    "lock_message" text,
    "update_status" text,
    CONSTRAINT "devices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "devices_device_code_key" UNIQUE ("device_code")
);

CREATE TABLE IF NOT EXISTS "documents" (
    "id" text NOT NULL,
    "title" text DEFAULT ''::text NOT NULL,
    "content" text DEFAULT ''::text NOT NULL,
    "author" text DEFAULT ''::text NOT NULL,
    "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dto_categories" (
    "id" text NOT NULL,
    "name" text DEFAULT ''::text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "dto_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dto_templates" (
    "id" text NOT NULL,
    "name" text DEFAULT ''::text NOT NULL,
    "category_id" text,
    "content" text DEFAULT ''::text NOT NULL,
    "description" text DEFAULT ''::text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "usage_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "dto_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "employee_rotation" (
    "id" text NOT NULL,
    "profile_id" text NOT NULL,
    "position" integer DEFAULT 1 NOT NULL,
    "store_name" text DEFAULT ''::text NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "employee_rotation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "employee_schedule_settings" (
    "id" text NOT NULL,
    "profile_id" text NOT NULL,
    "month_year" text NOT NULL,
    "delay" text DEFAULT ''::text NOT NULL,
    "unavailable" text DEFAULT ''::text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "employee_schedule_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "folders" (
    "id" text NOT NULL,
    "name" text DEFAULT ''::text NOT NULL,
    "parent_id" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "kiosk_buttons" (
    "id" text NOT NULL,
    "text" text DEFAULT ''::text NOT NULL,
    "color" text DEFAULT '#125499'::text NOT NULL,
    "action" text DEFAULT 'web'::text NOT NULL,
    "target" text DEFAULT ''::text NOT NULL,
    "order_index" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "kiosk_buttons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "login_links" (
    "id" text NOT NULL,
    "code" text NOT NULL,
    "user_id" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    CONSTRAINT "login_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "login_links_code_key" UNIQUE ("code")
);

CREATE TABLE IF NOT EXISTS "manager_data" (
    "id" text NOT NULL,
    "profile_id" text NOT NULL,
    "osn_hours" numeric DEFAULT 0 NOT NULL,
    "dop_hours" numeric DEFAULT 0 NOT NULL,
    "doplaty" numeric DEFAULT 0 NOT NULL,
    "vacation_pay" numeric DEFAULT 0 NOT NULL,
    "non_cash" numeric DEFAULT 0 NOT NULL,
    "underpayment" numeric DEFAULT 0 NOT NULL,
    "hourly_rate" numeric DEFAULT 0 NOT NULL,
    "month_year" text NOT NULL,
    "user_id" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT "manager_data_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "manager_settings" (
    "id" text NOT NULL,
    "month_year" text,
    "manager_percent" numeric DEFAULT 5 NOT NULL,
    "is_locked" boolean DEFAULT false NOT NULL,
    "responsible_profile_id" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "manager_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pin_codes" (
    "id" text NOT NULL,
    "user_id" text,
    "pin" varchar(4) NOT NULL,
    "email" text NOT NULL,
    "shortcut_code" text DEFAULT 'default'::text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "adpod_slug" text,
    CONSTRAINT "pin_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "positions" (
    "id" bigint DEFAULT nextval('positions_id_seq'::regclass) NOT NULL,
    "name" text NOT NULL,
    "sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "profiles" (
    "id" text NOT NULL,
    "user_id" text,
    "full_name" text DEFAULT ''::text NOT NULL,
    "email" text DEFAULT ''::text NOT NULL,
    "role" text DEFAULT 'employee'::text NOT NULL,
    "department" text DEFAULT ''::text NOT NULL,
    "status" text DEFAULT 'active'::text NOT NULL,
    "has_system_access" boolean DEFAULT false NOT NULL,
    "vk_id" text,
    "vk_link" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "position_id" bigint,
    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "recorder_keys" (
    "key" text NOT NULL,
    "device_code" varchar(9) NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "last_used_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "recorder_keys_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "salary_data" (
    "id" text NOT NULL,
    "profile_id" text NOT NULL,
    "hours_worked" numeric DEFAULT 0 NOT NULL,
    "revenue" numeric DEFAULT 0 NOT NULL,
    "days_in_month" integer DEFAULT 0 NOT NULL,
    "vacation_pay" numeric DEFAULT 0 NOT NULL,
    "non_cash" numeric DEFAULT 0 NOT NULL,
    "overtime" numeric DEFAULT 0 NOT NULL,
    "tax" numeric DEFAULT 0 NOT NULL,
    "underpayment" numeric DEFAULT 0 NOT NULL,
    "month_year" text NOT NULL,
    "responsible_user_id" text,
    "user_id" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT "salary_data_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "salary_settings" (
    "id" text NOT NULL,
    "month_year" text,
    "percent" numeric DEFAULT 2.5 NOT NULL,
    "is_locked" boolean DEFAULT false NOT NULL,
    "responsible_profile_id" text,
    "revenue" numeric DEFAULT 0 NOT NULL,
    "days_in_month" integer DEFAULT 30 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "salary_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sber_connections" (
    "id" bigint DEFAULT nextval('sber_connections_id_seq'::regclass) NOT NULL,
    "title" text NOT NULL,
    "org" jsonb,
    "account" text,
    "is_default" boolean DEFAULT false NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "last_sync" timestamp with time zone,
    "last_sync_result" jsonb,
    "last_error" text,
    "created_by" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "sber_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sber_oauth" (
    "state" text NOT NULL,
    "nonce" text NOT NULL,
    "user_id" text NOT NULL,
    "used" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "origin" text,
    CONSTRAINT "sber_oauth_pkey" PRIMARY KEY ("state")
);

CREATE TABLE IF NOT EXISTS "sber_pay_attempts" (
    "id" bigint DEFAULT nextval('sber_pay_attempts_id_seq'::regclass) NOT NULL,
    "user_id" text NOT NULL,
    "ok" boolean NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "sber_pay_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sber_requests" (
    "id" bigint DEFAULT nextval('sber_requests_id_seq'::regclass) NOT NULL,
    "counterparty_id" bigint NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "purpose" text NOT NULL,
    "vat_rate" text DEFAULT 'none'::text NOT NULL,
    "week_start" date NOT NULL,
    "status" text DEFAULT 'draft'::text NOT NULL,
    "requisites" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "requisites_hash" text,
    "created_by" text,
    "created_by_user" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "sent_at" timestamp with time zone,
    "decided_by" text,
    "decided_at" timestamp with time zone,
    "reject_reason" text,
    "external_id" text,
    "bank_status" text,
    "bank_comment" text,
    "bank_checked_at" timestamp with time zone,
    "entry_id" bigint,
    "category_id" bigint,
    "connection_id" bigint,
    "period" text,
    CONSTRAINT "sber_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sber_requests_external_id_key" UNIQUE ("external_id")
);

CREATE TABLE IF NOT EXISTS "sber_vault" (
    "key" text NOT NULL,
    "value" text NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "sber_vault_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "schedule_config" (
    "id" text NOT NULL,
    "profile_id" text NOT NULL,
    "no_day" boolean DEFAULT false NOT NULL,
    "no_night" boolean DEFAULT false NOT NULL,
    "break_days" integer DEFAULT 0 NOT NULL,
    "priority" integer DEFAULT 3 NOT NULL,
    "status" text DEFAULT 'ЛБ'::text NOT NULL,
    "preferences" text DEFAULT ''::text NOT NULL,
    "excluded" boolean DEFAULT false NOT NULL,
    "st_no_day" boolean DEFAULT false NOT NULL,
    "st_no_night" boolean DEFAULT false NOT NULL,
    "ml_no_day" boolean DEFAULT false NOT NULL,
    "ml_no_night" boolean DEFAULT false NOT NULL,
    "delays" text DEFAULT ''::text NOT NULL,
    "unavailable" text DEFAULT ''::text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "schedule_config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "schedule_data" (
    "id" text NOT NULL,
    "month_year" text NOT NULL,
    "profile_id" text NOT NULL,
    "shifts" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "user_id" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "schedule_data_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "schedule_settings" (
    "id" text NOT NULL,
    "month_year" text,
    "is_locked" boolean DEFAULT false NOT NULL,
    "responsible_profile_id" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "schedule_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "skud_cards" (
    "id" text DEFAULT md5(((random())::text || (clock_timestamp())::text)) NOT NULL,
    "card_number" text NOT NULL,
    "profile_id" text,
    "label" text,
    "status" text DEFAULT 'active'::text NOT NULL,
    "valid_from" date,
    "valid_to" date,
    "synced" boolean DEFAULT false NOT NULL,
    "created_by" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "card_type" text DEFAULT 'employee'::text NOT NULL,
    "pin_code" text,
    "schedule_id" integer,
    "written_at" timestamp with time zone DEFAULT now() NOT NULL,
    "written_by" text,
    CONSTRAINT "skud_cards_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "skud_cards_card_number_key" UNIQUE ("card_number")
);

CREATE TABLE IF NOT EXISTS "skud_clips" (
    "id" bigint DEFAULT nextval('skud_clips_id_seq'::regclass) NOT NULL,
    "visit_id" bigint NOT NULL,
    "opening_id" bigint,
    "camera_id" text NOT NULL,
    "mode" text NOT NULL,
    "part_no" integer DEFAULT 0 NOT NULL,
    "clip_from" timestamp with time zone NOT NULL,
    "clip_to" timestamp with time zone NOT NULL,
    "status" text DEFAULT 'pending'::text NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "taken_at" timestamp with time zone,
    "url" text,
    "size_bytes" bigint,
    "error" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "done_at" timestamp with time zone,
    "parts" text,
    "duration_sec" integer,
    CONSTRAINT "skud_clips_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "skud_commands" (
    "id" bigint DEFAULT nextval('skud_commands_id_seq'::regclass) NOT NULL,
    "controller_id" text NOT NULL,
    "operation" text NOT NULL,
    "payload" text,
    "created_by" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "sent_at" timestamp with time zone,
    "done_at" timestamp with time zone,
    "result" text,
    CONSTRAINT "skud_commands_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "skud_controllers" (
    "id" text DEFAULT md5(((random())::text || (clock_timestamp())::text)) NOT NULL,
    "name" text DEFAULT 'Склад'::text NOT NULL,
    "serial" text,
    "model" text,
    "secret" text DEFAULT md5(((random())::text || (clock_timestamp())::text)) NOT NULL,
    "camera_id" text,
    "open_seconds" integer DEFAULT 3 NOT NULL,
    "last_seen_at" timestamp with time zone,
    "last_ip" text,
    "fw_version" text,
    "conn_fw" text,
    "door_open" boolean,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "inside_camera_id" text,
    "pre_seconds" integer DEFAULT 10 NOT NULL,
    "post_seconds" integer DEFAULT 10 NOT NULL,
    "recorder_device" text,
    "recorder_quality" text DEFAULT 'sd'::text NOT NULL,
    "recorder_status" text,
    "recorder_seen_at" timestamp with time zone,
    "gate_host" text,
    "gate_port" integer DEFAULT 5000 NOT NULL,
    "gate_address" integer DEFAULT 1 NOT NULL,
    "gate_status" text,
    "gate_seen_at" timestamp with time zone,
    "emergency_open" boolean DEFAULT false NOT NULL,
    "antipassback" boolean DEFAULT false NOT NULL,
    "outputs" text,
    CONSTRAINT "skud_controllers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "skud_controllers_serial_key" UNIQUE ("serial")
);

CREATE TABLE IF NOT EXISTS "skud_enroll" (
    "id" integer DEFAULT 1 NOT NULL,
    "until_at" timestamp with time zone,
    "card_number" text,
    "captured_at" timestamp with time zone,
    CONSTRAINT "skud_enroll_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "skud_events" (
    "id" bigint DEFAULT nextval('skud_events_id_seq'::regclass) NOT NULL,
    "controller_id" text,
    "event_time" timestamp with time zone NOT NULL,
    "received_at" timestamp with time zone DEFAULT now() NOT NULL,
    "event_code" integer,
    "event_kind" text NOT NULL,
    "direction" text,
    "granted" boolean,
    "card_number" text,
    "profile_id" text,
    "person_name" text,
    "note" text,
    "source" text DEFAULT 'controller'::text NOT NULL,
    "raw" text,
    "processed" boolean DEFAULT false NOT NULL,
    CONSTRAINT "skud_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "skud_events_controller_id_event_time_event_code_card_number_key" UNIQUE ("controller_id", "event_time", "event_code", "card_number")
);

CREATE TABLE IF NOT EXISTS "skud_notice_dismiss" (
    "user_id" text NOT NULL,
    "card_id" text NOT NULL,
    "cycle" timestamp with time zone NOT NULL,
    "dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "skud_notice_dismiss_pkey" PRIMARY KEY ("user_id", "card_id", "cycle")
);

CREATE TABLE IF NOT EXISTS "skud_openings" (
    "id" bigint DEFAULT nextval('skud_openings_id_seq'::regclass) NOT NULL,
    "visit_id" bigint NOT NULL,
    "controller_id" text NOT NULL,
    "status" text DEFAULT 'open'::text NOT NULL,
    "opened_at" timestamp with time zone NOT NULL,
    "last_open_at" timestamp with time zone NOT NULL,
    "closed_at" timestamp with time zone,
    "closed_assumed" boolean DEFAULT false NOT NULL,
    "held" boolean DEFAULT false NOT NULL,
    "marks" text DEFAULT '[]'::text NOT NULL,
    CONSTRAINT "skud_openings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "skud_schedules" (
    "id" integer DEFAULT nextval('skud_schedules_id_seq'::regclass) NOT NULL,
    "name" text NOT NULL,
    "days" integer DEFAULT 31 NOT NULL,
    "time_from" text DEFAULT '08:00'::text NOT NULL,
    "time_to" text DEFAULT '20:00'::text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "skud_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "skud_visits" (
    "id" bigint DEFAULT nextval('skud_visits_id_seq'::regclass) NOT NULL,
    "controller_id" text NOT NULL,
    "status" text DEFAULT 'open'::text NOT NULL,
    "started_at" timestamp with time zone NOT NULL,
    "ended_at" timestamp with time zone,
    "inside" integer DEFAULT 0 NOT NULL,
    "entries" integer DEFAULT 0 NOT NULL,
    "exits" integer DEFAULT 0 NOT NULL,
    "people" text DEFAULT '[]'::text NOT NULL,
    "alarm" boolean DEFAULT false NOT NULL,
    "note" text,
    "inside_until" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "skud_visits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "skud_vk_sent" (
    "key" text NOT NULL,
    "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "skud_vk_sent_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "vk_bind_codes" (
    "id" bigint DEFAULT nextval('vk_bind_codes_id_seq'::regclass) NOT NULL,
    "profile_id" text NOT NULL,
    "code" varchar(6) NOT NULL,
    "status" varchar(20) DEFAULT 'pending'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "vk_bind_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "vk_bindings" (
    "id" bigint DEFAULT nextval('vk_bindings_id_seq'::regclass) NOT NULL,
    "profile_id" text NOT NULL,
    "vk_user_id" bigint,
    "vk_link" text,
    "status" varchar(20) DEFAULT 'pending'::character varying NOT NULL,
    "message" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "vk_bindings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vk_bindings_profile_id_key" UNIQUE ("profile_id")
);
