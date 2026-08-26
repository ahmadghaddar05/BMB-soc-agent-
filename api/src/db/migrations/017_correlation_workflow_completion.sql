-- Activate the requested internal correlation workflow and replay the bounded
-- recent triage window so alerts collected while correlation was disabled are
-- evaluated. This does not modify Elastic or execute response actions.

INSERT INTO settings(key,value,updated_at)
VALUES ('correlation_enabled','true',NOW())
ON CONFLICT(key) DO UPDATE SET value='true',updated_at=NOW();

INSERT INTO settings(key,value,updated_at)
VALUES ('correlation_cursor_json','',NOW())
ON CONFLICT(key) DO UPDATE SET value='',updated_at=NOW();
