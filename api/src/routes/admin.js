'use strict';

const { Router } = require('express');
const db = require('../db');
const { runtimeConfig } = require('../config');
const { requireRoles } = require('../middleware/auth');

const router = Router();
const AUDIT_OUTCOMES = new Set(['success','failure','denied','cancelled']);

router.use(requireRoles('administrator'));

function pageOptions(query) {
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 50);
  if (!Number.isInteger(page) || page < 1) return { error:'page must be a positive integer' };
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { error:'limit must be between 1 and 100' };
  return { page, limit, offset:(page - 1) * limit };
}

function boundedText(value, name, max = 120) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) return `${name} must be at most ${max} characters`;
  return null;
}

router.get('/runtime', async (req, res) => {
  const config = runtimeConfig();
  res.json({
    generated_at:new Date().toISOString(),
    authentication:{
      mode:config.authDisabled ? 'development_disabled' : 'single_user',
      current_user:req.user?.username || null,
      current_role:req.user?.role || null,
      configured_role:config.userRole,
      session_ttl_minutes:config.sessionTtlMinutes,
      secure_cookie:config.cookieSecure,
      allowed_origins_count:config.allowedOrigins.length,
      service_api_key_configured:Boolean(config.apiKey),
      multi_user_directory_supported:false,
    },
    alert_source:{
      type:config.alertSource,
      elastic_configured:Boolean(config.elasticUrl && config.elasticApiKey),
      elastic_event_indices:config.alertSource === 'elastic' ? config.elasticEventIndices : null,
      tls_verification:config.alertSource === 'elastic' ? config.elasticVerifyTls : null,
      ca_certificate_configured:config.alertSource === 'elastic' ? Boolean(config.elasticCaCert) : null,
      wazuh_configured:config.alertSource === 'wazuh' ? Boolean(config.wazuhUrl && config.wazuhPassword) : null,
    },
    ai_provider:{
      provider:'Hermes',
      model:config.hermesModel,
      required:config.hermesRequired,
      credential_configured:Boolean(config.hermesApiKey),
      strict_capabilities:config.hermesStrictCapabilities,
      safe_toolsets_enforced:config.hermesEnforceSafeToolsets,
      tool_less_profile_required:config.hermesRequireToollessProfile,
      request_timeout_ms:config.hermesRequestTimeoutMs,
      run_timeout_ms:config.hermesTimeoutMs,
    },
  });
});

router.get('/audit-events', async (req, res) => {
  try {
    const paging = pageOptions(req.query);
    if (paging.error) return res.status(400).json({ error:paging.error });
    const { actor, event_type: eventType, outcome } = req.query;
    const validation = boundedText(actor, 'actor') || boundedText(eventType, 'event_type');
    if (validation) return res.status(400).json({ error:validation });
    if (outcome && !AUDIT_OUTCOMES.has(outcome)) return res.status(400).json({ error:'outcome is unsupported' });

    const values = [];
    const conditions = [];
    if (actor) { values.push(`%${actor}%`); conditions.push(`actor ILIKE $${values.length}`); }
    if (eventType) { values.push(`%${eventType}%`); conditions.push(`event_type ILIKE $${values.length}`); }
    if (outcome) { values.push(outcome); conditions.push(`outcome=$${values.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const listValues = [...values, paging.limit, paging.offset];
    const [items, count] = await Promise.all([
      db.query(
        `SELECT id,actor,event_type,target_type,target_id,outcome,request_id,metadata,created_at
         FROM audit_events ${where} ORDER BY created_at DESC,id DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        listValues
      ),
      db.query(`SELECT COUNT(*)::int AS n FROM audit_events ${where}`, values),
    ]);
    res.json({ audit_events:items.rows, total:count.rows[0]?.n || 0, page:paging.page, limit:paging.limit });
  } catch (error) { res.status(500).json({ error:error.message }); }
});

router.get('/data-governance', async (_, res) => {
  try {
    const settings = await db.getAllSettings();
    const [alerts, audit, runs, cache] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS total,MIN(timestamp) AS oldest,MAX(timestamp) AS newest FROM alerts'),
      db.query('SELECT COUNT(*)::int AS total,MIN(created_at) AS oldest,MAX(created_at) AS newest FROM audit_events'),
      db.query('SELECT COUNT(*)::int AS total,MIN(started_at) AS oldest,MAX(started_at) AS newest FROM fetch_runs'),
      db.query('SELECT COUNT(*)::int AS total,MIN(expires_at) AS next_expiry,MAX(expires_at) AS last_expiry FROM triage_cache'),
    ]);
    res.json({
      generated_at:new Date().toISOString(),
      stores:{
        alerts:alerts.rows[0] || { total:0, oldest:null, newest:null },
        audit_events:audit.rows[0] || { total:0, oldest:null, newest:null },
        fetch_runs:runs.rows[0] || { total:0, oldest:null, newest:null },
        triage_cache:cache.rows[0] || { total:0, next_expiry:null, last_expiry:null },
      },
      policies:{
        postgres_automatic_retention_configured:false,
        audit_retention_configured:false,
        alert_retention_configured:false,
        elastic_source_lifecycle:'managed_outside_bmb',
        triage_cache_ttl_hours:Number(settings.triage_cache_ttl_hours || 168),
      },
    });
  } catch (error) { res.status(500).json({ error:error.message }); }
});

module.exports = router;
