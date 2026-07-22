-- Correlation settings (additive; safe to run on an existing DB).
-- Postgres runs files in /docker-entrypoint-initdb.d in alphabetical order,
-- so this loads after 01_schema.sql on a fresh volume. For an already-running
-- DB, apply it manually:  docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB < postgres/init/02_correlation_settings.sql

INSERT INTO settings (key, value) VALUES
  ('correlation_enabled',        'true'),
  ('correlation_lookback_hours', '24'),
  ('correlation_max_alerts',     '60')
ON CONFLICT (key) DO NOTHING;
