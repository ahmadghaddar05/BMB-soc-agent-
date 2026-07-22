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
const responses = require('./responses');
const admin = require('./admin');
const { POLICY_VERSION: AUTONOMOUS_POLICY_VERSION, runAutonomousAgent } = require('../workers/autonomous');
const { requireRoles } = require('../middleware/auth');

const r = Router();

const ANALYST_READ_PREFIXES = Object.freeze([
  '/health', '/collector/status', '/agent/status', '/alerts', '/alert-groups',
  '/incidents', '/pivot', '/stats', '/investigations', '/cases', '/actions',
  '/action-policy', '/responses', '/reports',
]);

const EXECUTIVE_READ_PREFIXES = Object.freeze([
  '/health', '/collector/status', '/agent/status', '/executive/overview', '/incidents',
]);

function pathMatchesPrefix(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function requireRoleReadAccess(req, res, next) {
  if (!['GET', 'HEAD'].includes(req.method)) return next();
  if (req.path === '/health') return next();

  const role = req.user?.role;
  if (role === 'administrator') return next();

  if (role === 'soc_analyst' && ANALYST_READ_PREFIXES.some(prefix => pathMatchesPrefix(req.path, prefix))) {
    return next();
  }

  if (role === 'executive') {
    const executiveReport = req.path === '/reports/alerts' || req.path === '/reports/incidents';
    if (executiveReport && req.query.detailed !== 'true' && req.query.type !== 'detailed') return next();
    if (EXECUTIVE_READ_PREFIXES.some(prefix => pathMatchesPrefix(req.path, prefix))) return next();
  }

  return res.status(403).json({ error: 'This role cannot access the requested resource' });
}

r.use(requireRoleReadAccess);
r.use(workflows);
r.use(actions);
r.use(responses);
r.use('/admin', admin);

const SEVERITIES = new Set(['critical','high','medium','low','informational']);
const VERDICTS = new Set(['true_positive','false_positive','needs_investigation','benign_anomaly']);
const TRIAGE_STATUSES = new Set(['pending','triaged','triage_failed','skipped']);
const ENRICHMENT_STATUSES = new Set(['pending','enriched','enrichment_failed','skipped']);
const EXECUTIVE_WINDOWS = new Set([7,30,90]);
const EXECUTIVE_TIME_ASSUMPTIONS = Object.freeze({
  triage_per_activity: 8,
  correlation_per_incident: 20,
  investigation_creation: 15,
  analyst_note: 5,
});

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

function numericCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function boundedPressure(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function executiveRiskPressure({ total, critical, high, pending, highImpact, mediumImpact, lowImpact }) {
  const exposure = total > 0
    ? boundedPressure((critical + (high * 0.6)) / total)
    : 0;
  const weightedOpenRisks = highImpact + (mediumImpact * 0.5) + (lowImpact * 0.2);
  const incidents = boundedPressure(weightedOpenRisks / 10);
  const backlog = total > 0 ? boundedPressure(pending / total) : 0;
  return {
    exposure,
    incidents,
    backlog,
    weightedOpenRisks,
    total: boundedPressure((exposure * 0.5) + (incidents * 0.3) + (backlog * 0.2)),
  };
}

function healthBand(score) {
  if (score >= 90) return 'secure';
  if (score >= 75) return 'guarded';
  if (score >= 60) return 'elevated';
  return 'at_risk';
}

const SETTING_KEYS = new Set([
  'scheduler_enabled','interval_minutes','lookback_minutes','min_level','limit',
  'elastic_cursor_enabled','elastic_lookback_minutes','elastic_min_risk_score','elastic_limit',
  'elastic_cursor_page_size','elastic_cursor_max_pages','elastic_cursor_delay_seconds',
  'triage_mode','triage_enabled',
  'autoclose_enabled','autoclose_confidence','autoclose_max_severity','autoclose_verdicts',
  'correlation_enabled','correlation_lookback_hours','correlation_max_alerts',
  'correlation_new_alerts_per_cycle','correlation_initial_alerts',
  'correlation_context_pool','correlation_entity_window_hours','correlation_token_budget',
  'caching_enabled','triage_cache_ttl_hours','triage_token_budget',
  'agentic_max_iterations','hybrid_agentic_min_rule_level',
  'hybrid_agentic_confidence_below',
  'incident_promote_enabled','incident_promote_verdicts','incident_promote_min_severity',
  'autonomous_agent_enabled','autonomous_lookback_hours','autonomous_max_items',
  'autonomous_min_confidence','autonomous_assignment_enabled','autonomous_default_owner',
  'simulated_response_proposals_enabled',
]);

const BOOLEAN_SETTINGS = new Set([
  'scheduler_enabled','triage_enabled','autoclose_enabled','correlation_enabled',
  'elastic_cursor_enabled',
  'caching_enabled','incident_promote_enabled',
  'autonomous_agent_enabled','autonomous_assignment_enabled','simulated_response_proposals_enabled',
]);

const INTEGER_SETTING_LIMITS = {
  interval_minutes:[1,1440], lookback_minutes:[1,10080], min_level:[0,20], limit:[1,5000],
  elastic_lookback_minutes:[1,525600], elastic_min_risk_score:[0,100], elastic_limit:[1,5000],
  elastic_cursor_page_size:[1,1000], elastic_cursor_max_pages:[1,100], elastic_cursor_delay_seconds:[0,3600],
  correlation_lookback_hours:[1,168], correlation_max_alerts:[2,80],
  correlation_new_alerts_per_cycle:[1,50], correlation_initial_alerts:[2,40],
  correlation_context_pool:[10,300], correlation_entity_window_hours:[1,48],
  correlation_token_budget:[6000,100000], triage_cache_ttl_hours:[1,720],
  triage_token_budget:[10000,500000], agentic_max_iterations:[2,4],
  hybrid_agentic_min_rule_level:[1,20],
  autonomous_lookback_hours:[1,168], autonomous_max_items:[1,100],
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
  if (['autoclose_confidence','hybrid_agentic_confidence_below','autonomous_min_confidence'].includes(key)) {
    const number = Number(text);
    if (!Number.isFinite(number) || number < 0 || number > 1) return `${key} must be between 0 and 1`;
  }
  if (key === 'autoclose_enabled' && text !== 'false') return 'automatic closure remains disabled';
  if (key === 'incident_promote_enabled' && text !== 'false') return 'automatic singleton promotion remains disabled';
  if (key === 'autonomous_default_owner' && (!text.trim() || text.length > 120)) {
    return 'autonomous_default_owner must be between 1 and 120 characters';
  }
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

r.put('/settings', requireRoles('administrator'), async (req, res) => {
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
    await db.setSettingsAtomic(updates, {
      actor: req.user?.username || 'unknown',
      requestId: req.id || null,
    });

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

r.post('/scheduler/run-now', requireRoles('administrator'), async (_, res) => {
  try {
    // triggerNow now awaits the full cycle and returns the result
    const result = await scheduler.triggerNow();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

r.post('/scheduler/enrich-pending', requireRoles('administrator'), async (_, res) => {
  try { res.json(await enrichPending(50)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

r.post('/scheduler/triage-pending', requireRoles('administrator'), async (req, res) => {
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

r.post('/scheduler/correlate-now', requireRoles('administrator'), async (req, res) => {
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

r.get('/agent/status', async (_, res) => {
  try {
    const settings = await db.getAllSettings();
    const [runs, operations, totals, pending] = await Promise.all([
      db.query(`SELECT * FROM autonomous_runs ORDER BY started_at DESC LIMIT 10`),
      db.query(`SELECT * FROM autonomous_operations ORDER BY updated_at DESC LIMIT 25`),
      db.query(`SELECT status,operation_type,COUNT(*)::int AS n
        FROM autonomous_operations GROUP BY status,operation_type`),
      db.query(`SELECT COUNT(*)::int AS n FROM action_requests
        WHERE status='pending' AND requested_by='system:autonomous-agent'`),
    ]);
    res.json({
      enabled: settings.autonomous_agent_enabled === 'true',
      policy_version: AUTONOMOUS_POLICY_VERSION,
      readiness: {
        scheduler: settings.scheduler_enabled === 'true',
        triage: settings.triage_enabled === 'true',
        correlation: settings.correlation_enabled === 'true',
        autonomous: settings.autonomous_agent_enabled === 'true',
      },
      latest_run: runs.rows[0] || null,
      recent_runs: runs.rows,
      recent_operations: operations.rows,
      operation_totals: totals.rows,
      pending_approvals: pending.rows[0]?.n || 0,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

r.get('/agent/operations/:id', async (req, res) => {
  try {
    const idError = positiveRecordId(req.params.id, 'operation id');
    if (idError) return res.status(400).json({ error: idError });
    const result = await db.query('SELECT * FROM autonomous_operations WHERE id=$1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Automation record not found' });
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

r.post('/agent/run-now', requireRoles('administrator'), async (req, res) => {
  try {
    if (scheduler.status().cycle_active) {
      return res.status(409).json({ error: 'A pipeline cycle is already running' });
    }
    const settings = await db.getAllSettings();
    const result = await runAutonomousAgent(settings, null, {
      trigger: 'manual', actor: 'system:autonomous-agent',
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
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

    if (severity)           { conditions.push(`COALESCE(source_severity, verdict->>'severity')=$${i++}`); params.push(severity); }
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
    if (search)             { conditions.push(`(id ILIKE $${i} OR rule_desc ILIKE $${i} OR COALESCE(full_log,'') ILIKE $${i} OR COALESCE(src_ip,'') ILIKE $${i} OR COALESCE(username,'') ILIKE $${i} OR COALESCE(hostname,'') ILIKE $${i} OR COALESCE(agent_name,'') ILIKE $${i} OR COALESCE(target_db,'') ILIKE $${i} OR COALESCE(event_dataset,'') ILIKE $${i} OR COALESCE(alert_reason,'') ILIKE $${i} OR COALESCE(event_action,'') ILIKE $${i} OR COALESCE(enrichment #>> '{dst_asset,hostname}','') ILIKE $${i} OR COALESCE(enrichment #>> '{src_asset,hostname}','') ILIKE $${i})`);
                              params.push(`%${search}%`); i++; }

    const where = conditions.join(' AND ');

    const [rows, count] = await Promise.all([
      db.query(
        `SELECT id, timestamp, rule_id, rule_level, rule_desc, rule_groups,
                agent_name, src_ip, dst_ip, username, hostname, target_db, process,
                source_severity, risk_score, workflow_status, alert_reason,
                event_dataset, event_category, event_action,
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
        `(id ILIKE $${i} ` +
        `OR group_key ILIKE $${i} ` +
        `OR rule_desc ILIKE $${i} ` +
        `OR COALESCE(alert_reason, '') ILIKE $${i} ` +
        `OR COALESCE(event_action, '') ILIKE $${i} ` +
        `OR COALESCE(event_dataset, '') ILIKE $${i} ` +
        `OR COALESCE(agent_name, '') ILIKE $${i} ` +
        `OR COALESCE(hostname, '') ILIKE $${i} ` +
        `OR COALESCE(target_db, '') ILIKE $${i} ` +
        `OR COALESCE(username, '') ILIKE $${i} ` +
        `OR COALESCE(enrichment #>> '{dst_asset,hostname}', '') ILIKE $${i} ` +
        `OR COALESCE(enrichment #>> '{src_asset,hostname}', '') ILIKE $${i})`
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
          alert_reason,
          event_dataset,
          event_category,
          event_action,
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
          alert_reason,
          event_dataset,
          event_category,
          event_action,
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
        latest.alert_reason,
        latest.event_dataset,
        latest.event_category,
        latest.event_action,
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
r.post('/alerts/:id/retriage', requireRoles('soc_analyst', 'administrator'), async (req, res) => {
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
      'SELECT * FROM alerts WHERE id = ANY($1) ORDER BY timestamp ASC, id ASC', [inc.alert_ids]
    );
    res.json({ ...inc, alerts: alerts.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

r.patch('/incidents/:id', requireRoles('soc_analyst', 'administrator'), async (req, res) => {
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

    const searchTerm = `%${indicator}%`;
    const [alerts, incidents] = await Promise.all([
      db.query(
        `SELECT id, timestamp, rule_level, rule_desc, source_severity, risk_score,
                src_ip, dst_ip, username, hostname, agent_name, process,
                event_dataset, event_action, alert_reason, triage_status, verdict
         FROM alerts
         WHERE id ILIKE $1
            OR COALESCE(src_ip, '') ILIKE $1
            OR COALESCE(dst_ip, '') ILIKE $1
            OR COALESCE(username, '') ILIKE $1
            OR COALESCE(hostname, '') ILIKE $1
            OR COALESCE(agent_name, '') ILIKE $1
            OR COALESCE(process, '') ILIKE $1
            OR COALESCE(target_db, '') ILIKE $1
            OR COALESCE(event_dataset, '') ILIKE $1
            OR COALESCE(event_action, '') ILIKE $1
            OR COALESCE(alert_reason, '') ILIKE $1
            OR COALESCE(rule_desc, '') ILIKE $1
            OR COALESCE(enrichment::text, '') ILIKE $1
         ORDER BY timestamp DESC LIMIT 100`,
        [searchTerm]
      ),
      db.query(
        `SELECT id, title, severity, status, first_seen, last_seen
         FROM incidents i
         WHERE COALESCE(i.common_entities::text, '') ILIKE $1
            OR COALESCE(i.title, '') ILIKE $1
            OR EXISTS (
              SELECT 1 FROM alerts a
              WHERE a.id = ANY(i.alert_ids)
                AND (
                  a.id ILIKE $1 OR COALESCE(a.src_ip, '') ILIKE $1
                  OR COALESCE(a.dst_ip, '') ILIKE $1 OR COALESCE(a.username, '') ILIKE $1
                  OR COALESCE(a.hostname, '') ILIKE $1 OR COALESCE(a.agent_name, '') ILIKE $1
                  OR COALESCE(a.process, '') ILIKE $1 OR COALESCE(a.target_db, '') ILIKE $1
                )
            )
         ORDER BY i.last_seen DESC`,
        [searchTerm]
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
        canReadSoc: ['executive', 'soc_analyst', 'administrator'].includes(req.user?.role),
        canRequestActions: ['soc_analyst', 'administrator'].includes(req.user?.role), role: req.user?.role,
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
    if (!runtimeConfig().hermesApiKey) {
      throw new HermesError('HERMES_NOT_CONFIGURED', 'Hermes is not configured', { status: 503 });
    }
    const result = await chatHermes(message.trim(), {
      conversationId: conversationId || null,
      actor: req.user?.username || 'unknown',
      authorization: {
        canReadSoc: ['executive', 'soc_analyst', 'administrator'].includes(req.user?.role),
        canRequestActions: ['soc_analyst', 'administrator'].includes(req.user?.role), role: req.user?.role,
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
// Executive security posture. Every score is derived from stored SOC records;
// the response exposes the weighting and time-saving assumptions used.
r.get('/executive/overview', async (req, res) => {
  try {
    const days = req.query.days == null || req.query.days === ''
      ? 30
      : Number(req.query.days);
    if (!Number.isInteger(days) || !EXECUTIVE_WINDOWS.has(days)) {
      return res.status(400).json({ error: 'days must be one of 7, 30, or 90' });
    }

    const severityExpression = `COALESCE(
      NULLIF(source_severity, ''),
      NULLIF(verdict->>'severity', ''),
      CASE
        WHEN rule_level >= 12 THEN 'critical'
        WHEN rule_level >= 9 THEN 'high'
        WHEN rule_level >= 5 THEN 'medium'
        WHEN rule_level >= 1 THEN 'low'
        ELSE 'informational'
      END
    )`;

    const [
      activitySummaryResult,
      businessRiskSummaryResult,
      businessRiskItemsResult,
      fetchMetricsResult,
      riskTrendResult,
      topAssetsResult,
      workflowControlResult,
      coverageResult,
    ] = await Promise.all([
      db.query(`
        /* executive_activity_summary */
        WITH activities AS (
          SELECT DISTINCT ON (COALESCE(group_key, id))
            COALESCE(group_key, id) AS activity_id,
            ${severityExpression} AS severity,
            triage_status
          FROM alerts a
          WHERE timestamp >= NOW() - ($1::int * INTERVAL '1 day')
          ORDER BY COALESCE(group_key, id), timestamp DESC, id DESC
        )
        SELECT
          COUNT(*)::int AS total,
          (COUNT(*) FILTER (WHERE severity = 'critical'))::int AS critical,
          (COUNT(*) FILTER (WHERE severity = 'high'))::int AS high,
          (COUNT(*) FILTER (WHERE severity = 'medium'))::int AS medium,
          (COUNT(*) FILTER (WHERE severity IN ('low', 'informational')))::int AS low,
          (COUNT(*) FILTER (WHERE triage_status = 'pending'))::int AS triage_pending,
          (COUNT(*) FILTER (WHERE triage_status = 'triaged'))::int AS triaged
        FROM activities
      `, [days]),

      db.query(`
        /* executive_business_risk_summary */
        SELECT
          COUNT(*)::int AS total,
          (COUNT(*) FILTER (WHERE severity = 'critical'))::int AS critical,
          (COUNT(*) FILTER (
            WHERE severity IN ('critical', 'high') AND NULLIF(BTRIM(owner), '') IS NULL
          ))::int AS unassigned_high,
          (COUNT(*) FILTER (WHERE severity IN ('critical', 'high')))::int AS high,
          (COUNT(*) FILTER (WHERE severity = 'medium'))::int AS medium,
          (COUNT(*) FILTER (
            WHERE severity IS NULL OR severity NOT IN ('critical', 'high', 'medium')
          ))::int AS low
        FROM incidents
        WHERE status = 'open'
      `),

      db.query(`
        /* executive_business_risk_items */
        SELECT
          id,
          title,
          severity,
          confidence,
          attack_stages,
          common_entities,
          alert_ids,
          narrative,
          recommended_actions,
          first_seen,
          last_seen,
          status,
          owner,
          NULL::text AS business_service,
          CASE
            WHEN NULLIF(BTRIM(owner), '') IS NULL THEN 'Assign an accountable incident owner'
            WHEN severity IN ('critical', 'high') THEN 'Confirm the containment and recovery plan'
            ELSE 'Confirm continued monitoring or closure criteria'
          END AS required_decision,
          CASE
            WHEN severity IN ('critical', 'high') THEN 'high'
            WHEN severity = 'medium' THEN 'medium'
            ELSE 'low'
          END AS business_impact,
          COALESCE(array_length(alert_ids, 1), 0)::int AS alert_count
        FROM incidents
        WHERE status = 'open'
        ORDER BY
          CASE severity
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            WHEN 'low' THEN 4
            ELSE 5
          END,
          last_seen DESC NULLS LAST,
          id DESC
        LIMIT 12
      `),

      db.query(`
        /* executive_fetch_metrics */
        SELECT
          COALESCE(SUM(stored) FILTER (WHERE started_at >= NOW() - ($1::int * INTERVAL '1 day')), 0)::int AS stored,
          COALESCE(SUM(triaged) FILTER (WHERE started_at >= NOW() - ($1::int * INTERVAL '1 day')), 0)::int AS triaged,
          COALESCE(SUM(incidents_created) FILTER (WHERE started_at >= NOW() - ($1::int * INTERVAL '1 day')), 0)::int AS incidents_created,
          COALESCE(SUM(investigations_created) FILTER (WHERE started_at >= NOW() - ($1::int * INTERVAL '1 day')), 0)::int AS investigations_created,
          COALESCE(SUM(investigation_notes_added) FILTER (WHERE started_at >= NOW() - ($1::int * INTERVAL '1 day')), 0)::int AS investigation_notes_added,
          COALESCE(SUM(case_notes_added) FILTER (WHERE started_at >= NOW() - ($1::int * INTERVAL '1 day')), 0)::int AS case_notes_added,
          COALESCE(SUM(approvals_requested) FILTER (WHERE started_at >= NOW() - ($1::int * INTERVAL '1 day')), 0)::int AS approvals_requested,
          COALESCE(SUM(autonomous_failures) FILTER (WHERE started_at >= NOW() - ($1::int * INTERVAL '1 day')), 0)::int AS autonomous_failures,
          COALESCE(SUM(triaged) FILTER (
            WHERE started_at < NOW() - ($1::int * INTERVAL '1 day')
              AND started_at >= NOW() - ($1::int * INTERVAL '2 day')
          ), 0)::int AS previous_triaged,
          COALESCE(SUM(incidents_created) FILTER (
            WHERE started_at < NOW() - ($1::int * INTERVAL '1 day')
              AND started_at >= NOW() - ($1::int * INTERVAL '2 day')
          ), 0)::int AS previous_incidents_created,
          COALESCE(SUM(investigations_created) FILTER (
            WHERE started_at < NOW() - ($1::int * INTERVAL '1 day')
              AND started_at >= NOW() - ($1::int * INTERVAL '2 day')
          ), 0)::int AS previous_investigations_created,
          COALESCE(SUM(COALESCE(investigation_notes_added, 0) + COALESCE(case_notes_added, 0)) FILTER (
            WHERE started_at < NOW() - ($1::int * INTERVAL '1 day')
              AND started_at >= NOW() - ($1::int * INTERVAL '2 day')
          ), 0)::int AS previous_notes_added
        FROM fetch_runs
        WHERE started_at >= NOW() - ($1::int * INTERVAL '2 day')
      `, [days]),

      db.query(`
        /* executive_risk_trend */
        WITH days AS (
          SELECT generate_series(
            CURRENT_DATE - ($1::int - 1),
            CURRENT_DATE,
            INTERVAL '1 day'
          )::date AS day
        ),
        activities AS (
          SELECT DISTINCT ON (COALESCE(group_key, id))
            COALESCE(group_key, id) AS activity_id,
            timestamp,
            ${severityExpression} AS severity,
            triage_status
          FROM alerts
          WHERE timestamp >= CURRENT_DATE - ($1::int - 1)
          ORDER BY COALESCE(group_key, id), timestamp DESC, id DESC
        ),
        daily_activities AS (
          SELECT
            timestamp::date AS day,
            COUNT(*)::int AS activities,
            (COUNT(*) FILTER (WHERE severity = 'critical'))::int AS critical,
            (COUNT(*) FILTER (WHERE severity = 'high'))::int AS high,
            (COUNT(*) FILTER (WHERE severity = 'medium'))::int AS medium,
            (COUNT(*) FILTER (WHERE severity IN ('low', 'informational')))::int AS low,
            (COUNT(*) FILTER (WHERE triage_status = 'pending'))::int AS pending
          FROM activities
          GROUP BY timestamp::date
        ),
        daily_incidents AS (
          SELECT
            created_at::date AS day,
            COUNT(*)::int AS incidents_created,
            (COUNT(*) FILTER (WHERE severity = 'critical'))::int AS critical_incidents,
            (COUNT(*) FILTER (WHERE severity = 'high'))::int AS high_incidents,
            (COUNT(*) FILTER (WHERE severity IN ('critical', 'high')))::int AS high_impact,
            (COUNT(*) FILTER (WHERE severity = 'medium'))::int AS medium_impact,
            (COUNT(*) FILTER (WHERE severity IN ('low', 'informational')))::int AS low_impact
          FROM incidents
          WHERE created_at >= CURRENT_DATE - ($1::int - 1)
          GROUP BY created_at::date
        )
        SELECT
          days.day,
          COALESCE(daily_activities.activities, 0)::int AS activities,
          COALESCE(daily_activities.critical, 0)::int AS critical,
          COALESCE(daily_activities.high, 0)::int AS high,
          COALESCE(daily_activities.medium, 0)::int AS medium,
          COALESCE(daily_activities.low, 0)::int AS low,
          COALESCE(daily_activities.pending, 0)::int AS pending,
          COALESCE(daily_incidents.incidents_created, 0)::int AS incidents_created,
          COALESCE(daily_incidents.critical_incidents, 0)::int AS critical_incidents,
          COALESCE(daily_incidents.high_incidents, 0)::int AS high_incidents,
          COALESCE(daily_incidents.high_impact, 0)::int AS high_impact,
          COALESCE(daily_incidents.medium_impact, 0)::int AS medium_impact,
          COALESCE(daily_incidents.low_impact, 0)::int AS low_impact
        FROM days
        LEFT JOIN daily_activities USING (day)
        LEFT JOIN daily_incidents USING (day)
        ORDER BY days.day
      `, [days]),

      db.query(`
        /* executive_top_assets */
        WITH evidence AS (
          SELECT DISTINCT ON (COALESCE(group_key, id))
            COALESCE(group_key, id) AS activity_id,
            timestamp,
            ${severityExpression} AS severity,
            COALESCE(
              NULLIF(enrichment #>> '{dst_asset,hostname}', ''),
              NULLIF(enrichment #>> '{src_asset,hostname}', ''),
              NULLIF(hostname, ''),
              NULLIF(target_db, '')
            ) AS asset_name,
            COALESCE(
              NULLIF(enrichment #>> '{dst_asset,ci_type}', ''),
              NULLIF(enrichment #>> '{src_asset,ci_type}', ''),
              CASE
                WHEN target_db IS NOT NULL THEN 'database'
                WHEN hostname IS NOT NULL THEN 'host'
                ELSE 'service'
              END
            ) AS asset_type
          FROM alerts
          WHERE timestamp >= NOW() - ($1::int * INTERVAL '1 day')
            AND source_system = 'elastic'
            AND group_key IS NOT NULL
          ORDER BY COALESCE(group_key, id), timestamp DESC, id DESC
        )
        SELECT
          asset_name AS name,
          asset_type AS type,
          COUNT(*)::int AS activity_count,
          (COUNT(*) FILTER (WHERE severity IN ('critical', 'high')))::int AS high_risk_activity_count,
          CASE
            WHEN BOOL_OR(severity IN ('critical', 'high')) THEN 'high'
            WHEN BOOL_OR(severity = 'medium') THEN 'medium'
            ELSE 'low'
          END AS business_impact,
          MAX(timestamp) AS last_seen
        FROM evidence
        WHERE asset_name IS NOT NULL
        GROUP BY asset_name, asset_type
        ORDER BY high_risk_activity_count DESC, activity_count DESC, last_seen DESC
        LIMIT 5
      `, [days]),

      db.query(`
        /* executive_workflow_controls */
        SELECT
          (COUNT(*) FILTER (WHERE status = 'pending'))::int AS pending_approvals,
          (COUNT(*) FILTER (WHERE status = 'failed'))::int AS failed_actions,
          (COUNT(*) FILTER (WHERE status = 'executed'))::int AS executed_internal_actions
        FROM action_requests
      `),

      db.query(`
        /* executive_source_coverage */
        WITH activities AS (
          SELECT DISTINCT ON (COALESCE(group_key, id))
            COALESCE(group_key, id) AS activity_id,
            enrichment_status,
            COALESCE(
              NULLIF(enrichment #>> '{dst_asset,hostname}', ''),
              NULLIF(enrichment #>> '{src_asset,hostname}', ''),
              NULLIF(hostname, ''),
              NULLIF(target_db, ''),
              NULLIF(event_dataset, '')
            ) AS mapped_asset
          FROM alerts
          WHERE timestamp >= NOW() - ($1::int * INTERVAL '1 day')
          ORDER BY COALESCE(group_key, id), timestamp DESC, id DESC
        )
        SELECT
          COUNT(*)::int AS activities,
          (COUNT(*) FILTER (WHERE mapped_asset IS NOT NULL))::int AS asset_mapped,
          (COUNT(*) FILTER (WHERE enrichment_status = 'enriched'))::int AS enriched
        FROM activities
      `, [days]),
    ]);

    const activityRow = activitySummaryResult.rows[0] || {};
    const riskRow = businessRiskSummaryResult.rows[0] || {};
    const runRow = fetchMetricsResult.rows[0] || {};
    const workflowRow = workflowControlResult.rows[0] || {};
    const coverageRow = coverageResult.rows[0] || {};
    const activity = {
      total: numericCount(activityRow.total),
      critical: numericCount(activityRow.critical),
      high: numericCount(activityRow.high),
      medium: numericCount(activityRow.medium),
      low: numericCount(activityRow.low),
      pending: numericCount(activityRow.triage_pending),
      triaged: numericCount(activityRow.triaged),
    };
    const businessRiskCounts = {
      total: numericCount(riskRow.total),
      critical: numericCount(riskRow.critical),
      unassignedHigh: numericCount(riskRow.unassigned_high),
      high: numericCount(riskRow.high),
      medium: numericCount(riskRow.medium),
      low: numericCount(riskRow.low),
    };
    const pressure = executiveRiskPressure({
      ...activity,
      highImpact: businessRiskCounts.high,
      mediumImpact: businessRiskCounts.medium,
      lowImpact: businessRiskCounts.low,
    });
    const healthScore = Math.max(0, Math.min(100, Math.round((1 - pressure.total) * 100)));

    const runMetrics = {
      stored: numericCount(runRow.stored),
      triaged: numericCount(runRow.triaged),
      incidentsCreated: numericCount(runRow.incidents_created),
      investigationsCreated: numericCount(runRow.investigations_created),
      investigationNotesAdded: numericCount(runRow.investigation_notes_added),
      caseNotesAdded: numericCount(runRow.case_notes_added),
      approvalsRequested: numericCount(runRow.approvals_requested),
      failures: numericCount(runRow.autonomous_failures),
    };
    const noteCount = runMetrics.investigationNotesAdded + runMetrics.caseNotesAdded;
    const minutesSaved =
      (runMetrics.triaged * EXECUTIVE_TIME_ASSUMPTIONS.triage_per_activity) +
      (runMetrics.incidentsCreated * EXECUTIVE_TIME_ASSUMPTIONS.correlation_per_incident) +
      (runMetrics.investigationsCreated * EXECUTIVE_TIME_ASSUMPTIONS.investigation_creation) +
      (noteCount * EXECUTIVE_TIME_ASSUMPTIONS.analyst_note);
    const previousMinutesSaved =
      (numericCount(runRow.previous_triaged) * EXECUTIVE_TIME_ASSUMPTIONS.triage_per_activity) +
      (numericCount(runRow.previous_incidents_created) * EXECUTIVE_TIME_ASSUMPTIONS.correlation_per_incident) +
      (numericCount(runRow.previous_investigations_created) * EXECUTIVE_TIME_ASSUMPTIONS.investigation_creation) +
      (numericCount(runRow.previous_notes_added) * EXECUTIVE_TIME_ASSUMPTIONS.analyst_note);

    const riskTrend = riskTrendResult.rows.map(row => {
      const daily = {
        total: numericCount(row.activities),
        critical: numericCount(row.critical),
        high: numericCount(row.high),
        pending: numericCount(row.pending),
      };
      const incidentsCreated = numericCount(row.incidents_created);
      const telemetrySufficient = daily.total > 0 || incidentsCreated > 0;
      const dailyPressure = telemetrySufficient ? executiveRiskPressure({
        ...daily,
        highImpact: numericCount(row.high_impact),
        mediumImpact: numericCount(row.medium_impact),
        lowImpact: numericCount(row.low_impact),
      }) : null;
      const date = row.day instanceof Date
        ? row.day.toISOString().slice(0, 10)
        : String(row.day).slice(0, 10);
      return {
        date,
        risk_score: dailyPressure ? Math.round(dailyPressure.total * 100) : null,
        telemetry_sufficient: telemetrySufficient,
        activities: daily.total,
        critical: daily.critical,
        high: daily.high,
        medium: numericCount(row.medium),
        low: numericCount(row.low),
        pending: daily.pending,
        incidents_created: incidentsCreated,
        critical_incidents_created: numericCount(row.critical_incidents),
        high_incidents_created: numericCount(row.high_incidents),
      };
    });

    const coverageActivities = numericCount(coverageRow.activities);
    const assetMapped = numericCount(coverageRow.asset_mapped);
    const enrichedActivities = numericCount(coverageRow.enriched);
    const pendingApprovals = numericCount(workflowRow.pending_approvals);
    const unassignedHighRisks = businessRiskCounts.unassignedHigh;

    res.json({
      generated_at: new Date().toISOString(),
      window_days: days,
      health: {
        score: healthScore,
        status: healthBand(healthScore),
        telemetry_sufficient: activity.total > 0,
        drivers: [
          {
            key: 'critical_high_exposure',
            label: 'Critical and high-risk activity exposure',
            value: activity.critical + activity.high,
            total: activity.total,
            pressure: Number(pressure.exposure.toFixed(4)),
          },
          {
            key: 'open_business_risks',
            label: 'Severity-weighted open business risks',
            value: Number(pressure.weightedOpenRisks.toFixed(1)),
            total: 10,
            pressure: Number(pressure.incidents.toFixed(4)),
          },
          {
            key: 'triage_backlog',
            label: 'Activities awaiting triage',
            value: activity.pending,
            total: activity.total,
            pressure: Number(pressure.backlog.toFixed(4)),
          },
        ],
        methodology: {
          derived: true,
          weights: {
            critical_high_exposure: 0.5,
            open_business_risks: 0.3,
            triage_backlog: 0.2,
          },
          high_severity_weight: 0.6,
          incident_impact_weights: { high: 1, medium: 0.5, low: 0.2 },
          incident_pressure_reference: 10,
          description: 'Health is 100 minus weighted exposure, open-risk, and pending-triage pressure.',
        },
      },
      briefing: {
        direction: null,
        direction_reason: 'Historical posture snapshots are not stored, so period-over-period exposure direction cannot be calculated reliably.',
        summary: businessRiskCounts.critical > 0
          ? `${businessRiskCounts.critical} open critical incident${businessRiskCounts.critical === 1 ? '' : 's'} require attention. ${unassignedHighRisks} high-impact risk${unassignedHighRisks === 1 ? ' has' : 's have'} no recorded owner.`
          : `${businessRiskCounts.total} open incident${businessRiskCounts.total === 1 ? '' : 's'} are being tracked. No open critical incident is currently recorded.`,
        required_decision: unassignedHighRisks > 0
          ? 'Assign accountable owners to unassigned high-impact incidents.'
          : pendingApprovals > 0
            ? `Review ${pendingApprovals} pending action request${pendingApprovals === 1 ? '' : 's'}.`
            : 'No immediate leadership decision is recorded.',
      },
      executive_metrics: {
        cyber_risk_exposure: {
          value: 100 - healthScore,
          unit: 'score',
          direction: 'lower_is_better',
          previous_period: null,
          target: 20,
          available: activity.total > 0,
          confidence: activity.total > 0 ? 'medium' : 'unavailable',
        },
        critical_business_services_at_risk: {
          value: null,
          available: false,
          reason: 'No durable business-service mapping is stored. Technical asset exposure is shown as supporting evidence.',
          confidence: 'unavailable',
        },
        open_critical_incidents: {
          value: businessRiskCounts.critical,
          available: true,
          previous_period: null,
          target: 0,
          confidence: 'high',
        },
        mean_time_to_respond: {
          value: null,
          available: false,
          reason: 'Reliable acknowledgement and response milestone timestamps are not stored.',
          confidence: 'unavailable',
        },
        analyst_workload_reduced: {
          value: Number((minutesSaved / 60).toFixed(1)),
          unit: 'hours',
          available: true,
          previous_period: Number((previousMinutesSaved / 60).toFixed(1)),
          confidence: 'estimated',
        },
      },
      business_risks: {
        total: businessRiskCounts.total,
        by_impact: {
          critical: businessRiskCounts.critical,
          high: businessRiskCounts.high,
          medium: businessRiskCounts.medium,
          low: businessRiskCounts.low,
        },
        items: businessRiskItemsResult.rows,
        methodology: {
          scope: 'currently open incidents',
          derived_from: 'incident severity',
          mapping: {
            high: ['critical', 'high'],
            medium: ['medium'],
            low: ['low', 'informational', 'unknown'],
          },
        },
      },
      automation: {
        activities_seen: activity.total,
        triaged: activity.triaged,
        triage_rate: activity.total > 0
          ? Number(((activity.triaged / activity.total) * 100).toFixed(1))
          : 0,
        primary_metric: 'ai_triage_coverage',
        end_to_end_completion_supported: false,
        fully_automated_closed: null,
        autonomous_completion_rate: null,
        correlated_incidents_created: runMetrics.incidentsCreated,
        investigations_created: runMetrics.investigationsCreated,
        investigation_notes_added: runMetrics.investigationNotesAdded,
        case_notes_added: runMetrics.caseNotesAdded,
        approvals_requested: runMetrics.approvalsRequested,
        failures: runMetrics.failures,
        pending_approvals: pendingApprovals,
        ai_analyst_agreement: null,
        ai_analyst_agreement_available: false,
        external_actions_executed: 0,
        external_actions_supported: false,
        scope_note: 'The reported percentage is AI triage coverage. This platform can correlate evidence and create internal SOC workflow records, but it does not automatically close correlated incidents or perform external containment.',
      },
      time_saved: {
        estimated: true,
        minutes: minutesSaved,
        hours: Number((minutesSaved / 60).toFixed(1)),
        previous_period_hours: Number((previousMinutesSaved / 60).toFixed(1)),
        period_days: days,
        assumptions_minutes: EXECUTIVE_TIME_ASSUMPTIONS,
        inputs: {
          triaged_activities: runMetrics.triaged,
          correlated_incidents: runMetrics.incidentsCreated,
          investigations_created: runMetrics.investigationsCreated,
          analyst_notes_added: noteCount,
        },
        methodology: 'Estimated from completed workflow outputs and explicit task-time assumptions; token usage is not treated as human time.',
      },
      risk_trend: riskTrend,
      top_assets: topAssetsResult.rows,
      decision_queue: {
        unassigned_high_impact_incidents: unassignedHighRisks,
        pending_approvals: pendingApprovals,
        failed_internal_actions: numericCount(workflowRow.failed_actions),
        overdue_actions: null,
        overdue_actions_available: false,
      },
      source_coverage: {
        activities: coverageActivities,
        asset_mapped: assetMapped,
        asset_mapping_percent: coverageActivities > 0
          ? Number(((assetMapped / coverageActivities) * 100).toFixed(1))
          : null,
        enriched: enrichedActivities,
        enrichment_percent: coverageActivities > 0
          ? Number(((enrichedActivities / coverageActivities) * 100).toFixed(1))
          : null,
        business_service_mapping_available: false,
        threat_intelligence_freshness: null,
        vulnerability_source_freshness: null,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
