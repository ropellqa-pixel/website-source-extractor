UPDATE t_p59581145_website_source_extra.acc_entries
SET category_id = (SELECT id FROM t_p59581145_website_source_extra.acc_categories WHERE kind = 'expense' AND name = 'Банковские комиссии'),
    updated_at = now()
WHERE source = 'bank' AND kind = 'expense' AND category_id IS NULL AND bank_purpose ILIKE '%пакет услуг%';