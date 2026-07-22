-- Permit durable citations to bounded, read-only Elastic raw-event evidence.
ALTER TABLE agent_evidence_links
  DROP CONSTRAINT IF EXISTS agent_evidence_links_evidence_type_check;
ALTER TABLE agent_evidence_links
  ADD CONSTRAINT agent_evidence_links_evidence_type_check
  CHECK (evidence_type IN (
    'alert','incident','alert_group','asset','identity','observable','fetch_run',
    'investigation','case','action_request','autonomous_run','simulated_response',
    'raw_event'
  ));
