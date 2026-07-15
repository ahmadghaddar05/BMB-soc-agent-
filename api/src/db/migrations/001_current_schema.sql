CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  rule_id TEXT,
  rule_level INTEGER,
  rule_desc TEXT,
  rule_groups TEXT[] DEFAULT '{}',
  decoder TEXT,
  agent_id TEXT,
  agent_name TEXT,
  full_log TEXT,
  src_ip TEXT,
  dst_ip TEXT,
  username TEXT,
  hostname TEXT,
  target_db TEXT,
  process TEXT,
  raw JSONB NOT NULL DEFAULT '{}',
  enrichment JSONB,
  enrichment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (enrichment_status IN ('pending','enriched','enrichment_failed','skipped')),
  enrichment_error TEXT,
  enriched_at TIMESTAMPTZ,
  verdict JSONB,
  triage_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (triage_status IN ('pending','triaged','triage_failed','skipped')),
  triage_error TEXT,
  triaged_at TIMESTAMPTZ,
  auto_closed BOOLEAN DEFAULT FALSE,
  auto_close_reason TEXT,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  fetch_run_id INTEGER,
  signature TEXT,
  mitre_techniques TEXT[] DEFAULT '{}',
  mitre_tactics TEXT[] DEFAULT '{}',
  source_system TEXT DEFAULT 'legacy',
  source_index TEXT,
  elastic_alert_uuid TEXT,
  risk_score DOUBLE PRECISION,
  source_severity TEXT,
  workflow_status TEXT,
  alert_reason TEXT,
  event_dataset TEXT,
  event_category TEXT[] DEFAULT '{}',
  event_action TEXT,
  group_key TEXT,
  occurrence_count INTEGER DEFAULT 1,
  first_seen TIMESTAMPTZ,
  last_seen TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS incidents (
  id SERIAL PRIMARY KEY,
  incident_key TEXT UNIQUE NOT NULL,
  title TEXT,
  severity TEXT,
  confidence FLOAT,
  attack_stages TEXT[] DEFAULT '{}',
  common_entities JSONB DEFAULT '{}',
  alert_ids TEXT[] NOT NULL,
  narrative TEXT,
  recommended_actions TEXT[] DEFAULT '{}',
  first_seen TIMESTAMPTZ,
  last_seen TIMESTAMPTZ,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','closed','false_positive')),
  fetch_run_id INTEGER,
  incident_type TEXT DEFAULT 'correlation',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fetch_runs (
  id SERIAL PRIMARY KEY,
  trigger TEXT DEFAULT 'scheduler',
  status TEXT DEFAULT 'running' CHECK (status IN ('running','ok','error')),
  mode TEXT,
  fetched INTEGER DEFAULT 0,
  stored INTEGER DEFAULT 0,
  duplicates INTEGER DEFAULT 0,
  enriched INTEGER DEFAULT 0,
  enrichment_failed INTEGER DEFAULT 0,
  triaged INTEGER DEFAULT 0,
  triage_failed INTEGER DEFAULT 0,
  incidents_created INTEGER DEFAULT 0,
  llm_calls INTEGER DEFAULT 0,
  llm_tokens BIGINT DEFAULT 0,
  prompt_tokens BIGINT DEFAULT 0,
  completion_tokens BIGINT DEFAULT 0,
  cache_hits INTEGER DEFAULT 0,
  agentic_escalations INTEGER DEFAULT 0,
  correlation_calls INTEGER DEFAULT 0,
  correlation_tokens BIGINT DEFAULT 0,
  token_budget_exhausted BOOLEAN DEFAULT FALSE,
  duration_ms BIGINT DEFAULT 0,
  error TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS triage_cache (
  signature TEXT PRIMARY KEY,
  rule_id TEXT,
  verdict JSONB NOT NULL,
  hits INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS signature TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS mitre_techniques TEXT[] DEFAULT '{}';
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS mitre_tactics TEXT[] DEFAULT '{}';
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source_system TEXT DEFAULT 'legacy';
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source_index TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS elastic_alert_uuid TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS risk_score DOUBLE PRECISION;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source_severity TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS workflow_status TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS alert_reason TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS event_dataset TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS event_category TEXT[] DEFAULT '{}';
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS event_action TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS group_key TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS occurrence_count INTEGER DEFAULT 1;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS first_seen TIMESTAMPTZ;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS incident_type TEXT DEFAULT 'correlation';
ALTER TABLE fetch_runs ADD COLUMN IF NOT EXISTS llm_calls INTEGER DEFAULT 0;
ALTER TABLE fetch_runs ADD COLUMN IF NOT EXISTS llm_tokens BIGINT DEFAULT 0;
ALTER TABLE fetch_runs ADD COLUMN IF NOT EXISTS prompt_tokens BIGINT DEFAULT 0;
ALTER TABLE fetch_runs ADD COLUMN IF NOT EXISTS completion_tokens BIGINT DEFAULT 0;
ALTER TABLE fetch_runs ADD COLUMN IF NOT EXISTS cache_hits INTEGER DEFAULT 0;
ALTER TABLE fetch_runs ADD COLUMN IF NOT EXISTS agentic_escalations INTEGER DEFAULT 0;
ALTER TABLE fetch_runs ADD COLUMN IF NOT EXISTS correlation_calls INTEGER DEFAULT 0;
ALTER TABLE fetch_runs ADD COLUMN IF NOT EXISTS correlation_tokens BIGINT DEFAULT 0;
ALTER TABLE fetch_runs ADD COLUMN IF NOT EXISTS token_budget_exhausted BOOLEAN DEFAULT FALSE;
ALTER TABLE fetch_runs ADD COLUMN IF NOT EXISTS duration_ms BIGINT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_src_ip ON alerts (src_ip) WHERE src_ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_username ON alerts (username) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_hostname ON alerts (hostname) WHERE hostname IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_rule_level ON alerts (rule_level);
CREATE INDEX IF NOT EXISTS idx_alerts_enrich_status ON alerts (enrichment_status);
CREATE INDEX IF NOT EXISTS idx_alerts_triage_status ON alerts (triage_status);
CREATE INDEX IF NOT EXISTS idx_alerts_fetch_run ON alerts (fetch_run_id);
CREATE INDEX IF NOT EXISTS idx_alerts_signature ON alerts (signature);
CREATE INDEX IF NOT EXISTS idx_alerts_mitre_tactics ON alerts USING GIN (mitre_tactics);
CREATE INDEX IF NOT EXISTS idx_alerts_source_system ON alerts (source_system);
CREATE INDEX IF NOT EXISTS idx_alerts_risk_score ON alerts (risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_source_severity ON alerts (source_severity);
CREATE INDEX IF NOT EXISTS idx_alerts_workflow_status ON alerts (workflow_status);
CREATE INDEX IF NOT EXISTS idx_alerts_event_dataset ON alerts (event_dataset);
CREATE INDEX IF NOT EXISTS idx_alerts_group_key ON alerts (group_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_elastic_uuid ON alerts (elastic_alert_uuid)
  WHERE elastic_alert_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents (severity);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents (status);
CREATE INDEX IF NOT EXISTS idx_incidents_fetch_run ON incidents (fetch_run_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS alerts_updated_at ON alerts;
DROP TRIGGER IF EXISTS incidents_updated_at ON incidents;
CREATE TRIGGER alerts_updated_at BEFORE UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER incidents_updated_at BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO settings(key, value) VALUES
  ('scheduler_enabled','false'),
  ('interval_minutes','5'),
  ('lookback_minutes','15'),
  ('min_level','7'),
  ('limit','200'),
  ('alert_source','elastic'),
  ('elastic_read_only','true'),
  ('elastic_lookback_minutes','1'),
  ('elastic_limit','20'),
  ('elastic_min_risk_score','48'),
  ('elastic_alert_statuses','open,acknowledged'),
  ('elastic_exclude_rules',''),
  ('elastic_grouping_enabled','true'),
  ('elastic_group_window_minutes','5'),
  ('elastic_writeback_enabled','false'),
  ('elastic_cursor_enabled','false'),
  ('elastic_cursor_json',''),
  ('elastic_cursor_page_size','200'),
  ('elastic_cursor_max_pages','5'),
  ('elastic_cursor_delay_seconds','15'),
  ('enrichment_batch_size','1000'),
  ('llm_provider','groq'),
  ('groq_model','llama-3.3-70b-versatile'),
  ('anthropic_model','claude-sonnet-4-6'),
  ('ollama_model','llama3.1:8b'),
  ('triage_mode','hybrid'),
  ('triage_enabled','false'),
  ('triage_token_budget','60000'),
  ('agentic_max_iterations','3'),
  ('hybrid_agentic_min_rule_level','12'),
  ('hybrid_agentic_confidence_below','0.82'),
  ('caching_enabled','true'),
  ('triage_cache_ttl_hours','168'),
  ('autoclose_enabled','false'),
  ('autoclose_confidence','0.85'),
  ('autoclose_max_severity','medium'),
  ('autoclose_verdicts','false_positive,benign_anomaly'),
  ('correlation_enabled','true'),
  ('correlation_lookback_hours','24'),
  ('correlation_max_alerts','60'),
  ('correlation_new_alerts_per_cycle','20'),
  ('correlation_initial_alerts','20'),
  ('correlation_context_pool','100'),
  ('correlation_entity_window_hours','6'),
  ('correlation_token_budget','20000'),
  ('correlation_cursor_json',''),
  ('incident_promote_enabled','true'),
  ('incident_promote_verdicts','true_positive,needs_investigation'),
  ('incident_promote_min_severity','high')
ON CONFLICT(key) DO NOTHING;
