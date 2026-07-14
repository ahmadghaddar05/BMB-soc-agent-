-- Persistent Elasticsearch search_after cursor.

INSERT INTO settings (key, value)
VALUES
  ('elastic_cursor_enabled', 'false'),
  ('elastic_cursor_json', ''),
  ('elastic_cursor_page_size', '20'),
  ('elastic_cursor_max_pages', '5'),
  ('elastic_cursor_delay_seconds', '15')
ON CONFLICT (key) DO NOTHING;
