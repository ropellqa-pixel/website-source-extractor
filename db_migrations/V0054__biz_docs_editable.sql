ALTER TABLE biz_documents ADD COLUMN IF NOT EXISTS custom_html text NOT NULL DEFAULT '';
ALTER TABLE biz_documents ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';
ALTER TABLE biz_documents ADD COLUMN IF NOT EXISTS edited_at timestamptz NULL;
ALTER TABLE biz_documents ADD COLUMN IF NOT EXISTS edited_by text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_biz_docs_number ON biz_documents(number);