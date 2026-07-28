INSERT INTO settings(key,value,updated_at)
VALUES
  ('live_collection_enabled','true',NOW()),
  ('live_collection_interval_seconds','15',NOW())
ON CONFLICT(key) DO NOTHING;
