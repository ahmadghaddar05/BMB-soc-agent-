CREATE TABLE IF NOT EXISTS agent_run_steps (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL CHECK (step_number > 0),
  hermes_run_id TEXT NOT NULL,
  step_type TEXT NOT NULL CHECK (step_type IN ('tool_call','final','unknown')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','failed','cancelled')),
  model TEXT,
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  total_tokens BIGINT NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  latency_ms BIGINT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_run_steps_run_step_unique UNIQUE (run_id, step_number),
  CONSTRAINT agent_run_steps_hermes_run_unique UNIQUE (hermes_run_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run ON agent_run_steps (run_id, step_number);
