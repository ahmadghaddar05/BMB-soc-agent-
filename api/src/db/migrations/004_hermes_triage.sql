-- Phase 4: Hermes-only triage provenance and cache identity.
-- Old signature-only cache rows are intentionally invalidated because they do
-- not identify the prompt, schema, model, or enrichment evidence used.

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS triage_run_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alerts_triage_run_fk'
  ) THEN
    ALTER TABLE alerts
      ADD CONSTRAINT alerts_triage_run_fk
      FOREIGN KEY (triage_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE triage_cache ADD COLUMN IF NOT EXISTS alert_signature TEXT;
ALTER TABLE triage_cache ADD COLUMN IF NOT EXISTS prompt_version TEXT;
ALTER TABLE triage_cache ADD COLUMN IF NOT EXISTS output_schema_version TEXT;
ALTER TABLE triage_cache ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE triage_cache ADD COLUMN IF NOT EXISTS enrichment_fingerprint TEXT;
ALTER TABLE triage_cache ADD COLUMN IF NOT EXISTS agent_run_id UUID;
ALTER TABLE triage_cache ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'triage_cache_agent_run_fk'
  ) THEN
    ALTER TABLE triage_cache
      ADD CONSTRAINT triage_cache_agent_run_fk
      FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

DELETE FROM triage_cache
WHERE prompt_version IS NULL
   OR output_schema_version IS NULL
   OR enrichment_fingerprint IS NULL
   OR agent_run_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_alerts_triage_run_id
  ON alerts(triage_run_id) WHERE triage_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_triage_cache_alert_signature
  ON triage_cache(alert_signature, expires_at DESC);

-- Phase 4 does not authorize automated closure or Phase 5 correlation.
UPDATE settings SET value='false', updated_at=NOW()
WHERE key IN ('autoclose_enabled','correlation_enabled','incident_promote_enabled');

UPDATE settings SET value='pipeline', updated_at=NOW()
WHERE key='triage_mode' AND value NOT IN ('pipeline','agentic','hybrid');
