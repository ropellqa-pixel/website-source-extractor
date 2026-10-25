CREATE TABLE IF NOT EXISTS inv_items (
  id serial PRIMARY KEY,
  code varchar(6) NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'equipment',
  unit text NOT NULL DEFAULT 'шт',
  qty numeric(12,3) NOT NULL DEFAULT 0,
  price numeric(12,2) NOT NULL DEFAULT 0,
  location text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  archived boolean NOT NULL DEFAULT false,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inv_docs (
  id serial PRIMARY KEY,
  number varchar(6) NOT NULL UNIQUE,
  kind text NOT NULL,
  doc_date date NOT NULL DEFAULT CURRENT_DATE,
  reason text NOT NULL DEFAULT '',
  comment text NOT NULL DEFAULT '',
  total numeric(14,2) NOT NULL DEFAULT 0,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inv_doc_lines (
  id serial PRIMARY KEY,
  doc_id integer NOT NULL REFERENCES inv_docs(id),
  item_id integer NOT NULL REFERENCES inv_items(id),
  item_code varchar(6) NOT NULL,
  item_name text NOT NULL,
  qty numeric(12,3) NOT NULL DEFAULT 0,
  qty_before numeric(12,3) NOT NULL DEFAULT 0,
  qty_after numeric(12,3) NOT NULL DEFAULT 0,
  price numeric(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS inv_doc_lines_doc ON inv_doc_lines(doc_id);
CREATE INDEX IF NOT EXISTS inv_doc_lines_item ON inv_doc_lines(item_id);