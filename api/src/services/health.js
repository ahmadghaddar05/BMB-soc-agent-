'use strict';

const db = require('../db');
const { checkHermesHealth } = require('./hermes');
const elastic = require('./elastic');
const splunk = require('./splunk');
const wazuh = require('./wazuh');
const { activeConnector } = require('./connectors');

async function timedCheck(name, check, { configured = true } = {}) {
  const started = Date.now();
  try {
    const detail = await check();
    const status = detail.status || 'online';
    return [name, {
      configured: detail.configured ?? configured,
      reachable: detail.reachable ?? !['disabled','degraded','error'].includes(status),
      status,
      latency_ms: detail.latency_ms ?? Date.now() - started,
      ...detail,
    }];
  } catch (error) {
    return [name, {
      status: 'degraded', configured, reachable: false,
      latency_ms: Date.now() - started, error: error.message || String(error),
    }];
  }
}

async function dependencyHealth() {
  const settings = await db.getAllSettings();
  const managed = await activeConnector();
  const source = managed?.source || process.env.ALERT_SOURCE || settings.alert_source || 'mock';
  const connection = managed?.connection || null;
  const enrichmentUrl = (process.env.ENRICHMENT_URL || 'http://enrichment:3001').replace(/\/$/, '');

  const checks = [
    timedCheck('postgres', async () => {
      const started = Date.now();
      const result = await db.query('SELECT current_database() AS database, NOW() AS server_time');
      return { status: 'online', latency_ms: Date.now() - started, database: result.rows[0]?.database || null };
    }),
    timedCheck('enrichment', async () => {
      const started = Date.now();
      const response = await fetch(`${enrichmentUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Enrichment health HTTP ${response.status}`);
      const data = await response.json();
      return { status: data.status === 'ok' ? 'online' : 'degraded', latency_ms: Date.now() - started, counts: data.counts || null };
    }),
    timedCheck('hermes', () => checkHermesHealth({ settings }), {
      configured: Boolean(process.env.HERMES_API_KEY),
    }),
  ];

  if (source === 'elastic') {
    const configured = Boolean(managed || (process.env.ELASTICSEARCH_URL && process.env.ELASTIC_API_KEY));
    checks.push(timedCheck('alert_source', () => elastic.checkHealth(connection), { configured }));
  } else if (source === 'splunk') {
    const configured = Boolean(managed || (process.env.SPLUNK_URL && process.env.SPLUNK_TOKEN));
    checks.push(timedCheck('alert_source', () => splunk.checkHealth(connection), { configured }));
  } else {
    const configured = Boolean(managed) || process.env.WAZUH_MODE === 'mock' || Boolean(process.env.WAZUH_INDEXER_URL);
    checks.push(timedCheck('alert_source', () => wazuh.checkHealth(connection), { configured }));
  }

  const entries = await Promise.all(checks);
  const services = Object.fromEntries(entries);
  const statuses = Object.values(services).map(service => service.status);
  const status = statuses.includes('degraded') || statuses.includes('error') ? 'degraded' : 'ok';
  return {
    status, source, source_configuration:managed ? 'managed_connector' : 'environment_fallback',
    active_connector_id:managed?.id || null, active_connector_name:managed?.name || null,
    checked_at:new Date().toISOString(), services,
  };
}

module.exports = { dependencyHealth, timedCheck };
