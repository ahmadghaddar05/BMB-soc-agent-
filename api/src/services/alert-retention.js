'use strict';

const db = require('../db');

const MODES = new Set(['policy', 'initial_7_day_purge']);
const CONFIRMATION = 'PURGE DASHBOARD ALERTS';
const LOCK_KEY = 730214;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function policyFromSettings(settings = {}) {
  return {
    enabled: settings.alert_retention_enabled === 'true',
    critical_days: boundedInteger(settings.alert_retention_critical_days, 14, 1, 3650),
    high_days: boundedInteger(settings.alert_retention_high_days, 10, 1, 3650),
    default_days: boundedInteger(settings.alert_retention_default_days, 7, 1, 3650),
    batch_size: boundedInteger(settings.alert_retention_batch_size, 5000, 100, 20000),
    schedule: '17 2 * * *',
    schedule_timezone: 'UTC',
    elastic_source_affected: false,
  };
}

function assertMode(mode) {
  if (!MODES.has(mode)) throw new Error('Unsupported alert-retention mode');
}

function eligibilitySql(mode) {
  if (mode === 'initial_7_day_purge') {
    return `COALESCE(a.last_seen,a.timestamp,a.fetched_at) < NOW() - INTERVAL '7 days'`;
  }
  return `
    COALESCE(a.last_seen,a.timestamp,a.fetched_at) <
      NOW() - (
        CASE
          WHEN a.effective_severity = 'critical' THEN $1::integer
          WHEN a.effective_severity = 'high' THEN $2::integer
          ELSE $3::integer
        END * INTERVAL '1 day'
      )`;
}

function normalizedAlertSql() {
  return `
    SELECT a.*,
      CASE
        WHEN LOWER(COALESCE(NULLIF(a.source_severity,''),NULLIF(a.verdict->>'severity',''))) IN
          ('critical','high','medium','low')
          THEN LOWER(COALESCE(NULLIF(a.source_severity,''),NULLIF(a.verdict->>'severity','')))
        WHEN COALESCE(a.rule_level,0) >= 15 THEN 'critical'
        WHEN COALESCE(a.rule_level,0) >= 10 THEN 'high'
        ELSE 'other'
      END AS effective_severity
    FROM alerts a`;
}

function protectedPredicate(alias = 'a') {
  return `
    EXISTS (SELECT 1 FROM investigation_alerts ia WHERE ia.alert_id=${alias}.id)
    OR EXISTS (SELECT 1 FROM incidents i WHERE ${alias}.id=ANY(i.alert_ids))
    OR EXISTS (
      SELECT 1 FROM simulated_response_states s
      WHERE ${alias}.id=ANY(s.evidence_alert_ids)
    )`;
}

function summaryRows(rows = []) {
  const output = { total:0, critical:0, high:0, medium:0, low:0, other:0 };
  for (const row of rows) {
    const severity = Object.hasOwn(output, row.severity) ? row.severity : 'other';
    const count = Number(row.count || 0);
    output[severity] += count;
    output.total += count;
  }
  return output;
}

async function previewRetention({ mode = 'policy', client = db } = {}) {
  assertMode(mode);
  const settings = await db.getAllSettings();
  const policy = policyFromSettings(settings);
  const params = mode === 'policy'
    ? [policy.critical_days, policy.high_days, policy.default_days]
    : [];
  const result = await client.query(
    `WITH normalized AS (${normalizedAlertSql()}),
      eligible AS (
        SELECT a.id,a.effective_severity,
          (${protectedPredicate('a')}) AS protected
        FROM normalized a
        WHERE ${eligibilitySql(mode)}
      )
     SELECT effective_severity AS severity,protected,COUNT(*)::int AS count
     FROM eligible
     GROUP BY effective_severity,protected`,
    params
  );
  const candidates = summaryRows(result.rows);
  const protectedCounts = summaryRows(result.rows.filter(row => row.protected));
  const deletable = summaryRows(result.rows.filter(row => !row.protected));
  return {
    mode,
    generated_at:new Date().toISOString(),
    policy,
    candidates,
    protected:protectedCounts,
    deletable,
    protection_basis:[
      'incident evidence',
      'investigation evidence',
      'response-simulation evidence',
    ],
  };
}

async function insertRun(client, { mode, dryRun, actor, requestId, policy, preview }) {
  const result = await client.query(
    `INSERT INTO alert_retention_runs(
       mode,dry_run,status,actor,request_id,policy,candidate_counts,protected_counts
     ) VALUES($1,$2,'running',$3,$4,$5,$6,$7) RETURNING id`,
    [mode, dryRun, actor, requestId, policy, preview.candidates, preview.protected]
  );
  return result.rows[0].id;
}

async function finishRun(client, id, status, deleted, error = null) {
  await client.query(
    `UPDATE alert_retention_runs
     SET status=$2,deleted_counts=$3,error=$4,finished_at=NOW()
     WHERE id=$1`,
    [id, status, deleted, error]
  );
}

async function runRetention({
  mode = 'policy',
  dryRun = false,
  confirmation,
  actor = 'system:retention',
  requestId = null,
} = {}) {
  assertMode(mode);
  if (!dryRun && confirmation !== CONFIRMATION) {
    const error = new Error(`Confirmation must exactly match "${CONFIRMATION}"`);
    error.code = 'RETENTION_CONFIRMATION_REQUIRED';
    throw error;
  }

  const client = await db.connect();
  let locked = false;
  let runId = null;
  const deleted = { total:0, critical:0, high:0, medium:0, low:0, other:0 };
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_KEY]);
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) return { skipped:true, reason:'retention_cycle_in_progress' };

    const preview = await previewRetention({ mode, client });
    runId = await insertRun(client, {
      mode, dryRun, actor, requestId, policy:preview.policy, preview,
    });
    if (dryRun) {
      await finishRun(client, runId, 'completed', deleted);
      return { run_id:runId, dry_run:true, ...preview, deleted };
    }

    const params = mode === 'policy'
      ? [
          preview.policy.critical_days,
          preview.policy.high_days,
          preview.policy.default_days,
          preview.policy.batch_size,
        ]
      : [preview.policy.batch_size];
    const batchPlaceholder = mode === 'policy' ? '$4' : '$1';

    while (true) {
      await client.query('BEGIN');
      const batch = await client.query(
        `WITH normalized AS (${normalizedAlertSql()}),
          candidates AS (
            SELECT a.id,a.effective_severity
            FROM normalized a
            WHERE ${eligibilitySql(mode)}
              AND NOT (${protectedPredicate('a')})
            ORDER BY COALESCE(a.last_seen,a.timestamp,a.fetched_at),a.id
            LIMIT ${batchPlaceholder}
          ),
          removed AS (
            DELETE FROM alerts a
            USING candidates c
            WHERE a.id=c.id
              AND NOT (${protectedPredicate('a')})
            RETURNING a.id,c.effective_severity
          )
         SELECT id,effective_severity FROM removed`,
        params
      );
      const ids = batch.rows.map(row => row.id);
      if (ids.length) {
        await client.query(
          `DELETE FROM agent_evidence_links
           WHERE evidence_type='alert' AND evidence_id=ANY($1::text[])`,
          [ids]
        );
        await client.query(
          `DELETE FROM workflow_stage_events
           WHERE entity_type='alert' AND entity_id=ANY($1::text[])`,
          [ids]
        );
      }
      await client.query('COMMIT');

      for (const row of batch.rows) {
        const severity = Object.hasOwn(deleted, row.effective_severity)
          ? row.effective_severity
          : 'other';
        deleted[severity] += 1;
        deleted.total += 1;
      }
      if (batch.rows.length < preview.policy.batch_size) break;
    }

    await finishRun(client, runId, 'completed', deleted);
    await client.query(
      `INSERT INTO audit_events(
         actor,event_type,target_type,target_id,outcome,request_id,metadata
       ) VALUES($1,'alert_retention.completed','alert_store',$2,'success',$3,$4)`,
      [actor, mode, requestId, {
        run_id:runId,
        mode,
        policy:preview.policy,
        candidates:preview.candidates,
        protected:preview.protected,
        deleted,
        elastic_source_affected:false,
      }]
    );
    return { run_id:runId, dry_run:false, ...preview, deleted };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (runId) await finishRun(client, runId, 'failed', deleted, error.message).catch(() => {});
    throw error;
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

async function recentRetentionRuns(limit = 10) {
  const result = await db.query(
    `SELECT id,mode,dry_run,status,actor,policy,candidate_counts,
            protected_counts,deleted_counts,error,started_at,finished_at
     FROM alert_retention_runs ORDER BY id DESC LIMIT $1`,
    [boundedInteger(limit, 10, 1, 50)]
  );
  return result.rows;
}

module.exports = {
  CONFIRMATION,
  policyFromSettings,
  previewRetention,
  runRetention,
  recentRetentionRuns,
};
