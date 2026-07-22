CREATE TABLE IF NOT EXISTS investigations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  search_query TEXT NOT NULL DEFAULT '' CHECK (char_length(search_query) <= 500),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  owner TEXT CHECK (owner IS NULL OR char_length(owner) <= 120),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS investigation_alerts (
  investigation_id UUID NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  alert_id TEXT NOT NULL REFERENCES alerts(id) ON DELETE RESTRICT,
  added_by TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (investigation_id, alert_id)
);

CREATE TABLE IF NOT EXISTS investigation_notes (
  id BIGSERIAL PRIMARY KEY,
  investigation_id UUID NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  author TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS owner TEXT;

CREATE TABLE IF NOT EXISTS case_notes (
  id BIGSERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  author TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE agent_evidence_links
  DROP CONSTRAINT IF EXISTS agent_evidence_links_evidence_type_check;
ALTER TABLE agent_evidence_links
  ADD CONSTRAINT agent_evidence_links_evidence_type_check
  CHECK (evidence_type IN (
    'alert','incident','alert_group','asset','identity','observable','fetch_run','investigation','case'
  ));

CREATE INDEX IF NOT EXISTS idx_investigations_status_updated
  ON investigations(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_investigation_alerts_alert
  ON investigation_alerts(alert_id, investigation_id);
CREATE INDEX IF NOT EXISTS idx_investigation_notes_investigation
  ON investigation_notes(investigation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_notes_incident
  ON case_notes(incident_id, created_at DESC);

DROP TRIGGER IF EXISTS investigations_updated_at ON investigations;
CREATE TRIGGER investigations_updated_at BEFORE UPDATE ON investigations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
