'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => console.error('[db] idle client error:', err));

// ── Query helpers ─────────────────────────────────────────────────────────
const db = {
  query: (text, params) => pool.query(text, params),
  connect: () => pool.connect(),
  end: () => pool.end(),

  async getSetting(key, fallback = null) {
    const r = await pool.query('SELECT value FROM settings WHERE key=$1', [key]);
    return r.rows[0]?.value ?? fallback;
  },

  async getAllSettings() {
    const r = await pool.query('SELECT key, value FROM settings ORDER BY key');
    return Object.fromEntries(r.rows.map(row => [row.key, row.value]));
  },

  async setSetting(key, value) {
    await pool.query(
      `INSERT INTO settings(key,value,updated_at) VALUES($1,$2,NOW())
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
      [key, String(value)]
    );
  },

  async setSettingsAtomic(entries, { actor = 'unknown', requestId = null } = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const keys = entries.map(([key]) => key);
      const previous = await client.query(
        'SELECT key,value FROM settings WHERE key = ANY($1::text[]) FOR UPDATE',
        [keys]
      );
      const before = Object.fromEntries(previous.rows.map(row => [row.key, row.value]));
      const changes = {};
      for (const [key, value] of entries) {
        const nextValue = String(value);
        await client.query(
          `INSERT INTO settings(key,value,updated_at) VALUES($1,$2,NOW())
           ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
          [key, nextValue]
        );
        changes[key] = { before: before[key] ?? null, after: nextValue };
      }
      await client.query(
        `INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
         VALUES($1,'settings.updated','platform_settings','global','success',$2,$3)`,
        [actor, requestId, { changed_keys: keys, changes }]
      );
      await client.query('COMMIT');
      return { changedKeys: keys, changes };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async getAlertStats() {
    const r = await pool.query(`
      SELECT
        COUNT(*) AS total,

        COUNT(*) FILTER (
          WHERE source_system = 'elastic'
        ) AS elastic_total,

        COUNT(*) FILTER (
          WHERE source_system IS DISTINCT FROM 'elastic'
        ) AS legacy_total,

        COUNT(DISTINCT group_key) FILTER (
          WHERE source_system = 'elastic'
            AND group_key IS NOT NULL
        ) AS grouped_activities,

        COUNT(DISTINCT group_key) FILTER (
          WHERE source_system = 'elastic'
            AND group_key IS NOT NULL
            AND source_severity = 'critical'
        ) AS critical_activities,

        COUNT(DISTINCT group_key) FILTER (
          WHERE source_system = 'elastic'
            AND group_key IS NOT NULL
            AND source_severity = 'high'
        ) AS high_activities,

        COUNT(DISTINCT group_key) FILTER (
          WHERE source_system = 'elastic'
            AND group_key IS NOT NULL
            AND source_severity = 'medium'
        ) AS medium_activities,

        COUNT(DISTINCT group_key) FILTER (
          WHERE source_system = 'elastic'
            AND group_key IS NOT NULL
            AND enrichment_status = 'enriched'
        ) AS enriched_activities,

        COUNT(DISTINCT group_key) FILTER (
          WHERE source_system = 'elastic'
            AND group_key IS NOT NULL
            AND enrichment_status = 'pending'
        ) AS enrich_pending_activities,

        COUNT(*) FILTER (
          WHERE enrichment_status = 'enriched'
        ) AS enriched,

        COUNT(*) FILTER (
          WHERE enrichment_status = 'enrichment_failed'
        ) AS enrichment_failed,

        COUNT(*) FILTER (
          WHERE enrichment_status = 'pending'
        ) AS enrich_pending,

        COUNT(*) FILTER (
          WHERE triage_status = 'triaged'
        ) AS triaged,

        COUNT(*) FILTER (
          WHERE triage_status = 'triage_failed'
        ) AS triage_failed,

        COUNT(*) FILTER (
          WHERE triage_status = 'pending'
        ) AS triage_pending,

        COUNT(*) FILTER (
          WHERE auto_closed = true
        ) AS auto_closed,

        MIN(timestamp) AS oldest,
        MAX(timestamp) AS newest
      FROM alerts
    `);

    return r.rows[0];
  },

  async startFetchRun(trigger = 'scheduler', mode = 'pipeline') {
    const r = await pool.query(
      `INSERT INTO fetch_runs(trigger,mode,status,started_at)
       VALUES($1,$2,'running',NOW()) RETURNING id`,
      [trigger, mode]
    );
    return r.rows[0].id;
  },

  async updateFetchRun(id, updates) {
    const fields = Object.entries(updates)
      .map(([k], i) => `${k}=$${i + 2}`)
      .join(', ');
    await pool.query(
      `UPDATE fetch_runs SET ${fields} WHERE id=$1`,
      [id, ...Object.values(updates)]
    );
  },

  async finishFetchRun(id, stats, status = 'ok', error = null) {
    await pool.query(
      `UPDATE fetch_runs SET status=$2, fetched=$3, stored=$4, duplicates=$5,
         enriched=$6, enrichment_failed=$7, triaged=$8, triage_failed=$9,
         incidents_created=$10, error=$11,
         llm_calls=$12, llm_tokens=$13, prompt_tokens=$14,
         completion_tokens=$15, cache_hits=$16, agentic_escalations=$17,
         correlation_calls=$18, correlation_tokens=$19,
         token_budget_exhausted=$20,
         autonomous_run_id=$21,investigations_created=$22,
         investigation_notes_added=$23,case_notes_added=$24,
         approvals_requested=$25,autonomous_failures=$26,
         duration_ms=GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)),
         finished_at=NOW()
       WHERE id=$1`,
      [id, status,
       stats.fetched     || 0, stats.stored        || 0, stats.duplicates     || 0,
       stats.enriched    || 0, stats.enrichment_failed || 0,
       stats.triaged     || 0, stats.triage_failed  || 0,
       stats.incidents_created || 0, error,
       stats.llm_calls || 0, stats.llm_tokens || 0,
       stats.prompt_tokens || 0, stats.completion_tokens || 0,
       stats.cache_hits || 0, stats.agentic_escalations || 0,
       stats.correlation_calls || 0, stats.correlation_tokens || 0,
       Boolean(stats.token_budget_exhausted),
       stats.autonomous_run_id || null, stats.investigations_created || 0,
       stats.investigation_notes_added || 0, stats.case_notes_added || 0,
       stats.approvals_requested || 0, stats.autonomous_failures || 0]
    );
  },
};

module.exports = db;
