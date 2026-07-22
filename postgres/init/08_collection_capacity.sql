-- Controlled Elastic collection capacity.

INSERT INTO settings (key, value)
VALUES
  ('elastic_cursor_page_size', '100'),
  ('elastic_cursor_max_pages', '5'),
  ('enrichment_batch_size', '500')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
