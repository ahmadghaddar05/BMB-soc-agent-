-- Elastic Security integration fields and safe initial settings.
-- This migration is additive and safe for the existing database.

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS source_system TEXT DEFAULT 'legacy';

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS source_index TEXT;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS elastic_alert_uuid TEXT;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS risk_score DOUBLE PRECISION;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS source_severity TEXT;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS workflow_status TEXT;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS alert_reason TEXT;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS event_dataset TEXT;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS event_category TEXT[] DEFAULT '{}';

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS event_action TEXT;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS group_key TEXT;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS occurrence_count INTEGER DEFAULT 1;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS first_seen TIMESTAMPTZ;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_alerts_source_system
  ON alerts (source_system);

CREATE INDEX IF NOT EXISTS idx_alerts_risk_score
  ON alerts (risk_score DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_source_severity
  ON alerts (source_severity);

CREATE INDEX IF NOT EXISTS idx_alerts_workflow_status
  ON alerts (workflow_status);

CREATE INDEX IF NOT EXISTS idx_alerts_event_dataset
  ON alerts (event_dataset);

CREATE INDEX IF NOT EXISTS idx_alerts_group_key
  ON alerts (group_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_elastic_uuid
  ON alerts (elastic_alert_uuid)
  WHERE elastic_alert_uuid IS NOT NULL;

INSERT INTO settings (key, value) VALUES
  ('alert_source',                  'elastic'),
  ('elastic_read_only',             'true'),
  ('elastic_space_id',              'default'),
  ('elastic_lookback_minutes',      '1'),
  ('elastic_limit',                 '20'),
  ('elastic_min_risk_score',        '48'),
  ('elastic_alert_statuses',        'open,acknowledged'),
  ('elastic_exclude_rules',         ''),
  ('elastic_grouping_enabled',      'true'),
  ('elastic_group_window_minutes',  '5'),
  ('elastic_writeback_enabled',     'false')
ON CONFLICT (key) DO NOTHING;
