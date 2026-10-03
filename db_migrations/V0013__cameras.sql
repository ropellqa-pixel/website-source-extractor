CREATE TABLE IF NOT EXISTS t_p59581145_website_source_extra.cameras (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    serial TEXT NOT NULL,
    username TEXT NOT NULL DEFAULT 'admin',
    password TEXT NOT NULL DEFAULT '',
    network_mode TEXT NOT NULL DEFAULT 'RPS',
    order_index INTEGER NOT NULL DEFAULT 0,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    cloud_token TEXT,
    cloud_token_expires TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cameras_serial_uq ON t_p59581145_website_source_extra.cameras (serial);