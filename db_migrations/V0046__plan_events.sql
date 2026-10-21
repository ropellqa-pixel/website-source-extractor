CREATE TABLE IF NOT EXISTS plan_events (
    id text PRIMARY KEY,
    company_id text,
    plan_date date NOT NULL,
    status text NOT NULL DEFAULT '',
    color text NOT NULL DEFAULT '#9BE15D',
    note text NOT NULL DEFAULT '',
    created_by text,
    created_by_name text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plan_events_date_idx ON plan_events (company_id, plan_date);