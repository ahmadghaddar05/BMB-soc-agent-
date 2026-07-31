'use strict';
const crypto = require('node:crypto');
const https = require('node:https');
const { URL } = require('node:url');

function validateConfiguration() {
  const url = (process.env.SPLUNK_URL || '').replace(/\/$/, '');
  if (!url) throw new Error('SPLUNK_URL is not set');
  if (!/^(?:https?:)\/\//.test(url)) throw new Error('SPLUNK_URL must be a valid HTTP(S) URL');
  if (!process.env.SPLUNK_TOKEN) throw new Error('SPLUNK_TOKEN is not set');
  const index = process.env.SPLUNK_INDEX || 'main';
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(index)) {
    throw new Error('SPLUNK_INDEX contains invalid characters');
  }
  return {
    url,
    token: process.env.SPLUNK_TOKEN,
    index,
    search: process.env.SPLUNK_SEARCH || `search index=${index}`,
    verifyTls: process.env.SPLUNK_VERIFY_TLS !== 'false',
  };
}

function safeLiteral(value) {
  if (value == null) return null;
  return `"${String(value).replace(/(["\\])/g, '\\$1')}"`;
}

function normalizeAlert(hit) {
  const result = hit.result || {};
  const raw = result._raw || String(result.raw || '');
  const timestamp = result._time || result.time || new Date().toISOString();
  const unique = `${timestamp}|${result._indextime || ''}|${raw}`;
  const id = `splunk:${crypto.createHash('sha256').update(unique).digest('hex').slice(0, 16)}`;
  return {
    id,
    timestamp,
    rule_id: String(result.rule_id || result.rule || 'splunk_event'),
    rule_level: Number(result.rule_level || result.severity || 7),
    rule_desc: String(result.rule_desc || result.sourcetype || 'Splunk event').slice(0, 500),
    rule_groups: [],
    source_system: 'splunk',
    source_index: result.index || result._index || null,
    full_log: raw,
    src_ip: result.src || result.source_ip || result.client_ip || null,
    dst_ip: result.dest || result.destination_ip || null,
    username: result.user || result.username || result.user_name || null,
    hostname: result.host || result.hostname || result.host_name || null,
    process: result.process || result.process_name || result.exe || null,
    event_dataset: result.event_dataset || result['event.dataset'] || result.sourcetype || null,
    event_action: result.action || result['event.action'] || null,
    alert_reason: result._raw || null,
    raw: result,
  };
}

function normalizeRawEvent(result) {
  const raw = result._raw || String(result.raw || '');
  const timestamp = result._time || result.time || new Date().toISOString();
  const unique = `${timestamp}|${result._indextime || ''}|${raw}`;
  const id = `splunk:${crypto.createHash('sha256').update(unique).digest('hex').slice(0, 16)}`;
  return {
    id,
    timestamp,
    source_index: result.index || result._index || null,
    document_id: result._indextime ? `${result.index || ''}:${result._indextime}` : null,
    event_id: result.event_id || result._cd || null,
    kind: result['event.kind'] || result.kind || null,
    dataset: result['event.dataset'] || result.dataset || result.sourcetype || null,
    categories: result['event.category'] ? String(result['event.category']).split(',').map(s => s.trim()) : [],
    types: result['event.type'] ? String(result['event.type']).split(',').map(s => s.trim()) : [],
    action: result['event.action'] || result.action || null,
    outcome: result['event.outcome'] || null,
    severity: result.severity || null,
    username: result.user || result.username || result['user.name'] || null,
    hostname: result.host || result.hostname || result['host.name'] || null,
    source_ip: result.src || result.source_ip || result['source.ip'] || null,
    destination_ip: result.dest || result.destination_ip || result['destination.ip'] || null,
    process: {
      name: result.process || result.process_name || result.exe || null,
      executable: result.process || null,
      command_line: result.process_command_line || null,
    },
    url: {
      domain: result.url_domain || result['url.domain'] || null,
      path: result.url_path || result['url.path'] || null,
    },
    database: result['database.name'] || result.database || null,
    policy: {
      id: result['policy.id'] || null,
      domain: result['policy.domain'] || null,
      category: result['policy.category'] || null,
      violation: result['policy.violation'] || null,
      authorized: result['policy.authorized'] || null,
      security_alert: result['policy.security_alert'] || null,
      disposition: result['policy.disposition'] || null,
      reason: result['policy.reason'] || null,
    },
    change: {
      id: result['change.id'] || null,
      approved: result['change.approved'] || null,
    },
    campaign: {
      id: result['attack.campaign_id'] || null,
      stage: result['attack.stage'] || null,
      tactic: result['attack.tactic'] || null,
    },
    message: raw || result.message || null,
  };
}

function buildAgentOptions(config, timeoutMs) {
  const options = {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/json',
    },
  };
  if (config.verifyTls === false) {
    options.agent = new https.Agent({ rejectUnauthorized: false });
  }
  return options;
}

async function requestSplunk(path, { method = 'GET', headers = {}, body = null, timeoutMs = 30000 } = {}) {
  const config = validateConfiguration();
  const url = new URL(path, config.url);
  const options = buildAgentOptions(config, timeoutMs);
  options.method = method;
  options.headers = { ...options.headers, ...headers };
  if (body) {
    options.body = body;
    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const response = await fetch(url.toString(), options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Splunk request failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return text;
}

async function parseExportResponse(text) {
  const events = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.result) events.push(parsed.result);
    } catch {
      continue;
    }
  }
  return events;
}

async function fetchAlerts({ minutes = 15, limit = 200 } = {}) {
  const config = validateConfiguration();
  let search = config.search.trim();
  if (!/^search\s+/i.test(search)) search = `search ${search}`;
  search = `${search} earliest_time=-${Math.max(1, Number(minutes) || 15)}m latest_time=now | head ${Math.min(Math.max(1, Number(limit) || 200), 5000)}`;
  const body = new URLSearchParams({
    search,
    output_mode: 'json',
    exec_mode: 'oneshot',
    count: String(Math.min(Math.max(1, Number(limit) || 200), 5000)),
  }).toString();
  const text = await requestSplunk('/services/search/jobs/export', { method: 'POST', body, timeoutMs: 60000 });
  const results = await parseExportResponse(text);
  return results.map(normalizeAlert);
}

function buildSearchClauses(options = {}) {
  const clauses = [];
  if (options.dataset) clauses.push(`event.dataset=${safeLiteral(options.dataset)}`);
  if (options.action) clauses.push(`event.action=${safeLiteral(options.action)}`);
  if (options.username) clauses.push(`user=${safeLiteral(options.username)}`);
  if (options.hostname) clauses.push(`host=${safeLiteral(options.hostname)}`);
  if (options.process) clauses.push(`process=${safeLiteral(options.process)}`);
  if (options.url_domain) clauses.push(`url.domain=${safeLiteral(options.url_domain)}`);
  if (options.policy_violation !== undefined && options.policy_violation !== null) {
    clauses.push(`policy.violation=${options.policy_violation ? 'true' : 'false'}`);
  }
  if (options.source_ip) {
    const ip = safeLiteral(options.source_ip);
    clauses.push(`(source.ip=${ip} OR src=${ip} OR clientip=${ip})`);
  }
  return clauses;
}

async function searchEvents(options = {}) {
  const config = validateConfiguration();
  const hours = Math.min(Math.max(Number(options.hours) || 24, 1), 168);
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 25);
  let search = config.search.trim();
  if (!/^search\s+/i.test(search)) search = `search ${search}`;
  const clauses = buildSearchClauses(options);
  if (clauses.length) search = `${search} ${clauses.join(' ')}`;
  search = `${search} earliest_time=-${hours}h latest_time=now | head ${limit}`;
  const body = new URLSearchParams({
    search,
    output_mode: 'json',
    exec_mode: 'oneshot',
    count: String(limit),
  }).toString();
  const text = await requestSplunk('/services/search/jobs/export', { method: 'POST', body, timeoutMs: 60000 });
  const results = await parseExportResponse(text);
  return results.map(normalizeRawEvent);
}

async function checkHealth() {
  const config = validateConfiguration();
  const text = await requestSplunk('/services/server/info?output_mode=json', { method: 'GET', timeoutMs: 8000 });
  const data = JSON.parse(text);
  const entry = Array.isArray(data.entry) ? data.entry[0] : null;
  return {
    status: 'online',
    configured: true,
    reachable: true,
    latency_ms: 0,
    server_name: entry?.content?.serverName || null,
    version: entry?.content?.version || null,
  };
}

module.exports = {
  fetchAlerts,
  searchEvents,
  checkHealth,
};
