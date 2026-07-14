-- Triage cache + signature column + new settings (additive; safe on existing DB).
-- Apply to a running DB:
--   docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB < postgres/init/03_triage_cache.sql

-- Per-alert noise-reduction signature (rule + key entities). Lets us see how
-- many distinct alert "shapes" exist vs raw volume.
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS signature TEXT;
CREATE INDEX IF NOT EXISTS idx_alerts_signature ON alerts (signature);

-- Triage verdict cache, keyed by signature. An identical alert reuses the
-- cached verdict instead of calling the LLM again.
CREATE TABLE IF NOT EXISTS triage_cache (
  signature  TEXT PRIMARY KEY,
  rule_id    TEXT,
  verdict    JSONB       NOT NULL,
  hits       INTEGER     DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO settings (key, value) VALUES
  ('caching_enabled', 'true')
ON CONFLICT (key) DO NOTHING;
