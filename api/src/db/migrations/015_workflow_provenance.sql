-- Explainable workflow provenance.
--
-- This append-only ledger connects collection, normalization, enrichment,
-- triage, correlation, and incident decisions without replacing the existing
-- fetch-run, Hermes-run, or audit-event records.

CREATE TABLE IF NOT EXISTS workflow_stage_events (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL
    CHECK (entity_type IN ('alert','incident','fetch_run')),
  entity_id TEXT NOT NULL,
  stage TEXT NOT NULL
    CHECK (stage IN (
      'collected','normalized','enriched','triaged',
      'correlated','incident_decision'
    )),
  status TEXT NOT NULL
    CHECK (status IN ('pending','running','completed','failed','skipped')),
  executor_type TEXT NOT NULL
    CHECK (executor_type IN ('system','ai','analyst','cache')),
  actor TEXT NOT NULL,
  fetch_run_id INTEGER REFERENCES fetch_runs(id) ON DELETE SET NULL,
  agent_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  provider TEXT,
  model TEXT,
  confidence_kind TEXT
    CHECK (confidence_kind IS NULL OR confidence_kind IN (
      'triage','correlation','incident'
    )),
  confidence DOUBLE PRECISION
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  input_summary JSONB NOT NULL DEFAULT '{}',
  output_summary JSONB NOT NULL DEFAULT '{}',
  reason TEXT,
  limitations JSONB NOT NULL DEFAULT '[]',
  error_code TEXT,
  error_message TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(input_summary) = 'object'),
  CHECK (jsonb_typeof(output_summary) = 'object'),
  CHECK (jsonb_typeof(limitations) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_workflow_stage_entity
  ON workflow_stage_events(entity_type,entity_id,created_at,id);
CREATE INDEX IF NOT EXISTS idx_workflow_stage_fetch_run
  ON workflow_stage_events(fetch_run_id,created_at,id)
  WHERE fetch_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_stage_agent_run
  ON workflow_stage_events(agent_run_id,created_at,id)
  WHERE agent_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_stage_status
  ON workflow_stage_events(stage,status,created_at DESC);
