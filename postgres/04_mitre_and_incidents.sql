-- MITRE ATT&CK columns, incident type, Anthropic provider + incident-promotion
-- settings (additive; safe on an existing DB).
-- Apply to a running DB:
--   docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < postgres/init/04_mitre_and_incidents.sql

-- MITRE mapping on alerts (techniques like T1110, tactics like credential_access)
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS mitre_techniques TEXT[] DEFAULT '{}';
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS mitre_tactics    TEXT[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_alerts_mitre_tactics ON alerts USING GIN (mitre_tactics);

-- Distinguish correlated incidents from single-alert (triage queue) incidents
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS incident_type TEXT DEFAULT 'correlation';

-- New settings
INSERT INTO settings (key, value) VALUES
  ('anthropic_model',                'claude-sonnet-4-6'),
  ('incident_promote_enabled',       'true'),
  ('incident_promote_verdicts',      'true_positive,needs_investigation'),
  ('incident_promote_min_severity',  'high')
ON CONFLICT (key) DO NOTHING;
