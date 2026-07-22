-- Phase 9: approval-gated, reversible simulated response. No external writes.

ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS preview JSONB;

ALTER TABLE autonomous_operations
  DROP CONSTRAINT IF EXISTS autonomous_operations_operation_type_check;
ALTER TABLE autonomous_operations
  ADD CONSTRAINT autonomous_operations_operation_type_check
  CHECK (operation_type IN (
    'create_investigation','add_investigation_note','add_case_note',
    'request_case_assignment','request_simulated_response'
  ));

INSERT INTO settings(key,value) VALUES
  ('simulated_response_proposals_enabled','false')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE action_requests
  DROP CONSTRAINT IF EXISTS action_requests_action_type_check;
ALTER TABLE action_requests
  ADD CONSTRAINT action_requests_action_type_check
  CHECK (action_type IN (
    'investigation.create','investigation.add_note','case.add_note',
    'investigation.update','case.update','response.simulate','response.rollback'
  ));

CREATE TABLE IF NOT EXISTS simulated_response_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  response_type TEXT NOT NULL CHECK (response_type IN (
    'endpoint_isolate','identity_suspend','ip_block'
  )),
  target_value TEXT NOT NULL CHECK (char_length(target_value) BETWEEN 1 AND 253),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','reverted')),
  evidence_alert_ids TEXT[] NOT NULL CHECK (cardinality(evidence_alert_ids) BETWEEN 1 AND 100),
  action_request_id UUID NOT NULL UNIQUE REFERENCES action_requests(id) ON DELETE RESTRICT,
  executed_by TEXT NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  verification JSONB,
  rollback_action_request_id UUID UNIQUE REFERENCES action_requests(id) ON DELETE RESTRICT,
  reverted_by TEXT,
  reverted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS simulated_response_one_active_target
  ON simulated_response_states(response_type,LOWER(target_value)) WHERE state='active';
CREATE INDEX IF NOT EXISTS idx_simulated_response_state_updated
  ON simulated_response_states(state,updated_at DESC);

CREATE TABLE IF NOT EXISTS simulated_response_events (
  id BIGSERIAL PRIMARY KEY,
  response_id UUID NOT NULL REFERENCES simulated_response_states(id) ON DELETE CASCADE,
  action_request_id UUID NOT NULL REFERENCES action_requests(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('executed','verified','reverted')),
  actor TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_simulated_response_events_response
  ON simulated_response_events(response_id,created_at DESC);

ALTER TABLE agent_evidence_links
  DROP CONSTRAINT IF EXISTS agent_evidence_links_evidence_type_check;
ALTER TABLE agent_evidence_links
  ADD CONSTRAINT agent_evidence_links_evidence_type_check
  CHECK (evidence_type IN (
    'alert','incident','alert_group','asset','identity','observable','fetch_run',
    'investigation','case','action_request','autonomous_run','simulated_response'
  ));
