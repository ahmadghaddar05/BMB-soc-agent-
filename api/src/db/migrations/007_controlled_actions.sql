ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS policy_version TEXT NOT NULL DEFAULT 'phase7-v1';
ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ;
ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS executed_by TEXT;
ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS result JSONB;
ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS error_code TEXT;

ALTER TABLE action_requests
  DROP CONSTRAINT IF EXISTS action_requests_action_type_check;
ALTER TABLE action_requests
  ADD CONSTRAINT action_requests_action_type_check
  CHECK (action_type IN (
    'investigation.create','investigation.add_note','case.add_note',
    'investigation.update','case.update'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS action_requests_idempotency_key_unique
  ON action_requests(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS action_approvals_one_decision
  ON action_approvals(action_request_id);
CREATE INDEX IF NOT EXISTS idx_action_requests_target_created
  ON action_requests(target_type,target_id,created_at DESC);

ALTER TABLE agent_evidence_links
  DROP CONSTRAINT IF EXISTS agent_evidence_links_evidence_type_check;
ALTER TABLE agent_evidence_links
  ADD CONSTRAINT agent_evidence_links_evidence_type_check
  CHECK (evidence_type IN (
    'alert','incident','alert_group','asset','identity','observable','fetch_run',
    'investigation','case','action_request'
  ));
