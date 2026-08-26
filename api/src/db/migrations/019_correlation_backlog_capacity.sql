-- Keep correlation throughput aligned with the maximum triage batch and
-- replay recent triaged alerts that have no recorded correlation outcome.
-- This changes only BMB workflow state; Elastic remains read-only.

INSERT INTO settings(key,value,updated_at)
VALUES ('correlation_enabled','true',NOW())
ON CONFLICT(key) DO UPDATE SET value='true',updated_at=NOW();

INSERT INTO settings(key,value,updated_at)
VALUES ('correlation_new_alerts_per_cycle','50',NOW())
ON CONFLICT(key) DO UPDATE SET value='50',updated_at=NOW();

INSERT INTO settings(key,value,updated_at)
VALUES ('correlation_initial_alerts','40',NOW())
ON CONFLICT(key) DO UPDATE SET value='40',updated_at=NOW();

WITH first_unprocessed AS (
  SELECT MIN(COALESCE(a.triaged_at,a.timestamp)) AS first_at
  FROM alerts a
  WHERE a.triage_status='triaged'
    AND a.auto_closed=false
    AND a.timestamp>=NOW()-INTERVAL '7 days'
    AND NOT EXISTS (
      SELECT 1
      FROM workflow_stage_events w
      WHERE w.entity_type='alert'
        AND w.entity_id=a.id
        AND w.stage='correlated'
    )
)
INSERT INTO settings(key,value,updated_at)
SELECT
  'correlation_cursor_json',
  jsonb_build_array((first_at-INTERVAL '1 millisecond')::text,'')::text,
  NOW()
FROM first_unprocessed
WHERE first_at IS NOT NULL
ON CONFLICT(key) DO UPDATE
SET value=EXCLUDED.value,updated_at=NOW();
