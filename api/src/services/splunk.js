'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
const { buildGroupKey } = require('./grouping');

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;
const MAX_FIRED_ALERT_INSTANCES = 200;
const FIRED_ALERT_CONCURRENCY = 4;
const ALERT_SCOPE_TIME_TOLERANCE_MS = 5 * 60 * 1000;
const SEVERITY_LEVELS = Object.freeze({
  critical: 15,
  high: 12,
  medium: 8,
  low: 4,
  informational: 2,
  info: 2,
  unknown: 7,
});

function booleanValue(value, fallback = true) {
  if (value == null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

function validateConfiguration(input = process.env) {
  const managed = Object.prototype.hasOwnProperty.call(input || {}, 'url');
  const url = String(managed ? input.url : input.SPLUNK_URL || '').trim().replace(/\/$/, '');
  if (!url) throw new Error('SPLUNK_URL is not set');
  let parsed;
  try { parsed = new URL(url); }
  catch { throw new Error('SPLUNK_URL must be a valid HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('SPLUNK_URL must be a valid HTTP(S) URL');
  }

  const token = String(managed ? input.token : input.SPLUNK_TOKEN || '').trim();
  if (!token) throw new Error('SPLUNK_TOKEN is not set');

  const index = String((managed ? input.index : input.SPLUNK_INDEX) || 'alerts').trim();
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(index)) {
    throw new Error('SPLUNK_INDEX contains invalid characters');
  }

  const authScheme = String((managed ? input.authScheme : input.SPLUNK_AUTH_SCHEME) || 'Bearer').trim();
  if (!/^(Bearer|Splunk)$/i.test(authScheme)) {
    throw new Error('SPLUNK_AUTH_SCHEME must be Bearer or Splunk');
  }

  const verifyTls = managed ? Boolean(input.verifyTls) : booleanValue(input.SPLUNK_VERIFY_TLS, true);
  const caCert = String((managed ? input.caCert : input.SPLUNK_CA_CERT) || '').trim();
  if (verifyTls && caCert && !caCert.includes('BEGIN CERTIFICATE') && !fs.existsSync(caCert)) {
    throw new Error('SPLUNK_CA_CERT does not exist at the configured path');
  }

  const collectionMode = String(
    (managed ? input.collectionMode : input.SPLUNK_COLLECTION_MODE) || 'index'
  ).trim().toLowerCase();
  if (!['index', 'triggered_alerts'].includes(collectionMode)) {
    throw new Error('SPLUNK_COLLECTION_MODE must be index or triggered_alerts');
  }
  const namespaceOwner = String(
    (managed ? input.namespaceOwner : input.SPLUNK_NAMESPACE_OWNER) || '-'
  ).trim();
  const namespaceApp = String(
    (managed ? input.namespaceApp : input.SPLUNK_NAMESPACE_APP) || 'search'
  ).trim();
  if (![namespaceOwner, namespaceApp].every(value => /^[A-Za-z0-9._-]{1,200}$/.test(value))) {
    throw new Error('Splunk namespace owner and app contain invalid characters');
  }

  return {
    url,
    token,
    index,
    search: String((managed ? input.search : input.SPLUNK_SEARCH) || '').trim() || `search index=${index}`,
    authScheme: /^splunk$/i.test(authScheme) ? 'Splunk' : 'Bearer',
    verifyTls,
    caCert,
    collectionMode,
    namespaceOwner,
    namespaceApp,
  };
}

function safeLiteral(value) {
  if (value == null) return null;
  return JSON.stringify(String(value));
}

function valueAt(result, ...keys) {
  for (const key of keys) {
    const value = result?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function stringValue(result, ...keys) {
  const value = valueAt(result, ...keys);
  if (value == null) return null;
  if (typeof value === 'object') return null;
  return String(value);
}

function listValue(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (value == null || value === '') return [];
  return String(value).split(',').map(item => item.trim()).filter(Boolean);
}

function parseRawKeyValueFields(value) {
  if (typeof value !== 'string' || !value.includes('=')) return {};
  const fields = {};
  const pattern = /(?:^|[\s,[{])([A-Za-z_][A-Za-z0-9_.:-]*)=(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^,\]}\s]+))/g;
  let match;
  while ((match = pattern.exec(value)) !== null) {
    const raw = match[2] ?? match[3] ?? match[4] ?? '';
    fields[match[1]] = raw.replace(/\\([\\"'])/g, '$1');
  }
  return fields;
}

function enrichedResult(result) {
  const raw = valueAt(result, '_raw', 'raw', 'message');
  return { ...parseRawKeyValueFields(raw), ...result };
}

function readableAlertName(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text
    .replace(/^bmb\b/i, 'BMB')
    .replace(/(^|\s[-:]\s)([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

function alertNameFromSource(result) {
  const source = stringValue(result, 'source');
  const match = source?.match(/^alert\s*:\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

function stableAlertName(result) {
  return stringValue(
    result, 'rule_desc', 'rule_title', 'alert_name', 'ss_name', 'search_name',
    'savedsearch_name', 'signature', 'event_name', 'title', 'name'
  ) || alertNameFromSource(result);
}

function alertNameKey(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeTimestamp(value) {
  if (value == null || value === '') return new Date().toISOString();
  const text = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const milliseconds = Number(text) * 1000;
    if (Number.isFinite(milliseconds)) return new Date(milliseconds).toISOString();
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function normalizeSeverity(result) {
  const explicitValue = valueAt(result, 'rule_level');
  const explicitLevel = explicitValue == null ? NaN : Number(explicitValue);
  if (Number.isFinite(explicitLevel)) return Math.min(15, Math.max(0, Math.round(explicitLevel)));

  const riskValue = valueAt(result, 'risk_score', 'risk_object_risk_score');
  const riskScore = riskValue == null ? NaN : Number(riskValue);
  if (Number.isFinite(riskScore)) {
    if (riskScore >= 90) return 15;
    if (riskScore >= 70) return 12;
    if (riskScore >= 40) return 8;
    if (riskScore > 0) return 4;
  }

  const severity = sourceSeverity(result) || 'unknown';
  return SEVERITY_LEVELS[severity] ?? SEVERITY_LEVELS.unknown;
}

function sourceSeverity(result) {
  const value = valueAt(result, 'urgency', 'severity', 'priority');
  if (value == null) return null;
  const text = String(value).trim().toLowerCase();
  if (/^[1-5]$/.test(text)) {
    return ({ 1:'informational', 2:'low', 3:'medium', 4:'high', 5:'critical' })[Number(text)];
  }
  return text;
}

function stableEventId(result) {
  const observedTimestamp = valueAt(result, '_time', 'time', 'timestamp');
  const unique = [
    valueAt(result, 'index', '_index'),
    valueAt(result, '_cd', 'event_id', 'event_hash', 'orig_sid'),
    observedTimestamp,
    valueAt(result, 'host', 'hostname', 'host.name'),
    valueAt(result, 'source'),
    valueAt(result, 'sourcetype'),
    valueAt(result, '_raw', 'raw', 'message'),
  ].map(value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)).join('|');
  return `splunk:${crypto.createHash('sha256').update(unique).digest('hex')}`;
}

function normalizeAlert(hit) {
  const sourceResult = hit?.result || hit || {};
  const result = enrichedResult(sourceResult);
  const rawValue = valueAt(result, '_raw', 'raw', 'message');
  const raw = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue || result);
  const timestamp = normalizeTimestamp(valueAt(result, '_time', 'time', 'timestamp'));
  const severity = sourceSeverity(result);
  const sourceAlertName = alertNameFromSource(result);
  const action = stringValue(result, 'action', 'event.action') || (sourceAlertName ? 'alert_fired' : null);
  const stableRuleName = stableAlertName(result) || sourceAlertName;
  const ruleDescription = readableAlertName(stableRuleName) ||
    (action === 'alert_fired' ? 'Splunk alert fired' : stringValue(result, 'sourcetype')) ||
    'Splunk detection';
  const application = stringValue(result, 'ss_app', 'app', 'application');
  const triggeredCount = stringValue(result, 'triggered_alerts', 'result_count');
  const explicitReason = stringValue(result, 'description', 'reason', 'rule_description');
  const alertReason = action === 'alert_fired'
    ? [
      `Splunk alert "${ruleDescription}" fired`,
      application ? `in the ${application} application` : null,
      stringValue(result, 'ss_user', 'user') ? `for user ${stringValue(result, 'ss_user', 'user')}` : null,
      triggeredCount ? `with ${triggeredCount} triggered result${triggeredCount === '1' ? '' : 's'}` : null,
    ].filter(Boolean).join(' ') + '.'
    : explicitReason || raw.slice(0, 2000);
  const groups = listValue(valueAt(result, 'rule_groups', 'event.category', 'category'));
  if (action === 'alert_fired') groups.push('splunk_alert');
  if (application) groups.push(application);
  const riskValue = valueAt(result, 'risk_score', 'risk_object_risk_score');
  const riskScore = riskValue == null ? NaN : Number(riskValue);
  const explicitRuleId = stringValue(
    result, 'rule_id', 'event_id', 'signature_id'
  );
  const ruleIdentity = explicitRuleId ||
    (application && stableRuleName ? `${application}:${stableRuleName}` : stableRuleName) ||
    'splunk_event';
  const normalized = {
    id: stableEventId(result),
    timestamp,
    rule_id: ruleIdentity,
    rule_level: normalizeSeverity(result),
    rule_desc: ruleDescription.slice(0, 500),
    rule_groups: [...new Set(groups)],
    source_system: 'splunk',
    source_index: stringValue(result, 'index', '_index'),
    full_log: raw,
    src_ip: stringValue(result, 'src', 'src_ip', 'source_ip', 'client_ip', 'clientip', 'source.ip'),
    dst_ip: stringValue(result, 'dest', 'dest_ip', 'dst_ip', 'destination_ip', 'destination.ip'),
    username: stringValue(result, 'ss_user', 'user', 'username', 'user_name', 'user.name', 'src_user'),
    hostname: stringValue(result, 'host', 'hostname', 'host_name', 'host.name', 'dest_host'),
    target_db: stringValue(result, 'database.name', 'database', 'db_name'),
    process: stringValue(result, 'process_name', 'process.name', 'process', 'exe', 'Image'),
    mitre_techniques: listValue(valueAt(result, 'mitre_techniques', 'mitre_attack_id', 'annotations.mitre_attack')),
    mitre_tactics: listValue(valueAt(result, 'mitre_tactics', 'mitre_tactic')),
    risk_score: Number.isFinite(riskScore) ? riskScore : null,
    source_severity: severity,
    workflow_status: stringValue(result, 'status', 'workflow_status'),
    event_dataset: stringValue(result, 'event_dataset', 'event.dataset') || (action === 'alert_fired' ? 'splunk.alert' : stringValue(result, 'sourcetype')),
    event_category: listValue(valueAt(result, 'event.category', 'category')),
    event_action: action,
    alert_reason: alertReason,
    raw: result,
  };
  normalized.group_key = buildGroupKey(normalized, 5, {
    includeTimeBucket:!(action === 'alert_fired' && stableRuleName),
  });
  return normalized;
}

function normalizeRawEvent(result) {
  const alert = normalizeAlert(result);
  return {
    id: alert.id,
    timestamp: alert.timestamp,
    source_index: alert.source_index,
    document_id: stringValue(result, '_cd') || null,
    event_id: stringValue(result, 'event_id', '_cd') || null,
    kind: stringValue(result, 'event.kind', 'kind'),
    dataset: alert.event_dataset,
    categories: alert.event_category,
    types: listValue(valueAt(result, 'event.type', 'type')),
    action: alert.event_action,
    outcome: stringValue(result, 'event.outcome', 'outcome'),
    severity: alert.source_severity,
    username: alert.username,
    hostname: alert.hostname,
    source_ip: alert.src_ip,
    destination_ip: alert.dst_ip,
    process: {
      name: alert.process,
      executable: stringValue(result, 'process.executable', 'process_path', 'exe', 'Image'),
      command_line: stringValue(result, 'process.command_line', 'process_command_line', 'CommandLine'),
    },
    url: {
      domain: stringValue(result, 'url.domain', 'url_domain'),
      path: stringValue(result, 'url.path', 'url_path'),
    },
    database: alert.target_db,
    policy: {
      id: stringValue(result, 'policy.id'),
      domain: stringValue(result, 'policy.domain'),
      category: stringValue(result, 'policy.category'),
      violation: valueAt(result, 'policy.violation'),
      authorized: valueAt(result, 'policy.authorized'),
      security_alert: valueAt(result, 'policy.security_alert'),
      disposition: stringValue(result, 'policy.disposition'),
      reason: stringValue(result, 'policy.reason'),
    },
    change: {
      id: stringValue(result, 'change.id'),
      approved: valueAt(result, 'change.approved'),
    },
    campaign: {
      id: stringValue(result, 'attack.campaign_id'),
      stage: stringValue(result, 'attack.stage'),
      tactic: stringValue(result, 'attack.tactic'),
    },
    message: alert.full_log,
  };
}

function requestOptions(config, url, { method, headers, timeoutMs }) {
  const options = {
    method,
    headers: {
      Authorization: `${config.authScheme} ${config.token}`,
      Accept: 'application/json',
      ...headers,
    },
    timeout: timeoutMs,
  };
  if (url.protocol === 'https:') {
    options.rejectUnauthorized = config.verifyTls;
    if (config.caCert) options.ca = config.caCert.includes('BEGIN CERTIFICATE')
      ? config.caCert : fs.readFileSync(config.caCert);
  }
  return options;
}

async function requestSplunk(path, {
  method = 'GET', headers = {}, body = null, timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}, connection = null) {
  const config = validateConfiguration(connection || process.env);
  const url = new URL(path, `${config.url}/`);
  const transport = url.protocol === 'https:' ? https : http;
  const options = requestOptions(config, url, { method, headers, timeoutMs });
  if (body != null) {
    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    options.headers['Content-Length'] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const request = transport.request(url, options, response => {
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          request.destroy(new Error('Splunk response exceeded the 50 MiB safety limit'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Splunk request failed (${response.statusCode}): ${text.slice(0, 500)}`));
          return;
        }
        resolve(text);
      });
    });
    request.on('timeout', () => request.destroy(new Error(`Splunk request timed out after ${timeoutMs} ms`)));
    request.on('error', reject);
    if (body != null) request.write(body);
    request.end();
  });
}

function parseExportResponse(text) {
  const events = [];
  let malformed = 0;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformed += 1;
      continue;
    }
    if (parsed.result) events.push(parsed.result);
    if (Array.isArray(parsed.results)) events.push(...parsed.results);
    const errorMessage = parsed.messages?.find?.(message => String(message.type).toUpperCase() === 'ERROR');
    if (errorMessage) throw new Error(`Splunk export error: ${errorMessage.text || 'unknown error'}`);
  }
  if (malformed) throw new Error(`Splunk export returned ${malformed} malformed JSON record(s)`);
  return events;
}

function parseJsonResponse(text, context) {
  let parsed;
  try { parsed = JSON.parse(String(text)); }
  catch { throw new Error(`Splunk ${context} returned malformed JSON`); }
  const errorMessage = parsed.messages?.find?.(message => String(message.type).toUpperCase() === 'ERROR');
  if (errorMessage) throw new Error(`Splunk ${context} error: ${errorMessage.text || 'unknown error'}`);
  return parsed;
}

function firedAlertTimestamp(entry) {
  const raw = valueAt(entry?.content || {}, 'trigger_time') || entry?.published || entry?.updated;
  if (raw == null || raw === '') return null;
  const timestamp = normalizeTimestamp(raw);
  const milliseconds = new Date(timestamp).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function observedTimestamp(result) {
  const raw = valueAt(result, '_time', 'time', 'timestamp', 'trigger_time');
  if (raw == null || raw === '') return null;
  const text = String(raw).trim();
  const milliseconds = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) * 1000 : Date.parse(text);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function firedAlertMetadata(entry, config) {
  const content = entry?.content || {};
  const sid = stringValue(content, 'sid');
  const savedSearchName = stringValue(content, 'savedsearch_name', 'alert_name') || entry?.name || 'Splunk alert';
  const acl = content['eai:acl'] && typeof content['eai:acl'] === 'object' ? content['eai:acl'] : {};
  return {
    _time:valueAt(content, 'trigger_time') || entry?.published || entry?.updated,
    index:config.index,
    action:'alert_fired',
    source:`alert:${savedSearchName}`,
    sourcetype:'splunk_triggered_alert',
    ss_name:savedSearchName,
    search_name:savedSearchName,
    savedsearch_name:savedSearchName,
    ss_app:stringValue(content, 'app') || acl.app || (config.namespaceApp === '-' ? null : config.namespaceApp),
    alert_owner:entry?.author || acl.owner || null,
    severity:valueAt(content, 'severity'),
    sid,
    orig_sid:sid,
    trigger_time:valueAt(content, 'trigger_time'),
    triggered_alerts:valueAt(content, 'triggered_alerts'),
    alert_type:valueAt(content, 'alert_type'),
    digest_mode:valueAt(content, 'digest_mode'),
  };
}

function mergeFiredAlertResult(entry, result, resultIndex, config) {
  const metadata = firedAlertMetadata(entry, config);
  const sourceResult = result && typeof result === 'object' ? result : {};
  return {
    ...sourceResult,
    ...metadata,
    _time:valueAt(sourceResult, '_time', 'time', 'timestamp') || metadata._time,
    _raw:valueAt(sourceResult, '_raw', 'raw', 'message') || JSON.stringify(sourceResult),
    index:stringValue(sourceResult, 'index', '_index') || metadata.index,
    source:stringValue(sourceResult, 'source') || metadata.source,
    severity:valueAt(metadata, 'severity') || valueAt(sourceResult, 'severity', 'urgency', 'priority'),
    event_id:stringValue(sourceResult, 'event_id') || stringValue(sourceResult, '_cd') || `${metadata.sid}:${resultIndex}`,
    source_event_action:stringValue(sourceResult, 'action', 'event.action'),
    bmb_splunk_result_status:Object.keys(sourceResult).length ? 'retrieved' : 'empty',
  };
}

async function fetchSearchJobRows(sid, count, config) {
  const query = new URLSearchParams({ output_mode:'json', count:String(count), offset:'0' });
  const encodedSid = encodeURIComponent(sid);
  const resultsText = await requestSplunk(
    `/services/search/jobs/${encodedSid}/results?${query}`,
    { timeoutMs:60000 }, config
  );
  const results = parseJsonResponse(resultsText, 'search-job results');
  if (Array.isArray(results.results) && results.results.length) return results.results;

  const eventsText = await requestSplunk(
    `/services/search/jobs/${encodedSid}/events?${query}`,
    { timeoutMs:60000 }, config
  );
  const events = parseJsonResponse(eventsText, 'search-job events');
  return Array.isArray(events.results) ? events.results : [];
}

async function fetchConfiguredAlertScope({ minutes, limit }, config) {
  const scopeLimit = Math.min(Math.max(limit * 5, 100), 5000);
  const search = `${normalizedBaseSearch(config)} | head ${scopeLimit}`;
  const body = exportBody({ search, earliestTime:`-${minutes}m`, limit:scopeLimit });
  const text = await requestSplunk(
    '/services/search/jobs/export', { method:'POST', body, timeoutMs:60000 }, config
  );
  const rows = parseExportResponse(text);
  const nameTimestamps = new Map();
  const sids = new Set();
  for (const row of rows) {
    const enriched = enrichedResult(row);
    const name = stableAlertName(enriched);
    const sid = stringValue(enriched, 'sid', 'orig_sid');
    const timestamp = observedTimestamp(enriched);
    if (name && timestamp != null) {
      const key = alertNameKey(name);
      const timestamps = nameTimestamps.get(key) || [];
      timestamps.push(timestamp);
      nameTimestamps.set(key, timestamps);
    }
    if (sid) sids.add(sid);
  }
  return { nameTimestamps, sids };
}

function scopedFiredAlertEntries(entries, scope) {
  const remainingTimestamps = new Map(
    [...scope.nameTimestamps].map(([name, timestamps]) => [name, [...timestamps]])
  );
  return entries.filter(entry => {
    const content = entry?.content || {};
    const sid = stringValue(content, 'sid');
    const name = alertNameKey(stableAlertName(content) || entry?.name);
    const timestamp = firedAlertTimestamp(entry);
    const timestamps = remainingTimestamps.get(name) || [];
    let nearestIndex = -1;
    let nearestDistance = Infinity;
    if (timestamp != null) {
      timestamps.forEach((candidate, index) => {
        const distance = Math.abs(candidate - timestamp);
        if (distance <= ALERT_SCOPE_TIME_TOLERANCE_MS && distance < nearestDistance) {
          nearestIndex = index;
          nearestDistance = distance;
        }
      });
    }
    const sidMatches = scope.sids.has(sid);
    if (!sidMatches && nearestIndex === -1) return false;
    if (nearestIndex !== -1) timestamps.splice(nearestIndex, 1);
    return true;
  });
}

async function fetchTriggeredAlerts({ minutes, limit }, config) {
  const scope = await fetchConfiguredAlertScope({ minutes, limit }, config);
  if (!scope.nameTimestamps.size && !scope.sids.size) return [];
  const cutoff = Date.now() - (minutes * 60 * 1000);
  const instanceLimit = MAX_FIRED_ALERT_INSTANCES;
  const query = new URLSearchParams({
    output_mode:'json', count:String(instanceLimit), offset:'0',
    sort_key:'trigger_time', sort_dir:'desc',
  });
  const owner = encodeURIComponent(config.namespaceOwner);
  const app = encodeURIComponent(config.namespaceApp);
  const text = await requestSplunk(
    `/servicesNS/${owner}/${app}/alerts/fired_alerts/-?${query}`,
    { timeoutMs:30000 }, config
  );
  const data = parseJsonResponse(text, 'fired-alert list');
  const entries = scopedFiredAlertEntries(
    (Array.isArray(data.entry) ? data.entry : [])
    .filter(entry => stringValue(entry?.content || {}, 'sid'))
    .filter(entry => {
      const timestamp = firedAlertTimestamp(entry);
      return timestamp == null || timestamp >= cutoff;
    })
    .sort((left, right) => (firedAlertTimestamp(right) || 0) - (firedAlertTimestamp(left) || 0)),
    scope
  );

  const normalized = [];
  let attemptedJobs = 0;
  let readableJobs = 0;
  for (let start = 0; start < entries.length && normalized.length < limit; start += FIRED_ALERT_CONCURRENCY) {
    const batch = entries.slice(start, start + FIRED_ALERT_CONCURRENCY);
    const remaining = Math.max(1, limit - normalized.length);
    const rowsPerJob = Math.min(100, remaining);
    const batchRows = await Promise.all(batch.map(async entry => {
      attemptedJobs += 1;
      try {
        const rows = await fetchSearchJobRows(entry.content.sid, rowsPerJob, config);
        readableJobs += 1;
        const evidenceRows = rows.length ? rows : [{}];
        return evidenceRows.map((row, index) => mergeFiredAlertResult(entry, row, index, config));
      } catch {
        return [];
      }
    }));
    normalized.push(...batchRows.flat().map(normalizeAlert));
  }

  if (attemptedJobs > 0 && readableJobs === 0) {
    throw new Error('Splunk fired alerts were found, but their search-job results could not be read');
  }
  return normalized.slice(0, limit);
}

function normalizedBaseSearch(config) {
  const search = config.search.trim();
  return /^search(?:\s|$)/i.test(search) ? search : `search ${search}`;
}

function exportBody({ search, earliestTime, latestTime = 'now', limit }) {
  return new URLSearchParams({
    search,
    earliest_time: earliestTime,
    latest_time: latestTime,
    output_mode: 'json',
    count: String(limit),
  }).toString();
}

async function fetchAlerts({ minutes = 15, limit = 200 } = {}, connection = null) {
  const config = validateConfiguration(connection || process.env);
  const boundedMinutes = Math.min(Math.max(1, Number(minutes) || 15), 43200);
  const boundedLimit = Math.min(Math.max(1, Number(limit) || 200), 5000);
  if (config.collectionMode === 'triggered_alerts') {
    return fetchTriggeredAlerts({ minutes:boundedMinutes, limit:boundedLimit }, config);
  }
  const search = `${normalizedBaseSearch(config)} | head ${boundedLimit}`;
  const body = exportBody({ search, earliestTime: `-${boundedMinutes}m`, limit: boundedLimit });
  const text = await requestSplunk('/services/search/jobs/export', { method: 'POST', body, timeoutMs: 60000 }, config);
  return parseExportResponse(text).map(normalizeAlert);
}

function buildSearchClauses(options = {}) {
  const clauses = [];
  if (options.dataset) clauses.push(`event.dataset=${safeLiteral(options.dataset)}`);
  if (options.action) clauses.push(`event.action=${safeLiteral(options.action)}`);
  if (options.username) clauses.push(`(user=${safeLiteral(options.username)} OR user.name=${safeLiteral(options.username)})`);
  if (options.hostname) clauses.push(`(host=${safeLiteral(options.hostname)} OR host.name=${safeLiteral(options.hostname)})`);
  if (options.process) clauses.push(`(process=${safeLiteral(options.process)} OR process.name=${safeLiteral(options.process)})`);
  if (options.url_domain) clauses.push(`url.domain=${safeLiteral(options.url_domain)}`);
  if (options.policy_violation !== undefined && options.policy_violation !== null) {
    clauses.push(`policy.violation=${options.policy_violation ? 'true' : 'false'}`);
  }
  if (options.source_ip) {
    const ip = safeLiteral(options.source_ip);
    clauses.push(`(source.ip=${ip} OR src=${ip} OR src_ip=${ip} OR clientip=${ip})`);
  }
  return clauses;
}

async function searchEvents(options = {}, connection = null) {
  const config = validateConfiguration(connection || process.env);
  const hours = Math.min(Math.max(Number(options.hours) || 24, 1), 168);
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 25);
  let search = normalizedBaseSearch(config);
  const clauses = buildSearchClauses(options);
  if (clauses.length) search = `${search} | search ${clauses.join(' ')}`;
  search = `${search} | head ${limit}`;
  const body = exportBody({ search, earliestTime: `-${hours}h`, limit });
  const text = await requestSplunk('/services/search/jobs/export', { method: 'POST', body, timeoutMs: 60000 }, config);
  return parseExportResponse(text).map(normalizeRawEvent);
}

async function checkHealth(connection = null) {
  const started = Date.now();
  const config = validateConfiguration(connection || process.env);
  const text = await requestSplunk('/services/authentication/current-context?output_mode=json', {
    method: 'GET', timeoutMs: 8000,
  }, config);
  const data = JSON.parse(text);
  const entry = Array.isArray(data.entry) ? data.entry[0] : null;
  return {
    status: config.verifyTls ? 'online' : 'degraded',
    configured: true,
    reachable: true,
    latency_ms: Date.now() - started,
    server: new URL(config.url).host,
    authenticated_user: entry?.content?.username || entry?.name || null,
    index: config.index,
    collection_mode:config.collectionMode,
    namespace:config.collectionMode === 'triggered_alerts'
      ? `${config.namespaceOwner}/${config.namespaceApp}` : null,
    tls_verified: config.verifyTls,
  };
}

module.exports = {
  buildSearchClauses,
  checkHealth,
  fetchAlerts,
  normalizeAlert,
  parseRawKeyValueFields,
  normalizeRawEvent,
  parseExportResponse,
  searchEvents,
  validateConfiguration,
};
