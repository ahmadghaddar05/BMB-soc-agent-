-- Phase 8: durable, retry-safe autonomous internal SOC orchestration.

CREATE TABLE IF NOT EXISTS autonomous_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fetch_run_id INTEGER REFERENCES fetch_runs(id) ON DELETE SET NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','partial','failed')),
  policy_version TEXT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}',
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS autonomous_operations (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES autonomous_runs(id) ON DELETE CASCADE,
  operation_key TEXT NOT NULL UNIQUE CHECK (char_length(operation_key) <= 200),
  operation_type TEXT NOT NULL CHECK (operation_type IN (
    'create_investigation','add_investigation_note','add_case_note',
    'request_case_assignment'
  )),
  source_type TEXT NOT NULL CHECK (source_type IN ('alert','case')),
  source_id TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  reason TEXT,
  result JSONB,
  error_code TEXT,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_autonomous_runs_started
  ON autonomous_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_operations_run
  ON autonomous_operations(run_id, started_at);
CREATE INDEX IF NOT EXISTS idx_autonomous_operations_source
  ON autonomous_operations(source_type, source_id, operation_type, status);

ALTER TABLE fetch_runs ADD COLUMN IF NOT EXISTS autonomous_run_id UUID;
ALTER TABLE fetch_runs ADD COLUMN IF NOT EXISTS investigations_created INTEGER DEFAULT 0;
ALTER TABLE fetch_runs ADD COLUMN IF NOT EXISTS investigation_notes_added INTEGER DEFAULT 0;
ALTER TABLE fetch_runs ADD COLUMN IF NOT EXISTS case_notes_added INTEGER DEFAULT 0;
ALTER TABLE fetch_runs ADD COLUMN IF NOT EXISTS approvals_requested INTEGER DEFAULT 0;
ALTER TABLE fetch_runs ADD COLUMN IF NOT EXISTS autonomous_failures INTEGER DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fetch_runs_autonomous_run_fk'
  ) THEN
    ALTER TABLE fetch_runs ADD CONSTRAINT fetch_runs_autonomous_run_fk
      FOREIGN KEY (autonomous_run_id) REFERENCES autonomous_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

INSERT INTO settings(key,value) VALUES
  ('autonomous_agent_enabled','false'),
  ('autonomous_lookback_hours','24'),
  ('autonomous_max_items','20'),
  ('autonomous_min_confidence','0.70'),
  ('autonomous_assignment_enabled','true'),
  ('autonomous_default_owner','SOC Analyst')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE agent_evidence_links
  DROP CONSTRAINT IF EXISTS agent_evidence_links_evidence_type_check;
ALTER TABLE agent_evidence_links
  ADD CONSTRAINT agent_evidence_links_evidence_type_check
  CHECK (evidence_type IN (
    'alert','incident','alert_group','asset','identity','observable','fetch_run',
    'investigation','case','action_request','autonomous_run'
  ));
