'use strict';

const { Router } = require('express');
const db = require('../db');
const { runtimeConfig } = require('../config');
const { requireRoles } = require('../middleware/auth');
const {
  displayNameError,
  hashPassword,
  passwordError,
  publicUser,
  roleError,
  usernameError,
} = require('../services/user-directory');

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
  try {
    const config = runtimeConfig();
    const directory = config.authDisabled
      ? { rows:[{ total:0, active:0, executives:0, analysts:0, administrators:0 }] }
      : await db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE active)::int AS active,
                COUNT(*) FILTER (WHERE active AND role='executive')::int AS executives,
                COUNT(*) FILTER (WHERE active AND role='soc_analyst')::int AS analysts,
                COUNT(*) FILTER (WHERE active AND role='administrator')::int AS administrators
         FROM app_users`
      );
    res.json({
      generated_at:new Date().toISOString(),
      authentication:{
        mode:config.authDisabled ? 'development_disabled' : 'database_managed_rbac',
        current_user:req.user?.username || null,
        current_user_id:req.user?.id || null,
        current_role:req.user?.role || null,
        directory:directory.rows[0],
        session_ttl_minutes:config.sessionTtlMinutes,
        secure_cookie:config.cookieSecure,
        allowed_origins_count:config.allowedOrigins.length,
        service_api_key_configured:Boolean(config.apiKey),
        multi_user_directory_supported:!config.authDisabled,
        multi_role_accounts_supported:true,
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
  } catch (error) {
    res.status(500).json({ error:error.message });
  }
});

router.get('/users', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id,username,display_name,role,active,created_by,created_at,updated_at,last_login_at
       FROM app_users ORDER BY active DESC,role,LOWER(username)`
    );
    res.json({ users:result.rows.map(publicUser), total:result.rows.length });
  } catch (error) {
    res.status(500).json({ error:error.message });
  }
});

router.post('/users', async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const displayName = typeof req.body?.display_name === 'string' ? req.body.display_name.trim() : '';
  const role = typeof req.body?.role === 'string' ? req.body.role : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const validation = usernameError(username) || displayNameError(displayName) ||
    roleError(role) || passwordError(password);
  if (validation) return res.status(400).json({ error:validation });

  let client;
  try {
    const passwordHash = await hashPassword(password);
    client = await db.connect();
    await client.query('BEGIN');
    const created = await client.query(
      `INSERT INTO app_users(username,display_name,role,password_hash,created_by)
       VALUES($1,$2,$3,$4,$5)
       RETURNING id,username,display_name,role,active,created_by,created_at,updated_at,last_login_at`,
      [username, displayName, role, passwordHash, req.user.username]
    );
    await client.query(
      `INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
       VALUES($1,'user.created','app_user',$2,'success',$3,$4)`,
      [req.user.username, String(created.rows[0].id), req.id, { username, display_name:displayName, role }]
    );
    await client.query('COMMIT');
    res.status(201).json({ user:publicUser(created.rows[0]) });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ error:'Username already exists' });
    res.status(500).json({ error:error.message });
  } finally {
    client?.release();
  }
});

router.delete('/users/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error:'User ID must be numeric' });
  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    const target = await client.query(
      `SELECT id,username,display_name,role,active
       FROM app_users WHERE id=$1 FOR UPDATE`,
      [req.params.id]
    );
    const user = target.rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error:'User not found' });
    }
    if (String(user.id) === String(req.user.id)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error:'You cannot remove your own account' });
    }
    if (user.role === 'administrator' && user.active) {
      const administrators = await client.query(
        `SELECT COUNT(*)::int AS total FROM app_users
         WHERE role='administrator' AND active=TRUE`
      );
      if (Number(administrators.rows[0]?.total || 0) <= 1) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error:'The last active administrator cannot be removed' });
      }
    }
    await client.query(
      `INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
       VALUES($1,'user.removed','app_user',$2,'success',$3,$4)`,
      [req.user.username, String(user.id), req.id, {
        username:user.username, display_name:user.display_name, role:user.role,
      }]
    );
    await client.query('DELETE FROM app_users WHERE id=$1', [user.id]);
    await client.query('COMMIT');
    res.json({ ok:true, removed_user:{ id:String(user.id), username:user.username, role:user.role } });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error:error.message });
  } finally {
    client?.release();
  }
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
