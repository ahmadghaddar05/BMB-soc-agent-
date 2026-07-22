INSERT INTO settings (key, value)
VALUES ('triage_enabled', 'false')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value;
