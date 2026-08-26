'use strict';

const { Router } = require('express');
const db = require('../db');
const {
  SELECT_COLUMNS,
  configHash,
  decryptSecrets,
  encryptSecrets,
  listConnectors,
  managerAvailable,
  publicConnector,
  safeConnectorError,
  testConnection,
  validateConnectorInput,
} = require('../services/connectors');

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function actor(req) { return req.user?.username || 'unknown'; }

async function audit(client, req, eventType, targetId, outcome, metadata = {}) {
  await client.query(
    `INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
     VALUES($1,$2,'source_connector',$3,$4,$5,$6)`,
    [actor(req), eventType, String(targetId), outcome, req.id || null, metadata]
  );
}

async function connectorRow(id, client = db) {
  if (!UUID.test(id)) return null;
  const result = await client.query(`SELECT ${SELECT_COLUMNS} FROM source_connectors WHERE id=$1`, [id]);
  return result.rows[0] || null;
}

function unavailable(res) {
  if (managerAvailable()) return false;
  res.status(503).json({ error:'Connector management requires CONNECTOR_ENCRYPTION_KEY on the API server' });
  return true;
}

router.get('/', async (_req, res) => {
  try { res.json(await listConnectors()); }
  catch (error) { res.status(500).json({ error:error.message }); }
});

router.post('/', async (req, res) => {
  if (unavailable(res)) return;
  let parsed;
  try { parsed = validateConnectorInput(req.body); }
  catch (error) { return res.status(400).json({ error:error.message }); }
  const encrypted = encryptSecrets(parsed.secrets);
  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    const created = await client.query(
      `INSERT INTO source_connectors(
         name,connector_type,config,secret_ciphertext,secret_iv,secret_tag,secret_version,
         enabled,active,created_by,updated_by
       ) VALUES($1,$2,$3,$4,$5,$6,$7,TRUE,FALSE,$8,$8)
       RETURNING ${SELECT_COLUMNS}`,
      [parsed.name, parsed.type, parsed.config, encrypted.secret_ciphertext, encrypted.secret_iv,
        encrypted.secret_tag, encrypted.secret_version, actor(req)]
    );
    await audit(client, req, 'connector.created', created.rows[0].id, 'success', {
      connector_type:parsed.type, name:parsed.name, endpoint:`${parsed.config.protocol}://${parsed.config.host}:${parsed.config.port}`,
    });
    await client.query('COMMIT');
    res.status(201).json({ connector:publicConnector({
      ...created.rows[0], ca_certificate_configured:Boolean(parsed.secrets.ca_certificate),
    }) });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ error:'A connector with this name already exists' });
    res.status(500).json({ error:error.message });
  } finally { client?.release(); }
});

router.patch('/:id', async (req, res) => {
  if (unavailable(res)) return;
  if (!UUID.test(req.params.id)) return res.status(400).json({ error:'Connector ID is invalid' });
  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    const locked = await client.query(`SELECT ${SELECT_COLUMNS} FROM source_connectors WHERE id=$1 FOR UPDATE`, [req.params.id]);
    const existing = locked.rows[0];
    if (!existing) { await client.query('ROLLBACK'); return res.status(404).json({ error:'Connector not found' }); }
    if (req.body?.connector_type && req.body.connector_type !== existing.connector_type) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error:'connector_type cannot be changed; create a new connector' });
    }
    const supplied = { ...existing.config, ...req.body, connector_type:existing.connector_type };
    const parsed = validateConnectorInput(supplied, { requireCredentials:false });
    const previousSecrets = decryptSecrets(existing);
    const credentialName = existing.connector_type === 'elastic' ? 'api_key'
      : existing.connector_type === 'splunk' ? 'token' : 'password';
    const secrets = { ...previousSecrets };
    if (Object.prototype.hasOwnProperty.call(req.body || {}, credentialName) && parsed.secrets[credentialName]) {
      secrets[credentialName] = parsed.secrets[credentialName];
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'ca_certificate')) {
      secrets.ca_certificate = parsed.secrets.ca_certificate;
    }
    const encrypted = encryptSecrets(secrets);
    const updated = await client.query(
      `UPDATE source_connectors SET name=$2,config=$3,secret_ciphertext=$4,secret_iv=$5,
         secret_tag=$6,secret_version=$7,updated_by=$8,updated_at=NOW(),
         last_test_status=NULL,last_tested_at=NULL,last_test_latency_ms=NULL,
         last_test_error=NULL,tested_config_hash=NULL
       WHERE id=$1 RETURNING ${SELECT_COLUMNS}`,
      [existing.id, parsed.name, parsed.config, encrypted.secret_ciphertext, encrypted.secret_iv,
        encrypted.secret_tag, encrypted.secret_version, actor(req)]
    );
    await audit(client, req, 'connector.updated', existing.id, 'success', {
      connector_type:existing.connector_type, name:parsed.name,
      credential_replaced:Object.prototype.hasOwnProperty.call(req.body || {}, credentialName) && Boolean(parsed.secrets[credentialName]),
      ca_certificate_changed:Object.prototype.hasOwnProperty.call(req.body || {}, 'ca_certificate'),
    });
    await client.query('COMMIT');
    res.json({ connector:publicConnector({ ...updated.rows[0], ca_certificate_configured:Boolean(secrets.ca_certificate) }) });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ error:'A connector with this name already exists' });
    const status = /required|must|invalid|unsupported/.test(error.message) ? 400 : 500;
    res.status(status).json({ error:error.message });
  } finally { client?.release(); }
});

router.post('/:id/test', async (req, res) => {
  if (unavailable(res)) return;
  const started = Date.now();
  let row;
  try {
    row = await connectorRow(req.params.id);
    if (!row) return res.status(UUID.test(req.params.id) ? 404 : 400).json({ error:'Connector not found' });
    const result = await testConnection(row);
    await db.query(
      `UPDATE source_connectors SET last_test_status='success',last_tested_at=NOW(),
         last_test_latency_ms=$2,last_test_error=NULL,tested_config_hash=$3 WHERE id=$1`,
      [row.id, result.latency_ms, result.tested_config_hash]
    );
    await db.query(
      `INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
       VALUES($1,'connector.tested','source_connector',$2,'success',$3,$4)`,
      [actor(req), row.id, req.id || null, {
        connector_type:row.connector_type, latency_ms:result.latency_ms,
        sample_count:result.sample_count, tls_verified:result.tls_verified,
      }]
    );
    res.json(result);
  } catch (error) {
    const safeError = safeConnectorError(error);
    if (row) await db.query(
      `UPDATE source_connectors SET last_test_status='failure',last_tested_at=NOW(),
         last_test_latency_ms=$2,last_test_error=$3,tested_config_hash=NULL WHERE id=$1`,
      [row.id, Date.now() - started, safeError]
    ).catch(() => {});
    if (row) await db.query(
      `INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
       VALUES($1,'connector.tested','source_connector',$2,'failure',$3,$4)`,
      [actor(req), row.id, req.id || null, { connector_type:row.connector_type, error:safeError }]
    ).catch(() => {});
    res.status(502).json({ error:safeError });
  }
});

router.post('/:id/activate', async (req, res) => {
  if (unavailable(res)) return;
  if (!UUID.test(req.params.id)) return res.status(400).json({ error:'Connector ID is invalid' });
  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    const locked = await client.query(`SELECT ${SELECT_COLUMNS} FROM source_connectors WHERE id=$1 FOR UPDATE`, [req.params.id]);
    const row = locked.rows[0];
    if (!row) { await client.query('ROLLBACK'); return res.status(404).json({ error:'Connector not found' }); }
    const testedRecently = row.last_test_status === 'success' && row.last_tested_at
      && Date.now() - new Date(row.last_tested_at).getTime() <= 30 * 60 * 1000;
    if (!testedRecently || row.tested_config_hash !== configHash(row)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error:'Connector must pass a current connection test before activation' });
    }
    await client.query('UPDATE source_connectors SET active=FALSE WHERE active=TRUE');
    await client.query(
      'UPDATE source_connectors SET enabled=TRUE,active=TRUE,updated_by=$2,updated_at=NOW() WHERE id=$1',
      [row.id, actor(req)]
    );
    await audit(client, req, 'connector.activated', row.id, 'success', {
      connector_type:row.connector_type, name:row.name,
    });
    await client.query('COMMIT');
    res.json({ ok:true, active_connector_id:row.id, message:`${row.name} is now the active alert source` });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error:error.message });
  } finally { client?.release(); }
});

router.post('/:id/disable', async (req, res) => {
  if (unavailable(res)) return;
  if (!UUID.test(req.params.id)) return res.status(400).json({ error:'Connector ID is invalid' });
  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE source_connectors SET enabled=FALSE,active=FALSE,updated_by=$2,updated_at=NOW()
       WHERE id=$1 RETURNING id,name,connector_type`, [req.params.id, actor(req)]
    );
    if (!result.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error:'Connector not found' }); }
    await audit(client, req, 'connector.disabled', req.params.id, 'success', result.rows[0]);
    await client.query('COMMIT');
    res.json({ ok:true, message:'Connector disabled; collection will use another active connector or the environment fallback' });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error:error.message });
  } finally { client?.release(); }
});

router.delete('/:id', async (req, res) => {
  if (unavailable(res)) return;
  if (!UUID.test(req.params.id)) return res.status(400).json({ error:'Connector ID is invalid' });
  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    const target = await client.query('SELECT id,name,connector_type,active FROM source_connectors WHERE id=$1 FOR UPDATE', [req.params.id]);
    const row = target.rows[0];
    if (!row) { await client.query('ROLLBACK'); return res.status(404).json({ error:'Connector not found' }); }
    if (row.active) { await client.query('ROLLBACK'); return res.status(409).json({ error:'Deactivate the connector before deleting it' }); }
    await audit(client, req, 'connector.deleted', row.id, 'success', {
      connector_type:row.connector_type, name:row.name,
    });
    await client.query('DELETE FROM source_connectors WHERE id=$1', [row.id]);
    await client.query('COMMIT');
    res.json({ ok:true, removed_connector:{ id:row.id, name:row.name, connector_type:row.connector_type } });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error:error.message });
  } finally { client?.release(); }
});

module.exports = router;
