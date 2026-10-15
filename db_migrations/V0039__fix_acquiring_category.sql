UPDATE t_p59581145_website_source_extra.acc_entries
SET category_id = (SELECT id FROM t_p59581145_website_source_extra.acc_categories WHERE kind = 'income' AND name = 'Эквайринг (оплата картой)'),
    updated_at = now()
WHERE source = 'bank' AND kind = 'income'
  AND bank_purpose ILIKE '%эквайр%'
  AND category_id = (SELECT id FROM t_p59581145_website_source_extra.acc_categories WHERE kind = 'income' AND name = 'Возврат по карте');