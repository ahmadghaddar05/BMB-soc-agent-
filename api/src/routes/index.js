'use strict';
const { Router } = require('express');
const db = require('../db');
const scheduler = require('../workers/scheduler');
const { runCycle, enrichPending, triagePending, retriageAlert, correlatePending } = require('../workers/pipeline');
const { chatHermes } = require('../services/hermes');
const { HermesError, publicHermesError } = require('../services/hermes/errors');
const { runtimeConfig } = require('../config');
const { dependencyHealth } = require('../services/health');
const reports = require('../services/reports');
const workflows = require('./workflows');
const actions = require('./actions');

const r = Router();

r.use(workflows);
r.use(actions);

const SEVERITIES = new Set(['critical','high','medium','low','informational']);
const VERDICTS = new Set(['true_positive','false_positive','needs_investigation','benign_anomaly']);
const TRIAGE_STATUSES = new Set(['pending','triaged','triage_failed','skipped']);
const ENRICHMENT_STATUSES = new Set(['pending','enriched','enrichment_failed','skipped']);

function pagination(query, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? defaultLimit);
  if (!Number.isInteger(page) || page < 1) return { error: 'page must be a positive integer' };
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    return { error: `limit must be an integer between 1 and ${maxLimit}` };
  }
  return { page, limit, offset: (page - 1) * limit };
}

function optionalEnum(value, values, name) {
  if (value == null || value === '') return null;
  return values.has(value) ? null : `${name} has an unsupported value`;
}

function optionalDate(value, name) {
  if (!value) return null;
  return Number.isFinite(new Date(value).getTime()) ? null : `${name} must be a valid timestamp`;
}

function optionalText(value, name, maxLength = 500) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return `${name} must be a string`;
  return value.length <= maxLength ? null : `${name} must be at most ${maxLength} characters`;
}

function optionalInteger(value, name, min, max) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max
    ? null
    : `${name} must be an integer between ${min} and ${max}`;
}

function dateRangeError(from, to) {
  const invalid = optionalDate(from, 'from') || optionalDate(to, 'to');
  if (invalid) return invalid;
  if (from && to && new Date(from).getTime() > new Date(to).getTime()) return 'from must not be later than to';
  return null;
}

function positiveRecordId(value, name) {
  return optionalInteger(value, name, 1, Number.MAX_SAFE_INTEGER);
}

const SETTING_KEYS = new Set([
  'scheduler_enabled','interval_minutes','lookback_minutes','min_level','limit',
  'triage_mode','triage_enabled',
  'autoclose_enabled','autoclose_confidence','autoclose_max_severity','autoclose_verdicts',
  'correlation_enabled','correlation_lookback_hours','correlation_max_alerts',
  'correlation_new_alerts_per_cycle','correlation_initial_alerts',
  'correlation_context_pool','correlation_entity_window_hours','correlation_token_budget',
  'caching_enabled','triage_cache_ttl_hours','triage_token_budget',
  'agentic_max_iterations','hybrid_agentic_min_rule_level',
  'hybrid_agentic_confidence_below',
  'incident_promote_enabled','incident_promote_verdicts','incident_promote_min_severity',
]);

const BOOLEAN_SETTINGS = new Set([
  'scheduler_enabled','triage_enabled','autoclose_enabled','correlation_enabled',
  'caching_enabled','incident_promote_enabled',
]);

const INTEGER_SETTING_LIMITS = {
  interval_minutes:[1,1440], lookback_minutes:[1,10080], min_level:[0,20], limit:[1,5000],
  correlation_lookback_hours:[1,168], correlation_max_alerts:[2,80],
  correlation_new_alerts_per_cycle:[1,50], correlation_initial_alerts:[2,40],
  correlation_context_pool:[10,300], correlation_entity_window_hours:[1,48],
  correlation_token_budget:[6000,100000], triage_cache_ttl_hours:[1,720],
  triage_token_budget:[10000,500000], agentic_max_iterations:[2,4],
  hybrid_agentic_min_rule_level:[1,20],
};

function validateSetting(key, value) {
  if (value == null || (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')) {
    return `${key} must be a scalar value`;
  }
  const text = String(value);
  if (text.length > 500) return `${key} is too long`;
  if (BOOLEAN_SETTINGS.has(key) && !['true','false'].includes(text)) return `${key} must be true or false`;
  if (INTEGER_SETTING_LIMITS[key]) {
    const number = Number(text);
    const [min,max] = INTEGER_SETTING_LIMITS[key];
    if (!Number.isInteger(number) || number < min || number > max) return `${key} must be an integer between ${min} and ${max}`;
  }
  if (key === 'triage_mode' && !['pipeline','agentic','hybrid'].includes(text)) return 'triage_mode is unsupported';
  if (key === 'autoclose_max_severity' && !SEVERITIES.has(text)) return 'autoclose_max_severity is unsupported';
  if (key === 'incident_promote_min_severity' && !SEVERITIES.has(text)) return 'incident_promote_min_severity is unsupported';
  if (['autoclose_confidence','hybrid_agentic_confidence_below'].includes(key)) {
    const number = Number(text);
    if (!Number.isFinite(number) || number < 0 || number > 1) return `${key} must be between 0 and 1`;
  }
  if (key === 'autoclose_enabled' && text !== 'false') return 'automatic closure remains disabled';
  if (key === 'incident_promote_enabled' && text !== 'false') return 'automatic singleton promotion remains disabled';
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Health
// ────────────────────────────────────────────────────────────────────────────
r.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

r.get('/health/dependencies', async (_, res) => {
  try {
    const health = await dependencyHealth();
    res.json(health);
  } catch (e) { res.status(503).json({ error: e.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// Settings
// ────────────────────────────────────────────────────────────────────────────
r.get('/settings', async (_, res) => {
  try {
    const settings = await db.getAllSettings();
    const stats    = await db.getAlertStats();
    res.json({ settings, stats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

r.put('/settings', async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'settings body must be an object' });
    }
    const entries = Object.entries(req.body);
    if (!entries.length) return res.status(400).json({ error: 'at least one setting is required' });
    const unknown = entries.filter(([key]) => !SETTING_KEYS.has(key)).map(([key]) => key);
    if (unknown.length) return res.status(400).json({ error: `Unsupported settings: ${unknown.join(', ')}` });
    const validationErrors = entries.map(([key,value]) => validateSetting(key,value)).filter(Boolean);
    if (validationErrors.length) return res.status(400).json({ error: validationErrors.join('; ') });
    const updates = entries;
    for (const [k, v] of updates) await db.setSetting(k, v);

    // If scheduler settings changed, restart the cron
    const schedulerKeys = ['scheduler_enabled','interval_minutes'];
    if (updates.some(([k]) => schedulerKeys.includes(k))) await scheduler.restart();

    res.json({ ok: true, settings: await db.getAllSettings() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// Scheduler
// ────────────────────────────────────────────────────────────────────────────
r.get('/scheduler/status', async (_, res) => {
  try {
    const runs = await db.query(
      `SELECT * FROM fetch_runs ORDER BY id DESC LIMIT 20`
    );
    res.json({ ...scheduler.status(), recent_runs: runs.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ────────────────────────────────────────────────────────────────────────────
// Elastic collector operational status
// ────────────────────────────────────────────────────────────────────────────
r.get('/collector/status', async (_, res) => {
  try {
    const settings = await db.getAllSettings();
    const runtime = scheduler.status();

    let cursor = null;

    try {
      cursor = JSON.parse(
        settings.elastic_cursor_json || 'null'
      );
    } catch {
      cursor = null;
    }

    const [
      latestRun,
      databaseStats,
    ] = await Promise.all([
      db.query(`
        SELECT
          id,
          trigger,
          status,
          fetched,
          stored,
          duplicates,
          enriched,
          enrichment_failed,
          triaged,
          error,
          started_at,
          finished_at
        FROM fetch_runs
        ORDER BY id DESC
        LIMIT 1
      `),

      db.query(`
        SELECT
          COUNT(*) FILTER (
            WHERE source_system = 'elastic'
          ) AS elastic_alerts,

          COUNT(DISTINCT group_key) FILTER (
            WHERE source_system = 'elastic'
              AND group_key IS NOT NULL
          ) AS grouped_activities,

          COUNT(*) FILTER (
            WHERE source_system = 'elastic'
              AND group_key IS NULL
          ) AS missing_group_keys,

          COUNT(*) FILTER (
            WHERE source_system = 'elastic'
              AND enrichment_status = 'pending'
          ) AS enrichment_pending,

          COUNT(*) FILTER (
            WHERE source_system = 'elastic'
              AND enrichment_status = 'enrichment_failed'
          ) AS enrichment_failed
        FROM alerts
      `),
    ]);

    const pageSize = parseInt(
      settings.elastic_cursor_page_size || 20,
      10
    );

    const maxPages = parseInt(
      settings.elastic_cursor_max_pages || 5,
      10
    );

    const dbRow = databaseStats.rows[0] || {};

    res.json({
      collector: {
        source:
          process.env.ALERT_SOURCE || settings.alert_source || 'mock',

        scheduler_enabled:
          settings.scheduler_enabled === 'true',

        scheduler_running:
          runtime.running,

        cycle_active:
          runtime.cycle_active,

        cursor_enabled:
          settings.elastic_cursor_enabled === 'true',

        cursor_timestamp:
          Array.isArray(cursor)
            ? cursor[0]
            : null,

        cursor_uuid:
          Array.isArray(cursor)
            ? cursor[1]
            : null,

        interval_minutes:
          parseInt(
            settings.interval_minutes || 5,
            10
          ),

        page_size: pageSize,
        max_pages: maxPages,

        max_alerts_per_cycle:
          pageSize * maxPages,

        enrichment_batch_size:
          parseInt(
            settings.enrichment_batch_size || 100,
            10
          ),
      },

      safety: {
        triage_enabled:
          settings.triage_enabled === 'true',

        elastic_writeback_enabled:
          settings.elastic_writeback_enabled === 'true',
      },

      runtime: {
        last_run: runtime.last_run,
        last_error: runtime.last_error,
      },

      latest_run:
        latestRun.rows[0] || null,

      database: {
        elastic_alerts:
          parseInt(dbRow.elastic_alerts || 0, 10),

        grouped_activities:
          parseInt(
            dbRow.grouped_activities || 0,
            10
          ),

        missing_group_keys:
          parseInt(
            dbRow.missing_group_keys || 0,
            10
          ),

        enrichment_pending:
          parseInt(
            dbRow.enrichment_pending || 0,
            10
          ),

        enrichment_failed:
          parseInt(
            dbRow.enrichment_failed || 0,
            10
          ),
      },
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

r.post('/scheduler/run-now', async (_, res) => {
  try {
    // triggerNow now awaits the full cycle and returns the result
    const result = await scheduler.triggerNow();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

r.post('/scheduler/enrich-pending', async (_, res) => {
  try { res.json(await enrichPending(50)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

r.post('/scheduler/triage-pending', async (req, res) => {
  try {
    const settings = await db.getAllSettings();
    res.json(await triagePending(settings, 20, null, {
      actor: req.user?.username || 'system:manual-triage',
    }));
  } catch (e) {
    res.status(e.status || 500).json({
      error: { code: e.code || 'HERMES_TRIAGE_FAILED', message: e.message, request_id: req.id },
    });
  }
});

r.post('/scheduler/correlate-now', async (req, res) => {
  try {
    const settings = await db.getAllSettings();
    res.json(await correlatePending(settings, null, {
      actor: req.user?.username || 'system:manual-correlation',
      requestId: req.id,
    }));
  } catch (error) {
    res.status(error.status || 502).json({
      error: {
        code: error.code || 'HERMES_CORRELATION_FAILED',
        message: error.message || 'Hermes correlation failed',
        request_id: req.id,
      },
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Alerts
// ────────────────────────────────────────────────────────────────────────────
r.get('/alerts', async (req, res) => {
  try {
    const {
      page = 1, limit = 50,
      severity, verdict, triage_status, enrichment_status,
      src_ip, username, hostname,
      level_min, level_max,
      from, to, search,
    } = req.query;

    const paging = pagination({ page, limit }, { defaultLimit: 50, maxLimit: 200 });
    if (paging.error) return res.status(400).json({ error: paging.error });
    const enumError = optionalEnum(severity, SEVERITIES, 'severity') ||
      optionalEnum(verdict, VERDICTS, 'verdict') ||
      optionalEnum(triage_status, TRIAGE_STATUSES, 'triage_status') ||
      optionalEnum(enrichment_status, ENRICHMENT_STATUSES, 'enrichment_status');
    if (enumError) return res.status(400).json({ error: enumError });
    const dateError = dateRangeError(from, to);
    if (dateError) return res.status(400).json({ error: dateError });
    const numberError = optionalInteger(level_min, 'level_min', 0, 20) || optionalInteger(level_max, 'level_max', 0, 20);
    if (numberError) return res.status(400).json({ error: numberError });
    if (level_min !== undefined && level_max !== undefined && Number(level_min) > Number(level_max)) {
      return res.status(400).json({ error: 'level_min must not exceed level_max' });
    }
    const textError = optionalText(search, 'search') || optionalText(src_ip, 'src_ip', 255) ||
      optionalText(username, 'username', 255) || optionalText(hostname, 'hostname', 255);
    if (textError) return res.status(400).json({ error: textError });
    const { offset } = paging;
    const conditions = ['1=1'];
    const params = [];
    let i = 1;

    if (severity)           { conditions.push(`verdict->>'severity'=$${i++}`);           params.push(severity); }
    if (verdict)            { conditions.push(`verdict->>'verdict'=$${i++}`);             params.push(verdict); }
    if (triage_status)      { conditions.push(`triage_status=$${i++}`);                   params.push(triage_status); }
    if (enrichment_status)  { conditions.push(`enrichment_status=$${i++}`);               params.push(enrichment_status); }
    if (src_ip)             { conditions.push(`src_ip=$${i++}`);                          params.push(src_ip); }
    if (username)           { conditions.push(`username ILIKE $${i++}`);                  params.push(`%${username}%`); }
    if (hostname)           { conditions.push(`hostname ILIKE $${i++}`);                  params.push(`%${hostname}%`); }
    if (level_min !== undefined && level_min !== '') { conditions.push(`rule_level>=$${i++}`); params.push(Number(level_min)); }
    if (level_max !== undefined && level_max !== '') { conditions.push(`rule_level<=$${i++}`); params.push(Number(level_max)); }
    if (from)               { conditions.push(`timestamp>=$${i++}`);                      params.push(from); }
    if (to)                 { conditions.push(`timestamp<=$${i++}`);                      params.push(to); }
    if (search)             { conditions.push(`(id ILIKE $${i} OR rule_desc ILIKE $${i} OR COALESCE(full_log,'') ILIKE $${i} OR COALESCE(src_ip,'') ILIKE $${i} OR COALESCE(username,'') ILIKE $${i} OR COALESCE(hostname,'') ILIKE $${i})`);
                              params.push(`%${search}%`); i++; }

    const where = conditions.join(' AND ');

    const [rows, count] = await Promise.all([
      db.query(
        `SELECT id, timestamp, rule_id, rule_level, rule_desc, rule_groups,
                agent_name, src_ip, dst_ip, username, hostname, target_db, process,
                mitre_techniques, mitre_tactics,
                enrichment_status, triage_status, verdict, enrichment,
                auto_closed, auto_close_reason, fetched_at
         FROM alerts WHERE ${where}
         ORDER BY timestamp DESC
         LIMIT $${i} OFFSET $${i+1}`,
        [...params, paging.limit, offset]
      ),
      db.query(`SELECT COUNT(*) AS n FROM alerts WHERE ${where}`, params),
    ]);

    res.json({ alerts: rows.rows, total: parseInt(count.rows[0].n), page: paging.page, limit: paging.limit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ────────────────────────────────────────────────────────────────────────────
// Grouped Elastic activities
// ────────────────────────────────────────────────────────────────────────────
r.get('/alert-groups', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      severity,
      dataset,
      triage_status,
      enrichment_status,
      src_ip,
      username,
      hostname,
      from,
      to,
      search,
    } = req.query;

    const paging = pagination({ page, limit }, { defaultLimit: 50, maxLimit: 100 });
    if (paging.error) return res.status(400).json({ error: paging.error });
    const enumError = optionalEnum(severity, SEVERITIES, 'severity') ||
      optionalEnum(triage_status, TRIAGE_STATUSES, 'triage_status') ||
      optionalEnum(enrichment_status, ENRICHMENT_STATUSES, 'enrichment_status');
    if (enumError) return res.status(400).json({ error: enumError });
    const rangeError = dateRangeError(from, to);
    if (rangeError) return res.status(400).json({ error: rangeError });
    const textError = optionalText(dataset, 'dataset', 255) || optionalText(src_ip, 'src_ip', 255) ||
      optionalText(username, 'username', 255) || optionalText(hostname, 'hostname', 255) || optionalText(search, 'search');
    if (textError) return res.status(400).json({ error: textError });

    const safePage = paging.page;
    const safeLimit = paging.limit;

    const offset =
      (safePage - 1) * safeLimit;

    const conditions = [
      "source_system = 'elastic'",
      'group_key IS NOT NULL',
    ];

    const params = [];
    let i = 1;

    if (severity) {
      conditions.push(
        `source_severity = $${i++}`
      );
      params.push(severity);
    }

    if (dataset) {
      conditions.push(
        `event_dataset = $${i++}`
      );
      params.push(dataset);
    }

    if (triage_status) {
      conditions.push(
        `triage_status = $${i++}`
      );
      params.push(triage_status);
    }

    if (enrichment_status) {
      conditions.push(
        `enrichment_status = $${i++}`
      );
      params.push(enrichment_status);
    }

    if (src_ip) {
      conditions.push(
        `src_ip::text ILIKE $${i++}`
      );
      params.push(`%${src_ip}%`);
    }

    if (username) {
      conditions.push(
        `username ILIKE $${i++}`
      );
      params.push(`%${username}%`);
    }

    if (hostname) {
      conditions.push(
        `hostname ILIKE $${i++}`
      );
      params.push(`%${hostname}%`);
    }

    if (from) {
      conditions.push(`timestamp >= $${i++}`);
      params.push(from);
    }

    if (to) {
      conditions.push(`timestamp <= $${i++}`);
      params.push(to);
    }

    if (search) {
      conditions.push(
        `(rule_desc ILIKE $${i} ` +
        `OR alert_reason ILIKE $${i})`
      );
      params.push(`%${search}%`);
      i++;
    }

    const where = conditions.join(' AND ');

    const groupsQuery = `
      WITH filtered AS (
        SELECT
          id,
          group_key,
          timestamp,
          rule_id,
          rule_level,
          rule_desc,
          source_severity,
          risk_score,
          event_dataset,
          username,
          hostname,
          src_ip,
          dst_ip,
          process,
          workflow_status,
          enrichment_status,
          triage_status,
          verdict,
          enrichment
        FROM alerts
        WHERE ${where}
      ),

      grouped AS (
        SELECT
          group_key,
          COUNT(*)::int AS occurrence_count,
          MIN(timestamp) AS first_seen,
          MAX(timestamp) AS last_seen
        FROM filtered
        GROUP BY group_key
      ),

      latest AS (
        SELECT DISTINCT ON (group_key)
          group_key,
          id,
          timestamp,
          rule_id,
          rule_level,
          rule_desc,
          source_severity,
          risk_score,
          event_dataset,
          username,
          hostname,
          src_ip,
          dst_ip,
          process,
          workflow_status,
          enrichment_status,
          triage_status,
          verdict,
          enrichment
        FROM filtered
        ORDER BY
          group_key,
          timestamp DESC,
          id DESC
      )

      SELECT
        latest.id AS representative_alert_id,
        latest.group_key,
        latest.timestamp,
        latest.rule_id,
        latest.rule_level,
        latest.rule_desc,
        latest.source_severity,
        latest.risk_score,
        latest.event_dataset,
        latest.username,
        latest.hostname,
        latest.src_ip,
        latest.dst_ip,
        latest.process,
        latest.workflow_status,
        latest.enrichment_status,
        latest.triage_status,
        latest.verdict,
        latest.enrichment,
        grouped.occurrence_count,
        grouped.first_seen,
        grouped.last_seen
      FROM latest
      JOIN grouped USING (group_key)
      ORDER BY grouped.last_seen DESC
      LIMIT $${i}
      OFFSET $${i + 1}
    `;

    const countQuery = `
      SELECT
        COUNT(DISTINCT group_key)::int AS n
      FROM alerts
      WHERE ${where}
    `;

    const [groups, count] =
      await Promise.all([
        db.query(
          groupsQuery,
          [
            ...params,
            safeLimit,
            offset,
          ]
        ),

        db.query(
          countQuery,
          params
        ),
      ]);

    res.json({
      groups: groups.rows,
      total: count.rows[0]?.n || 0,
      page: safePage,
      limit: safeLimit,
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

// Top alerts to investigate right now — MUST be declared before '/alerts/:id'
// or Express treats "critical" as an :id.
r.get('/alerts/critical', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const { rows } = await db.query(
      `SELECT id, timestamp, rule_level, rule_desc, src_ip, username, hostname,
              verdict->>'severity' AS severity, verdict->>'verdict' AS verdict,
              verdict->>'narrative' AS narrative, verdict->'recommended_actions' AS recommended_actions
       FROM alerts
       WHERE triage_status='triaged' AND auto_closed=false
         AND verdict->>'verdict' IN ('true_positive','needs_investigation')
       ORDER BY CASE verdict->>'severity'
                  WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                  WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
                rule_level DESC, timestamp DESC
       LIMIT $1`, [limit]);
    res.json({ count: rows.length, alerts: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

r.get('/alerts/:id', async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM alerts WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Alert not found' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Re-triage a single alert
r.post('/alerts/:id/retriage', async (req, res) => {
  try {
    const settings = await db.getAllSettings();
    const result = await retriageAlert(req.params.id, settings, {
      actor: req.user?.username || 'system:retriage',
    });
    if (!result) return res.status(404).json({ error: 'Alert not found' });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({
      error: { code: e.code || 'HERMES_TRIAGE_FAILED', message: e.message, request_id: req.id },
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Incidents
// ────────────────────────────────────────────────────────────────────────────
r.get('/incidents', async (req, res) => {
  try {
    const { status = 'open', severity, page = 1, limit = 20 } = req.query;
    const paging = pagination({ page, limit }, { defaultLimit: 20, maxLimit: 100 });
    if (paging.error) return res.status(400).json({ error: paging.error });
    if (status && !['open','closed','false_positive'].includes(status)) return res.status(400).json({ error: 'status has an unsupported value' });
    const severityError = optionalEnum(severity, SEVERITIES, 'severity');
    if (severityError) return res.status(400).json({ error: severityError });
    const { offset } = paging;
    const conditions = ['1=1'];
    const params = [];
    let i = 1;
    if (status)   { conditions.push(`status=$${i++}`);   params.push(status); }
    if (severity) { conditions.push(`severity=$${i++}`); params.push(severity); }

    const where = conditions.join(' AND ');
    const [rows, count] = await Promise.all([
      db.query(
        `SELECT * FROM incidents WHERE ${where}
         ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                                WHEN 'medium' THEN 2 ELSE 3 END,
                  last_seen DESC
         LIMIT $${i} OFFSET $${i+1}`,
        [...params, paging.limit, offset]
      ),
      db.query(`SELECT COUNT(*) AS n FROM incidents WHERE ${where}`, params),
    ]);
    res.json({ incidents: rows.rows, total: parseInt(count.rows[0].n) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

r.get('/incidents/:id', async (req, res) => {
  try {
    const idError = positiveRecordId(req.params.id, 'incident id');
    if (idError) return res.status(400).json({ error: idError });
    const r = await db.query('SELECT * FROM incidents WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Incident not found' });
    const inc = r.rows[0];
    // Attach the full alerts
    const alerts = await db.query(
      'SELECT * FROM alerts WHERE id = ANY($1)', [inc.alert_ids]
    );
    res.json({ ...inc, alerts: alerts.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

r.patch('/incidents/:id', async (req, res) => {
  try {
    const idError = positiveRecordId(req.params.id, 'incident id');
    if (idError) return res.status(400).json({ error: idError });
    const { status } = req.body;
    if (!['open','closed','false_positive'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });
    const r = await db.query(
      `WITH changed AS (
         UPDATE incidents SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *
       ), audited AS (
         INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
         SELECT $3,'incident.status_updated','incident',changed.id::text,'success',$4,
                jsonb_build_object('status',$1) FROM changed
       ) SELECT * FROM changed`,
      [status, req.params.id, req.user?.username || 'unknown', req.id || null]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Incident not found' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// IOC Pivot
// ────────────────────────────────────────────────────────────────────────────
r.get('/pivot', async (req, res) => {
  try {
    const { indicator } = req.query;
    if (!indicator) return res.status(400).json({ error: 'indicator required' });
    const indicatorError = optionalText(indicator, 'indicator', 500);
    if (indicatorError) return res.status(400).json({ error: indicatorError });

    const [alerts, incidents] = await Promise.all([
      db.query(
        `SELECT id, timestamp, rule_level, rule_desc, src_ip, dst_ip,
                username, hostname, triage_status, verdict
         FROM alerts
         WHERE src_ip=$1 OR username=$1 OR hostname LIKE $2
         ORDER BY timestamp DESC LIMIT 100`,
        [indicator, `%${indicator}%`]
      ),
      db.query(
        `SELECT id, title, severity, status, first_seen, last_seen
         FROM incidents
         WHERE $1 = ANY(alert_ids) OR common_entities::text ILIKE $2`,
        [indicator, `%${indicator}%`]
      ),
    ]);

    // Get TIP context from enrichment service
    let tipContext = null;
    try {
      const tr = await fetch(
        `${process.env.ENRICHMENT_URL || 'http://enrichment:3001'}/tip/${encodeURIComponent(indicator)}`,
        { signal: AbortSignal.timeout(3000) }
      );
      if (tr.ok) tipContext = await tr.json();
    } catch (_) {}

    res.json({
      indicator,
      alert_count:    alerts.rows.length,
      incident_count: incidents.rows.length,
      alerts:         alerts.rows,
      incidents:      incidents.rows,
      threat_intel:   tipContext,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// PDF reports
// ────────────────────────────────────────────────────────────────────────────
function sendPdf(res, buffer, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}
const stamp = () => new Date().toISOString().slice(0,10);

r.get('/reports/alerts', async (req, res) => {
  try {
    const hoursError = optionalInteger(req.query.hours, 'hours', 1, 8760);
    if (hoursError) return res.status(400).json({ error: hoursError });
    const hours = req.query.hours ? Number(req.query.hours) : null;
    const detailed = req.query.detailed === 'true' || req.query.type === 'detailed';
    const buf = detailed ? await reports.alertsDetailed(hours) : await reports.alertsSummary(hours);
    sendPdf(res, buf, `alerts-${detailed?'detailed':'summary'}-${stamp()}.pdf`);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

r.get('/reports/incidents', async (req, res) => {
  try {
    const detailed = req.query.detailed === 'true' || req.query.type === 'detailed';
    const buf = detailed ? await reports.incidentsDetailed() : await reports.incidentsSummary();
    sendPdf(res, buf, `incidents-${detailed?'detailed':'summary'}-${stamp()}.pdf`);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

r.get('/reports/incidents/:id', async (req, res) => {
  try {
    const idError = positiveRecordId(req.params.id, 'incident id');
    if (idError) return res.status(400).json({ error: idError });
    const buf = await reports.singleIncident(req.params.id);
    if (!buf) return res.status(404).json({ error: 'incident not found' });
    sendPdf(res, buf, `incident-${req.params.id}-${stamp()}.pdf`);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// SOC assistant chatbot
// ────────────────────────────────────────────────────────────────────────────
r.post('/chat/stream', async (req, res) => {
  const { message, conversation_id: conversationId, history } = req.body || {};
  if (typeof message !== 'string' || !message.trim() || message.length > 4000)
    return res.status(400).json({ error: 'message must be a non-empty string of at most 4000 characters' });
  if (history !== undefined)
    return res.status(400).json({ error: 'history is server-managed; send conversation_id instead' });
  if (conversationId != null && typeof conversationId !== 'string')
    return res.status(400).json({ error: 'conversation_id must be a UUID string' });
  if (req.user?.role !== 'administrator')
    return res.status(403).json({ error: 'SOC analyst access is not permitted for this account' });
  if (!runtimeConfig().hermesApiKey) {
    const response = publicHermesError(
      new HermesError('HERMES_NOT_CONFIGURED', 'Hermes is not configured', { status: 503 }), req.id
    );
    return res.status(response.status).json(response.body);
  }

  const controller = new AbortController();
  const disconnected = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.once('aborted', disconnected);
  res.once('close', disconnected);
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = event => {
    if (!controller.signal.aborted && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
  try {
    const result = await chatHermes(message.trim(), {
      conversationId: conversationId || null,
      actor: req.user?.username || 'unknown', requestId: req.id,
      authorization: {
        canReadSoc: req.user?.role === 'administrator',
        canRequestActions: req.user?.role === 'administrator', role: req.user?.role,
      },
      signal: controller.signal,
      onProgress: event => send({ type: 'progress', ...event }),
    });
    send({ type: 'result', result });
  } catch (error) {
    if (!controller.signal.aborted) {
      const response = publicHermesError(error, req.id);
      send({ type: 'error', error: response.body.error, status: response.status });
    }
  } finally {
    if (!res.writableEnded) res.end();
    req.removeListener('aborted', disconnected);
    res.removeListener('close', disconnected);
  }
});

r.post('/chat', async (req, res) => {
  const controller = new AbortController();
  const disconnected = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.once('aborted', disconnected);
  res.once('close', disconnected);
  try {
    const { message, conversation_id: conversationId, history } = req.body || {};
    if (typeof message !== 'string' || !message.trim() || message.length > 4000)
      return res.status(400).json({ error: 'message must be a non-empty string of at most 4000 characters' });
    if (history !== undefined) {
      return res.status(400).json({ error: 'history is server-managed; send conversation_id instead' });
    }
    if (conversationId != null && typeof conversationId !== 'string') {
      return res.status(400).json({ error: 'conversation_id must be a UUID string' });
    }
    if (req.user?.role !== 'administrator') {
      return res.status(403).json({ error: 'SOC analyst access is not permitted for this account' });
    }
    if (!runtimeConfig().hermesApiKey) {
      throw new HermesError('HERMES_NOT_CONFIGURED', 'Hermes is not configured', { status: 503 });
    }
    const result = await chatHermes(message.trim(), {
      conversationId: conversationId || null,
      actor: req.user?.username || 'unknown',
      authorization: {
        canReadSoc: req.user?.role === 'administrator',
        canRequestActions: req.user?.role === 'administrator', role: req.user?.role,
      },
      requestId: req.id,
      signal: controller.signal,
    });
    if (!controller.signal.aborted && !res.headersSent) res.json(result);
  } catch (error) {
    if (!controller.signal.aborted && !res.headersSent) {
      const response = publicHermesError(error, req.id);
      res.status(response.status).json(response.body);
    }
  } finally {
    req.removeListener('aborted', disconnected);
    res.removeListener('close', disconnected);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Dashboard stats
// ────────────────────────────────────────────────────────────────────────────
r.get('/stats', async (_, res) => {
  try {
    const [alertStats, incidentStats, recentRuns, severitySplit, topSrcIps, alertActivity] = await Promise.all([
      db.getAlertStats(),
      db.query(`SELECT status, COUNT(*) AS n FROM incidents GROUP BY status`),
      db.query(`SELECT * FROM fetch_runs ORDER BY id DESC LIMIT 5`),
      db.query(`
        SELECT
          source_severity AS severity,
          COUNT(DISTINCT group_key)::int AS n
        FROM alerts
        WHERE source_system = 'elastic'
          AND group_key IS NOT NULL
          AND source_severity IS NOT NULL
        GROUP BY source_severity
        ORDER BY
          CASE source_severity
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            WHEN 'low' THEN 4
            ELSE 5
          END
      `),

      db.query(`
        SELECT
          src_ip,
          COUNT(DISTINCT group_key)::int AS n
        FROM alerts
        WHERE source_system = 'elastic'
          AND group_key IS NOT NULL
          AND src_ip IS NOT NULL
        GROUP BY src_ip
        ORDER BY n DESC
        LIMIT 10
      `),

      db.query(`
        WITH buckets AS (
          SELECT generate_series(
            date_trunc('hour', NOW()) - interval '23 hours',
            date_trunc('hour', NOW()),
            interval '1 hour'
          ) AS bucket
        ),
        activity AS (
          SELECT
            date_trunc('hour', timestamp) AS bucket,
            COUNT(*)::int AS raw_alerts,
            COUNT(DISTINCT group_key)::int AS activities
          FROM alerts
          WHERE source_system = 'elastic'
            AND timestamp >= NOW() - interval '24 hours'
          GROUP BY 1
        )
        SELECT
          buckets.bucket,
          COALESCE(activity.raw_alerts, 0)::int AS raw_alerts,
          COALESCE(activity.activities, 0)::int AS activities
        FROM buckets
        LEFT JOIN activity USING (bucket)
        ORDER BY buckets.bucket
      `),
    ]);

    const incByStatus = Object.fromEntries(incidentStats.rows.map(r => [r.status, parseInt(r.n)]));

    res.json({
      alerts:    alertStats,
      incidents: {
        total:        Object.values(incByStatus).reduce((a,b)=>a+b,0),
        open:         incByStatus.open         || 0,
        closed:       incByStatus.closed       || 0,
        false_positive: incByStatus.false_positive || 0,
      },
      recent_runs:    recentRuns.rows,
      severity_split: severitySplit.rows,
      top_src_ips:    topSrcIps.rows,
      alert_activity: alertActivity.rows,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// Fetch runs (history)
// ────────────────────────────────────────────────────────────────────────────
r.get('/runs', async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.query;
    const paging = pagination({ page, limit }, { defaultLimit: 50, maxLimit: 200 });
    if (paging.error) return res.status(400).json({ error: paging.error });
    const { offset } = paging;
    const [rows, count] = await Promise.all([
      db.query(`SELECT * FROM fetch_runs ORDER BY id DESC LIMIT $1 OFFSET $2`,
               [paging.limit, offset]),
      db.query(`SELECT COUNT(*) AS n FROM fetch_runs`),
    ]);
    res.json({ runs: rows.rows, total: parseInt(count.rows[0].n) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = r;
