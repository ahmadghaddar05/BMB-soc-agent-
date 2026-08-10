CREATE TABLE IF NOT EXISTS source_connectors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  connector_type TEXT NOT NULL CHECK (connector_type IN ('elastic','splunk','wazuh')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  collection_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_ciphertext TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  secret_tag TEXT NOT NULL,
  secret_version INTEGER NOT NULL DEFAULT 1 CHECK (secret_version = 1),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  last_test_status TEXT CHECK (last_test_status IN ('success','failure')),
  last_tested_at TIMESTAMPTZ,
  last_test_latency_ms INTEGER,
  last_test_error TEXT,
  tested_config_hash TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_source_connectors_name
  ON source_connectors (LOWER(name));

CREATE UNIQUE INDEX IF NOT EXISTS uq_source_connectors_active
  ON source_connectors (active) WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_source_connectors_type_enabled
  ON source_connectors (connector_type, enabled, updated_at DESC);
