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

  async getAlertStats() {
    const r = await pool.query(`
      SELECT
        COUNT(*)                                          AS total,
        COUNT(*) FILTER (WHERE enrichment_status='enriched')   AS enriched,
        COUNT(*) FILTER (WHERE enrichment_status='enrichment_failed') AS enrichment_failed,
        COUNT(*) FILTER (WHERE enrichment_status='pending')    AS enrich_pending,
        COUNT(*) FILTER (WHERE triage_status='triaged')        AS triaged,
        COUNT(*) FILTER (WHERE triage_status='triage_failed')  AS triage_failed,
        COUNT(*) FILTER (WHERE triage_status='pending')        AS triage_pending,
        COUNT(*) FILTER (WHERE auto_closed=true)               AS auto_closed,
        MIN(timestamp)                                         AS oldest,
        MAX(timestamp)                                         AS newest
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
         incidents_created=$10, error=$11, finished_at=NOW()
       WHERE id=$1`,
      [id, status,
       stats.fetched     || 0, stats.stored        || 0, stats.duplicates     || 0,
       stats.enriched    || 0, stats.enrichment_failed || 0,
       stats.triaged     || 0, stats.triage_failed  || 0,
       stats.incidents_created || 0, error]
    );
  },
};

module.exports = db;
