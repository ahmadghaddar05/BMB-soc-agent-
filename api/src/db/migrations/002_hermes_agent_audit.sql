CREATE TABLE IF NOT EXISTS agent_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel TEXT NOT NULL DEFAULT 'chat' CHECK (channel IN ('chat','triage','investigation','correlation','system')),
  created_by TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','archived')),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool')),
  content TEXT NOT NULL,
  run_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES agent_conversations(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('chat','triage','investigation','correlation','evaluation')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','cancelled')),
  actor TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'hermes' CHECK (provider = 'hermes'),
  model TEXT,
  hermes_run_id TEXT,
  prompt_version TEXT NOT NULL,
  output_schema_version TEXT NOT NULL,
  request_id TEXT,
  idempotency_key TEXT NOT NULL,
  capabilities JSONB,
  input_summary JSONB NOT NULL DEFAULT '{}',
  output_summary JSONB,
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  total_tokens BIGINT NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  latency_ms BIGINT NOT NULL DEFAULT 0,
  error_code TEXT,
  error_category TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_runs_idempotency_key_unique UNIQUE (idempotency_key)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_messages_run_fk'
  ) THEN
    ALTER TABLE agent_messages
      ADD CONSTRAINT agent_messages_run_fk
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  hermes_call_id TEXT,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed','denied','cancelled')),
  arguments JSONB NOT NULL DEFAULT '{}',
  result_summary JSONB,
  error_code TEXT,
  latency_ms BIGINT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agent_evidence_links (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('alert','incident','alert_group','asset','identity','observable','fetch_run')),
  evidence_id TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'input' CHECK (relation IN ('input','citation','output')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_evidence_unique UNIQUE (run_id, evidence_type, evidence_id, relation)
);

CREATE TABLE IF NOT EXISTS action_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','cancelled','executed','failed')),
  parameters JSONB NOT NULL DEFAULT '{}',
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS action_approvals (
  id BIGSERIAL PRIMARY KEY,
  action_request_id UUID NOT NULL REFERENCES action_requests(id) ON DELETE CASCADE,
  decided_by TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved','denied')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('success','failure','denied','cancelled')),
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_conversations_actor_updated ON agent_conversations (created_by, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation_created ON agent_messages (conversation_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation_created ON agent_runs (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_purpose_status_created ON agent_runs (purpose, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_hermes_run_id ON agent_runs (hermes_run_id) WHERE hermes_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_run ON agent_tool_calls (run_id, started_at);
CREATE INDEX IF NOT EXISTS idx_agent_evidence_lookup ON agent_evidence_links (evidence_type, evidence_id);
CREATE INDEX IF NOT EXISTS idx_action_requests_status_created ON action_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_target_created ON audit_events (target_type, target_id, created_at DESC);

DROP TRIGGER IF EXISTS agent_conversations_updated_at ON agent_conversations;
DROP TRIGGER IF EXISTS action_requests_updated_at ON action_requests;
CREATE TRIGGER agent_conversations_updated_at BEFORE UPDATE ON agent_conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER action_requests_updated_at BEFORE UPDATE ON action_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
