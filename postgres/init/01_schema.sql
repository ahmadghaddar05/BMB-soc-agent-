-- SOC Agent schema
-- All tables created idempotently.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────────────────────
-- Settings (key-value, editable from the UI)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO settings (key, value) VALUES
  ('scheduler_enabled',        'false'),
  ('interval_minutes',         '5'),
  ('lookback_minutes',         '15'),
  ('min_level',                '7'),
  ('limit',                    '200'),
  ('llm_provider',             'groq'),
  ('groq_model',               'llama-3.3-70b-versatile'),
  ('ollama_model',             'llama3.1:8b'),
  ('triage_mode',              'pipeline'),
  ('autoclose_enabled',        'false'),
  ('autoclose_confidence',     '0.85'),
  ('autoclose_max_severity',   'medium'),
  ('autoclose_verdicts',       'false_positive,benign_anomaly')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Alerts  (one row = one Wazuh alert, lifecycle tracked via status)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id                  TEXT        PRIMARY KEY,   -- Wazuh _id
  timestamp           TIMESTAMPTZ NOT NULL,
  rule_id             TEXT,
  rule_level          INTEGER,
  rule_desc           TEXT,
  rule_groups         TEXT[]      DEFAULT '{}',
  decoder             TEXT,
  agent_id            TEXT,
  agent_name          TEXT,
  full_log            TEXT,

  -- Extracted entities (normalised at ingest)
  src_ip              TEXT,
  dst_ip              TEXT,
  username            TEXT,
  hostname            TEXT,
  target_db           TEXT,
  process             TEXT,

  -- Raw alert JSON from Wazuh
  raw                 JSONB       NOT NULL DEFAULT '{}',

  -- Enrichment context (populated by enrichment worker)
  enrichment          JSONB,
  enrichment_status   TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (enrichment_status IN
                          ('pending','enriched','enrichment_failed','skipped')),
  enrichment_error    TEXT,
  enriched_at         TIMESTAMPTZ,

  -- Triage verdict (populated by triage worker)
  verdict             JSONB,
  triage_status       TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (triage_status IN
                          ('pending','triaged','triage_failed','skipped')),
  triage_error        TEXT,
  triaged_at          TIMESTAMPTZ,

  -- Auto-close decision
  auto_closed         BOOLEAN     DEFAULT FALSE,
  auto_close_reason   TEXT,

  -- Bookkeeping
  fetched_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  -- Fetch run that ingested this alert
  fetch_run_id        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_alerts_timestamp    ON alerts (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_src_ip       ON alerts (src_ip) WHERE src_ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_username     ON alerts (username) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_hostname     ON alerts (hostname) WHERE hostname IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_rule_level   ON alerts (rule_level);
CREATE INDEX IF NOT EXISTS idx_alerts_enrich_status ON alerts (enrichment_status);
CREATE INDEX IF NOT EXISTS idx_alerts_triage_status ON alerts (triage_status);
CREATE INDEX IF NOT EXISTS idx_alerts_fetch_run    ON alerts (fetch_run_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Incidents  (correlated groups of alerts)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incidents (
  id                  SERIAL      PRIMARY KEY,
  incident_key        TEXT        UNIQUE NOT NULL,  -- deterministic hash of alert_ids
  title               TEXT,
  severity            TEXT,
  confidence          FLOAT,
  attack_stages       TEXT[]      DEFAULT '{}',
  common_entities     JSONB       DEFAULT '{}',
  alert_ids           TEXT[]      NOT NULL,
  narrative           TEXT,
  recommended_actions TEXT[]      DEFAULT '{}',
  first_seen          TIMESTAMPTZ,
  last_seen           TIMESTAMPTZ,
  status              TEXT        DEFAULT 'open'
                        CHECK (status IN ('open','closed','false_positive')),
  fetch_run_id        INTEGER,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_severity    ON incidents (severity);
CREATE INDEX IF NOT EXISTS idx_incidents_status      ON incidents (status);
CREATE INDEX IF NOT EXISTS idx_incidents_fetch_run   ON incidents (fetch_run_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Fetch runs  (one row per scheduler/manual fetch cycle)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fetch_runs (
  id                  SERIAL      PRIMARY KEY,
  trigger             TEXT        DEFAULT 'scheduler',  -- scheduler | manual
  status              TEXT        DEFAULT 'running'
                        CHECK (status IN ('running','ok','error')),
  mode                TEXT,
  fetched             INTEGER     DEFAULT 0,
  stored              INTEGER     DEFAULT 0,
  duplicates          INTEGER     DEFAULT 0,
  enriched            INTEGER     DEFAULT 0,
  enrichment_failed   INTEGER     DEFAULT 0,
  triaged             INTEGER     DEFAULT 0,
  triage_failed       INTEGER     DEFAULT 0,
  incidents_created   INTEGER     DEFAULT 0,
  error               TEXT,
  started_at          TIMESTAMPTZ DEFAULT NOW(),
  finished_at         TIMESTAMPTZ
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: keep updated_at current on alerts + incidents
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS alerts_updated_at    ON alerts;
DROP TRIGGER IF EXISTS incidents_updated_at ON incidents;

CREATE TRIGGER alerts_updated_at
  BEFORE UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER incidents_updated_at
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
