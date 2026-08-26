-- Evidence-backed executive metrics:
-- 1. Durable CMDB CI-type to business-service mappings.
-- 2. Explicit incident response and resolution milestones.

CREATE TABLE IF NOT EXISTS business_service_mappings (
  mapping_type TEXT NOT NULL CHECK (mapping_type IN ('ci_type','event_dataset','asset_name')),
  match_value TEXT NOT NULL,
  business_service TEXT NOT NULL CHECK (char_length(business_service) BETWEEN 1 AND 160),
  criticality TEXT NOT NULL CHECK (criticality IN ('critical','high','medium','low')),
  mapping_source TEXT NOT NULL DEFAULT 'bmb_cmdb_taxonomy',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mapping_type, match_value)
);

INSERT INTO business_service_mappings(mapping_type,match_value,business_service,criticality) VALUES
  ('ci_type','domain_controller',  'Identity & Authentication', 'critical'),
  ('ci_type','core_banking_app',   'Core Banking',              'critical'),
  ('ci_type','card_switch',        'Card Payment Processing',   'critical'),
  ('ci_type','swift_gateway',      'SWIFT Payments',            'critical'),
  ('ci_type','database_server',    'Core Data Platforms',       'critical'),
  ('ci_type','api_gateway',        'Digital Banking Services',  'high'),
  ('ci_type','application_server', 'Business Applications',     'high'),
  ('ci_type','web_server',         'Digital Banking Services',  'high'),
  ('ci_type','mail_server',        'Corporate Communications',  'high'),
  ('ci_type','backup_server',      'Backup & Recovery',         'high'),
  ('ci_type','file_server',        'Enterprise File Services',  'medium'),
  ('ci_type','workstation',        'Employee Computing',        'medium'),
  ('event_dataset','ad.security',      'Identity & Authentication', 'critical'),
  ('event_dataset','database.audit',   'Core Data Platforms',       'critical'),
  ('event_dataset','web.application',  'Digital Banking Services',  'high'),
  ('event_dataset','email.security',   'Corporate Communications',  'high'),
  ('event_dataset','linux.security',   'Business Applications',     'high'),
  ('event_dataset','edr.endpoint',     'Employee Computing',        'medium'),
  ('asset_name','DC01',          'Identity & Authentication', 'critical'),
  ('asset_name','DB01',          'Core Data Platforms',       'critical'),
  ('asset_name','WEBAPP01',      'Digital Banking Services',  'high'),
  ('asset_name','LINUX-WEB01',   'Digital Banking Services',  'high'),
  ('asset_name','LINUX-APP01',   'Business Applications',     'high'),
  ('asset_name','LINUX-JUMP01',  'Privileged Access',         'critical'),
  ('asset_name','MAILGW01',      'Corporate Communications',  'high'),
  ('asset_name','IT-ADMIN01',    'Privileged Access',         'critical'),
  ('asset_name','SEC-WS002',     'Security Operations',       'high'),
  ('asset_name','HR-WS001',      'Workforce Systems',         'high'),
  ('asset_name','DEV-WS001',     'Engineering Operations',    'high'),
  ('asset_name','DEV-WS002',     'Engineering Operations',    'high')
ON CONFLICT (mapping_type, match_value) DO UPDATE SET
  business_service=EXCLUDED.business_service,
  criticality=EXCLUDED.criticality,
  mapping_source=EXCLUDED.mapping_source,
  updated_at=NOW();

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Recover trustworthy historical response milestones from existing human
-- workflow audit records. Correlation-only updates are intentionally excluded.
WITH first_responses AS (
  SELECT
    target_id::integer AS incident_id,
    MIN(created_at) AS responded_at
  FROM audit_events
  WHERE target_type IN ('incident','case')
    AND target_id ~ '^[1-9][0-9]*$'
    AND event_type IN ('incident.status_updated','case.updated','case.note_added')
    AND outcome = 'success'
  GROUP BY target_id::integer
)
UPDATE incidents i
SET first_response_at = r.responded_at
FROM first_responses r
WHERE i.id = r.incident_id
  AND i.first_response_at IS NULL
  AND r.responded_at >= i.created_at;

CREATE INDEX IF NOT EXISTS idx_incidents_first_response
  ON incidents(first_response_at) WHERE first_response_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_resolved
  ON incidents(resolved_at) WHERE resolved_at IS NOT NULL;

DROP TRIGGER IF EXISTS business_service_mappings_updated_at ON business_service_mappings;
CREATE TRIGGER business_service_mappings_updated_at
  BEFORE UPDATE ON business_service_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
