-- Controlled Elastic collection capacity: 1,000 alerts per cycle.

INSERT INTO settings (key, value)
VALUES
  ('elastic_cursor_page_size', '200'),
  ('elastic_cursor_max_pages', '5'),
  ('enrichment_batch_size', '1000')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
