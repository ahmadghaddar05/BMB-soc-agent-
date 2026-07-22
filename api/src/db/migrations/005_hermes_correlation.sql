-- Phase 5: Hermes-only correlation provenance and stable incident linkage.

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS correlation_run_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'incidents_correlation_run_fk'
  ) THEN
    ALTER TABLE incidents
      ADD CONSTRAINT incidents_correlation_run_fk
      FOREIGN KEY (correlation_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_incidents_correlation_run_id
  ON incidents(correlation_run_id) WHERE correlation_run_id IS NOT NULL;

-- New installations and upgrades require an explicit analyst decision before
-- scheduled correlation is activated. Manual correlate-now remains available.
UPDATE settings SET value='false', updated_at=NOW()
WHERE key='correlation_enabled';

-- No runtime path uses direct model providers after the Hermes correlation
-- migration. Remove obsolete database configuration without touching secrets.
DELETE FROM settings
WHERE key IN ('llm_provider','groq_model','anthropic_model','ollama_model');
