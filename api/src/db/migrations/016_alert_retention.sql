-- Severity-aware retention for the BMB PostgreSQL alert evidence store.
-- Elastic source indices/data streams remain outside this lifecycle boundary.

INSERT INTO settings(key,value) VALUES
  ('alert_retention_enabled','false'),
  ('alert_retention_critical_days','14'),
  ('alert_retention_high_days','10'),
  ('alert_retention_default_days','7'),
  ('alert_retention_batch_size','5000')
ON CONFLICT(key) DO NOTHING;

CREATE TABLE IF NOT EXISTS alert_retention_runs (
  id BIGSERIAL PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('policy','initial_7_day_purge')),
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed','skipped')),
  actor TEXT NOT NULL,
  request_id TEXT,
  policy JSONB NOT NULL DEFAULT '{}',
  candidate_counts JSONB NOT NULL DEFAULT '{}',
  protected_counts JSONB NOT NULL DEFAULT '{}',
  deleted_counts JSONB NOT NULL DEFAULT '{}',
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_alert_retention_runs_started
  ON alert_retention_runs(started_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_retention_observed
  ON alerts((COALESCE(last_seen,timestamp,fetched_at)));
