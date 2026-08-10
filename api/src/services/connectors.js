'use strict';

const crypto = require('node:crypto');
const net = require('node:net');
const db = require('../db');
const elastic = require('./elastic');
const splunk = require('./splunk');
const wazuh = require('./wazuh');

const TYPES = Object.freeze(['elastic', 'splunk', 'wazuh']);
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._()-]{1,79}$/u;
const HOST_PATTERN = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const INDEX_PATTERN = /^[A-Za-z0-9._,*-]{1,300}$/;

function connectorKey(env = process.env) {
  const value = String(env.CONNECTOR_ENCRYPTION_KEY || '').trim();
  if (!value) return null;
  const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('CONNECTOR_ENCRYPTION_KEY must decode to exactly 32 bytes');
  return key;
}

function managerAvailable(env = process.env) {
  try { return Boolean(connectorKey(env)); }
  catch { return false; }
}

function encryptSecrets(secrets, env = process.env) {
  const key = connectorKey(env);
  if (!key) throw new Error('Connector credential storage is unavailable until CONNECTOR_ENCRYPTION_KEY is configured');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(secrets), 'utf8'), cipher.final()]);
  return {
    secret_ciphertext:ciphertext.toString('base64'),
    secret_iv:iv.toString('base64'),
    secret_tag:cipher.getAuthTag().toString('base64'),
    secret_version:1,
  };
}

function decryptSecrets(row, env = process.env) {
  const key = connectorKey(env);
  if (!key) throw new Error('Connector credential storage is unavailable until CONNECTOR_ENCRYPTION_KEY is configured');
  if (Number(row.secret_version) !== 1) throw new Error('Unsupported connector credential version');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(row.secret_iv, 'base64'));
    decipher.setAuthTag(Buffer.from(row.secret_tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(row.secret_ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plaintext);
  } catch {
    throw new Error('Connector credentials could not be decrypted with the configured key');
  }
}

function bool(value, fallback = true) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (String(value).toLowerCase() === 'true') return true;
  if (String(value).toLowerCase() === 'false') return false;
  throw new Error('verify_tls must be true or false');
}

function cleanHost(value) {
  const host = String(value || '').trim().toLowerCase();
  if (!host) throw new Error('host is required');
  if (host.includes('://') || host.includes('/') || host.includes('@')) {
    throw new Error('host must contain only a hostname or IP address');
  }
  const ipVersion = net.isIP(host);
  if (!ipVersion && !HOST_PATTERN.test(host)) throw new Error('host is not a valid hostname or IP address');
  if (['localhost', '0.0.0.0', '::', '::1'].includes(host) || host.startsWith('127.') || host.startsWith('169.254.')) {
    throw new Error('loopback, unspecified, and link-local connector hosts are not allowed');
  }
  return host;
}

function boundedPort(value, fallback) {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be between 1 and 65535');
  return port;
}

function boundedText(value, name, max, { required = false } = {}) {
  const text = String(value || '').trim();
  if (required && !text) throw new Error(`${name} is required`);
  if (text.length > max) throw new Error(`${name} must be at most ${max} characters`);
  return text;
}

function validateConnectorInput(input, { requireCredentials = true } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('connector body must be an object');
  const type = String(input.connector_type || '').trim().toLowerCase();
  if (!TYPES.includes(type)) throw new Error('connector_type must be elastic, splunk, or wazuh');
  const name = boundedText(input.name, 'name', 80, { required:true });
  if (!NAME_PATTERN.test(name)) throw new Error('name contains unsupported characters');
  const protocol = String(input.protocol || 'https').toLowerCase();
  if (!['https', 'http'].includes(protocol)) throw new Error('protocol must be https or http');
  const host = cleanHost(input.host);
  const defaultPort = type === 'splunk' ? 8089 : 9200;
  const port = boundedPort(input.port, defaultPort);
  const verifyTls = protocol === 'https' ? bool(input.verify_tls, true) : false;
  const caCertificate = boundedText(input.ca_certificate, 'ca_certificate', 100000);
  if (caCertificate && !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(caCertificate)) {
    throw new Error('ca_certificate must be a PEM certificate');
  }
  const config = { protocol, host, port, verify_tls:verifyTls };
  const secrets = { ca_certificate:caCertificate || null };

  if (type === 'elastic') {
    config.alert_alias = boundedText(input.alert_alias || '.alerts-security.alerts-default', 'alert_alias', 300, { required:true });
    config.event_indices = boundedText(input.event_indices || 'logs-*', 'event_indices', 300, { required:true });
    if (!INDEX_PATTERN.test(config.alert_alias) || !INDEX_PATTERN.test(config.event_indices)) throw new Error('Elastic index patterns contain unsupported characters');
    secrets.api_key = boundedText(input.api_key, 'api_key', 10000, { required:requireCredentials });
  } else if (type === 'splunk') {
    config.index = boundedText(input.index || 'main', 'index', 200, { required:true });
    if (!/^[A-Za-z0-9._-]{1,200}$/.test(config.index)) throw new Error('Splunk index contains unsupported characters');
    config.search = boundedText(input.search || `search index=${config.index}`, 'search', 2000, { required:true });
    config.auth_scheme = /^(splunk)$/i.test(input.auth_scheme || '') ? 'Splunk' : 'Bearer';
    secrets.token = boundedText(input.token, 'token', 10000, { required:requireCredentials });
  } else {
    config.index = boundedText(input.index || 'wazuh-alerts-*', 'index', 300, { required:true });
    if (!INDEX_PATTERN.test(config.index)) throw new Error('Wazuh index pattern contains unsupported characters');
    config.username = boundedText(input.username || 'admin', 'username', 200, { required:true });
    secrets.password = boundedText(input.password, 'password', 10000, { required:requireCredentials });
  }
  return { name, type, config, secrets };
}

function endpoint(config) {
  return `${config.protocol}://${config.host}:${config.port}`;
}

function connectionFromRow(row) {
  const secret = decryptSecrets(row);
  const base = {
    id:row.id, source:row.connector_type, managed:true, name:row.name,
    collectionState:row.collection_state || {},
  };
  if (row.connector_type === 'elastic') return {
    ...base,
    connection:{
      url:endpoint(row.config), apiKey:secret.api_key,
      alertAlias:row.config.alert_alias, eventIndices:row.config.event_indices,
      verifyTls:row.config.verify_tls, caCert:secret.ca_certificate || '',
    },
  };
  if (row.connector_type === 'splunk') return {
    ...base,
    connection:{
      url:endpoint(row.config), token:secret.token, index:row.config.index,
      search:row.config.search, authScheme:row.config.auth_scheme,
      verifyTls:row.config.verify_tls, caCert:secret.ca_certificate || '',
    },
  };
  return {
    ...base,
    connection:{
      url:endpoint(row.config), username:row.config.username, password:secret.password,
      index:row.config.index, verifyTls:row.config.verify_tls,
      caCert:secret.ca_certificate || '', mode:'live',
    },
  };
}

function publicConnector(row) {
  const config = row.config || {};
  return {
    id:row.id,
    name:row.name,
    connector_type:row.connector_type,
    endpoint:endpoint(config),
    host:config.host,
    port:config.port,
    protocol:config.protocol,
    verify_tls:config.verify_tls,
    ca_certificate_configured:Boolean(row.ca_certificate_configured),
    credential_configured:true,
    enabled:row.enabled,
    active:row.active,
    index:config.index || config.alert_alias || null,
    event_indices:config.event_indices || null,
    search:config.search || null,
    auth_scheme:config.auth_scheme || (row.connector_type === 'wazuh' ? 'Basic' : 'ApiKey'),
    username:row.connector_type === 'wazuh' ? config.username : null,
    last_test_status:row.last_test_status,
    last_tested_at:row.last_tested_at,
    last_test_latency_ms:row.last_test_latency_ms,
    last_test_error:row.last_test_error,
    created_by:row.created_by,
    updated_by:row.updated_by,
    created_at:row.created_at,
    updated_at:row.updated_at,
  };
}

const SELECT_COLUMNS = `id,name,connector_type,config,collection_state,secret_ciphertext,secret_iv,secret_tag,
  secret_version,enabled,active,last_test_status,last_tested_at,last_test_latency_ms,
  last_test_error,tested_config_hash,created_by,updated_by,created_at,updated_at,
  (secret_ciphertext IS NOT NULL) AS credential_configured,
  ((secret_ciphertext IS NOT NULL) AND (config->>'verify_tls')::boolean) AS encrypted_material_present`;

async function listConnectors() {
  if (!managerAvailable()) return { manager_available:false, connectors:[] };
  const result = await db.query(`SELECT ${SELECT_COLUMNS} FROM source_connectors ORDER BY active DESC,LOWER(name)`);
  const connectors = result.rows.map(row => {
    const decrypted = decryptSecrets(row);
    return publicConnector({ ...row, ca_certificate_configured:Boolean(decrypted.ca_certificate) });
  });
  return { manager_available:true, connectors };
}

async function activeConnector() {
  if (!managerAvailable()) return null;
  const result = await db.query(`SELECT ${SELECT_COLUMNS} FROM source_connectors WHERE active=TRUE AND enabled=TRUE LIMIT 1`);
  return result.rows[0] ? connectionFromRow(result.rows[0]) : null;
}

function configHash(row) {
  return crypto.createHash('sha256').update(JSON.stringify({
    type:row.connector_type, config:row.config, ciphertext:row.secret_ciphertext,
    iv:row.secret_iv, tag:row.secret_tag, version:row.secret_version,
  })).digest('hex');
}

async function testConnection(row) {
  const source = connectionFromRow(row);
  const started = Date.now();
  let health;
  let samples;
  if (source.source === 'elastic') {
    health = await elastic.checkHealth(source.connection);
    samples = await elastic.fetchAlerts({ minutes:15, limit:1 }, source.connection);
  } else if (source.source === 'splunk') {
    health = await splunk.checkHealth(source.connection);
    samples = await splunk.fetchAlerts({ minutes:15, limit:1 }, source.connection);
  } else {
    health = await wazuh.checkHealth(source.connection);
    samples = await wazuh.fetchAlerts({ minutes:15, minLevel:1, limit:1 }, source.connection);
  }
  return {
    ok:true,
    connector_id:row.id,
    connector_type:row.connector_type,
    latency_ms:Date.now() - started,
    authenticated_user:health.authenticated_user || null,
    remote_name:health.cluster_name || health.server || null,
    remote_version:health.version || null,
    sample_count:Array.isArray(samples) ? samples.length : 0,
    tls_verified:row.config.verify_tls,
    tested_config_hash:configHash(row),
    tested_at:new Date().toISOString(),
  };
}

function safeConnectorError(error) {
  const message = String(error?.message || error || 'Connector test failed')
    .replace(/(?:Bearer|Splunk|ApiKey|Basic)\s+[A-Za-z0-9+/_=.:~-]+/gi, '[credential redacted]')
    .replace(/\b(?:token|api[_ -]?key|password|authorization)\s*[:=]\s*[^\s,;]+/gi, '[redacted]');
  return message.slice(0, 500);
}

module.exports = {
  TYPES,
  SELECT_COLUMNS,
  activeConnector,
  configHash,
  connectorKey,
  decryptSecrets,
  encryptSecrets,
  listConnectors,
  managerAvailable,
  publicConnector,
  safeConnectorError,
  testConnection,
  validateConnectorInput,
};
