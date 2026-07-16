'use strict';

const Ajv = require('ajv');
const { isIP } = require('node:net');
const db = require('../../db');
const { runtimeConfig } = require('../../config');
const { HermesError } = require('./errors');

const ajv = new Ajv({ allErrors: true, strict: true });
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational', 'unknown'];
const DENIED_KEYS = /^(?:password|passwd|secret|token|api[_-]?key|credential|authorization|cookie|raw|full_log)$/i;

const TOOL_SPECS = [
  {
    name: 'get_soc_summary',
    description: 'Return bounded alert, incident, and recent collection-run counts.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_alerts',
    description: 'Search collected alerts, including alerts not yet triaged, using bounded filters.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200 },
        severity: { enum: SEVERITIES },
        source_ip: { type: 'string', minLength: 1, maxLength: 64 },
        username: { type: 'string', minLength: 1, maxLength: 128 },
        hostname: { type: 'string', minLength: 1, maxLength: 253 },
        source_system: { enum: ['elastic', 'wazuh', 'mock', 'legacy'] },
        hours: { type: 'integer', minimum: 1, maximum: 720 },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
      },
    },
  },
  {
    name: 'get_alert',
    description: 'Get one collected alert by its exact BMB alert ID. Raw source payloads and logs are omitted.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['id'],
      properties: { id: { type: 'string', minLength: 1, maxLength: 256 } },
    },
  },
  {
    name: 'list_incidents',
    description: 'List bounded incident summaries with optional status and severity filters.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        status: { enum: ['open', 'closed', 'false_positive'] },
        severity: { enum: SEVERITIES },
        hours: { type: 'integer', minimum: 1, maximum: 2160 },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
      },
    },
  },
  {
    name: 'get_incident',
    description: 'Get one incident and bounded summaries of its member alerts.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['id'],
      properties: { id: { type: 'integer', minimum: 1, maximum: 2147483647 } },
    },
  },
  {
    name: 'pivot_observable',
    description: 'Find alerts and incidents connected to an exact IP, username, or hostname.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['type', 'value'],
      properties: {
        type: { enum: ['ip', 'username', 'hostname'] },
        value: { type: 'string', minLength: 1, maxLength: 253 },
        hours: { type: 'integer', minimum: 1, maximum: 2160 },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
      },
    },
  },
  {
    name: 'get_identity_context',
    description: 'Get bounded Active Directory context for an exact username.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['username'],
      properties: { username: { type: 'string', minLength: 1, maxLength: 128 } },
    },
  },
  {
    name: 'check_logon_context',
    description: 'Check whether a user logon is anomalous using identity context.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['username', 'source_ip', 'timestamp'],
      properties: {
        username: { type: 'string', minLength: 1, maxLength: 128 },
        source_ip: { type: 'string', minLength: 1, maxLength: 64 },
        timestamp: { type: 'string', minLength: 10, maxLength: 64 },
      },
    },
  },
  {
    name: 'get_asset_context',
    description: 'Get bounded CMDB context by exact hostname or IP address.',
    parameters: {
      type: 'object', additionalProperties: false, minProperties: 1, maxProperties: 1,
      properties: {
        hostname: { type: 'string', minLength: 1, maxLength: 253 },
        ip: { type: 'string', minLength: 1, maxLength: 64 },
      },
    },
  },
  {
    name: 'get_edr_context',
    description: 'Get bounded recent EDR detections for an exact hostname.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['hostname'],
      properties: {
        hostname: { type: 'string', minLength: 1, maxLength: 253 },
        hours: { type: 'integer', minimum: 1, maximum: 168 },
      },
    },
  },
  {
    name: 'get_threat_intel',
    description: 'Look up a single IP, domain, or hash in the configured threat-intelligence service.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['indicator'],
      properties: { indicator: { type: 'string', minLength: 1, maxLength: 256 } },
    },
  },
  {
    name: 'get_vulnerability_context',
    description: 'Get bounded vulnerability risk for an exact hostname.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['hostname'],
      properties: { hostname: { type: 'string', minLength: 1, maxLength: 253 } },
    },
  },
];

const validators = new Map(TOOL_SPECS.map(spec => [spec.name, ajv.compile(spec.parameters)]));

function compactText(value, max = 1000) {
  const text = String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

function sanitize(value, depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return compactText(value);
  if (value instanceof Date) return value.toISOString();
  if (depth >= 6) return '[maximum depth reached]';
  if (Array.isArray(value)) return value.slice(0, 25).map(item => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      output[key] = DENIED_KEYS.test(key) ? '[redacted]' : sanitize(item, depth + 1);
    }
    return output;
  }
  return compactText(value);
}

function publicAlert(row) {
  return sanitize({
    id: String(row.id), timestamp: row.timestamp, source_system: row.source_system,
    source_index: row.source_index, elastic_alert_uuid: row.elastic_alert_uuid,
    rule_id: row.rule_id, rule_level: row.rule_level, description: row.rule_desc,
    severity: row.verdict?.severity || row.source_severity || 'unknown',
    risk_score: row.risk_score, workflow_status: row.workflow_status,
    reason: row.alert_reason, triage_status: row.triage_status,
    enrichment_status: row.enrichment_status, verdict: row.verdict,
    source_ip: row.src_ip, destination_ip: row.dst_ip, username: row.username,
    hostname: row.hostname, process: row.process, event_dataset: row.event_dataset,
    event_category: row.event_category, event_action: row.event_action,
    mitre_techniques: row.mitre_techniques, mitre_tactics: row.mitre_tactics,
    occurrence_count: row.occurrence_count, first_seen: row.first_seen, last_seen: row.last_seen,
  });
}

function evidence(type, id) {
  return id == null ? [] : [{ type, id: String(id) }];
}

function enrichmentBaseUrl() {
  return (process.env.ENRICHMENT_URL || 'http://enrichment:3001').replace(/\/$/, '');
}

function createSocToolkit({ database = db, fetchImpl = global.fetch, config = runtimeConfig() } = {}) {
  const selectAlert = `SELECT id,timestamp,source_system,source_index,elastic_alert_uuid,
    rule_id,rule_level,rule_desc,risk_score,source_severity,workflow_status,alert_reason,
    triage_status,enrichment_status,verdict,src_ip,dst_ip,username,hostname,process,
    event_dataset,event_category,event_action,mitre_techniques,mitre_tactics,
    occurrence_count,first_seen,last_seen FROM alerts`;

  async function fetchEnrichment(path, { method = 'GET', body, signal } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.hermesToolTimeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetchImpl(`${enrichmentBaseUrl()}${path}`, {
        method, signal: controller.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        if (response.status === 404) return { found: false, status: 404 };
        throw new HermesError('HERMES_TOOL_FAILED', `Enrichment service returned HTTP ${response.status}`, { status: 502 });
      }
      const text = await response.text();
      if (Buffer.byteLength(text) > config.hermesToolResultMaxBytes * 2) {
        throw new HermesError('HERMES_TOOL_RESULT_TOO_LARGE', 'Enrichment result exceeded the safety limit', { status: 502 });
      }
      return { found: true, data: JSON.parse(text) };
    } catch (error) {
      if (signal?.aborted) throw new HermesError('HERMES_CANCELLED', 'Hermes request was cancelled', { status: 499 });
      if (error?.name === 'AbortError') {
        throw new HermesError('HERMES_TOOL_TIMEOUT', 'SOC tool did not respond in time', { status: 504 });
      }
      if (error instanceof HermesError) throw error;
      throw new HermesError('HERMES_TOOL_FAILED', 'SOC enrichment tool failed', { status: 502, cause: error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  const handlers = {
    async get_soc_summary() {
      const [stats, incidents, runs] = await Promise.all([
        database.getAlertStats(),
        database.query('SELECT status,COUNT(*)::int AS count FROM incidents GROUP BY status ORDER BY status'),
        database.query(`SELECT id,trigger,mode,status,fetched,stored,duplicates,enriched,
          enrichment_failed,started_at,finished_at,duration_ms,error
          FROM fetch_runs ORDER BY id DESC LIMIT 5`),
      ]);
      return {
        data: { alerts: sanitize(stats), incidents: sanitize(incidents.rows), recent_collection_runs: sanitize(runs.rows) },
        evidence: runs.rows.flatMap(row => evidence('fetch_run', row.id)),
      };
    },

    async search_alerts(args) {
      const conditions = ['timestamp >= NOW() - ($1::int * interval \'1 hour\')'];
      const params = [args.hours || 24];
      const bind = value => { params.push(value); return `$${params.length}`; };
      if (args.query) {
        const pattern = `%${args.query}%`;
        conditions.push(`(id ILIKE ${bind(pattern)} OR rule_desc ILIKE ${bind(pattern)} OR alert_reason ILIKE ${bind(pattern)})`);
      }
      if (args.severity) conditions.push(`COALESCE(NULLIF(verdict->>'severity',''),source_severity,'unknown')=${bind(args.severity)}`);
      if (args.source_ip) conditions.push(`(src_ip=${bind(args.source_ip)} OR dst_ip=${bind(args.source_ip)})`);
      if (args.username) conditions.push(`LOWER(username)=LOWER(${bind(args.username)})`);
      if (args.hostname) conditions.push(`LOWER(hostname)=LOWER(${bind(args.hostname)})`);
      if (args.source_system) conditions.push(`source_system=${bind(args.source_system)}`);
      params.push(args.limit || 20);
      const result = await database.query(`${selectAlert} WHERE ${conditions.join(' AND ')}
        ORDER BY CASE COALESCE(NULLIF(verdict->>'severity',''),source_severity)
          WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
          risk_score DESC NULLS LAST,timestamp DESC LIMIT $${params.length}`, params);
      const alerts = result.rows.map(publicAlert);
      return { data: { count: alerts.length, alerts }, evidence: alerts.flatMap(row => evidence('alert', row.id)) };
    },

    async get_alert(args) {
      const result = await database.query(`${selectAlert} WHERE id=$1`, [args.id]);
      if (!result.rows.length) return { data: { found: false, id: args.id }, evidence: [] };
      return { data: { found: true, alert: publicAlert(result.rows[0]), raw_payload_omitted: true }, evidence: evidence('alert', args.id) };
    },

    async list_incidents(args) {
      const conditions = ['last_seen >= NOW() - ($1::int * interval \'1 hour\')'];
      const params = [args.hours || 720];
      if (args.status) { params.push(args.status); conditions.push(`status=$${params.length}`); }
      if (args.severity) { params.push(args.severity); conditions.push(`COALESCE(severity,'unknown')=$${params.length}`); }
      params.push(args.limit || 15);
      const result = await database.query(`SELECT id,title,severity,confidence,attack_stages,
        common_entities,array_length(alert_ids,1) AS alert_count,first_seen,last_seen,status,incident_type
        FROM incidents WHERE ${conditions.join(' AND ')} ORDER BY last_seen DESC LIMIT $${params.length}`, params);
      const incidents = sanitize(result.rows);
      return { data: { count: incidents.length, incidents }, evidence: incidents.flatMap(row => evidence('incident', row.id)) };
    },

    async get_incident(args) {
      const result = await database.query(`SELECT id,title,severity,confidence,attack_stages,common_entities,
        alert_ids,narrative,recommended_actions,first_seen,last_seen,status,incident_type
        FROM incidents WHERE id=$1`, [args.id]);
      if (!result.rows.length) return { data: { found: false, id: args.id }, evidence: [] };
      const incident = result.rows[0];
      const members = await database.query(`${selectAlert} WHERE id=ANY($1::text[]) ORDER BY timestamp DESC LIMIT 25`, [incident.alert_ids]);
      return {
        data: { found: true, incident: sanitize({ ...incident, alerts: members.rows.map(publicAlert) }) },
        evidence: [...evidence('incident', args.id), ...members.rows.flatMap(row => evidence('alert', row.id))],
      };
    },

    async pivot_observable(args) {
      const field = args.type === 'ip' ? '(src_ip=$2 OR dst_ip=$2)'
        : args.type === 'username' ? 'LOWER(username)=LOWER($2)' : 'LOWER(hostname)=LOWER($2)';
      const alertResult = await database.query(`${selectAlert}
        WHERE timestamp >= NOW() - ($1::int * interval '1 hour') AND ${field}
        ORDER BY timestamp DESC LIMIT $3`, [args.hours || 168, args.value, args.limit || 20]);
      const incidentResult = await database.query(`SELECT id,title,severity,status,first_seen,last_seen
        FROM incidents WHERE POSITION(LOWER($1) IN LOWER(common_entities::text)) > 0
        ORDER BY last_seen DESC LIMIT $2`, [args.value, args.limit || 20]);
      const alerts = alertResult.rows.map(publicAlert);
      const incidents = sanitize(incidentResult.rows);
      return {
        data: { observable: { type: args.type, value: args.value }, alerts, incidents },
        evidence: [
          ...evidence('observable', `${args.type}:${args.value}`),
          ...alerts.flatMap(row => evidence('alert', row.id)),
          ...incidents.flatMap(row => evidence('incident', row.id)),
        ],
      };
    },

    async get_identity_context(args, context) {
      const result = await fetchEnrichment(`/ad/users/${encodeURIComponent(args.username)}`, context);
      return { data: result, evidence: result.found ? evidence('identity', args.username) : [] };
    },

    async check_logon_context(args, context) {
      const result = await fetchEnrichment('/ad/logon-check', {
        ...context, method: 'POST', body: { sam: args.username, src_ip: args.source_ip, timestamp: args.timestamp },
      });
      return { data: result, evidence: result.found ? evidence('identity', args.username) : [] };
    },

    async get_asset_context(args, context) {
      const key = args.hostname || args.ip;
      const path = args.hostname ? `/cmdb/by-hostname/${encodeURIComponent(args.hostname)}` : `/cmdb/by-ip/${encodeURIComponent(args.ip)}`;
      const result = await fetchEnrichment(path, context);
      return { data: result, evidence: result.found ? evidence('asset', key) : [] };
    },

    async get_edr_context(args, context) {
      const result = await fetchEnrichment(`/edr/detections/${encodeURIComponent(args.hostname)}?hours=${args.hours || 48}`, context);
      return { data: result, evidence: result.found ? evidence('asset', args.hostname) : [] };
    },

    async get_threat_intel(args, context) {
      const result = await fetchEnrichment(`/tip/${encodeURIComponent(args.indicator)}`, context);
      return { data: result, evidence: result.found ? evidence('observable', args.indicator) : [] };
    },

    async get_vulnerability_context(args, context) {
      const result = await fetchEnrichment(`/vuln/${encodeURIComponent(args.hostname)}/risk`, context);
      return { data: result, evidence: result.found ? evidence('asset', args.hostname) : [] };
    },
  };

  function validateArguments(name, args) {
    const validator = validators.get(name);
    if (!validator) {
      throw new HermesError('HERMES_TOOL_DENIED', 'Hermes requested a tool that is not allowed', { status: 502, details: [name] });
    }
    if (!args || typeof args !== 'object' || Array.isArray(args) || !validator(args)) {
      throw new HermesError('HERMES_INVALID_TOOL_ARGUMENTS', 'Hermes returned invalid SOC tool arguments', {
        status: 502, details: validator?.errors?.map(item => `${item.instancePath || '/'} ${item.message}`).slice(0, 8),
      });
    }
    const invalidIp = (name === 'pivot_observable' && args.type === 'ip' && !isIP(args.value)) ||
      (name === 'check_logon_context' && !isIP(args.source_ip)) ||
      (name === 'get_asset_context' && args.ip && !isIP(args.ip));
    const invalidTimestamp = name === 'check_logon_context' && !Number.isFinite(Date.parse(args.timestamp));
    if (invalidIp || invalidTimestamp) {
      throw new HermesError('HERMES_INVALID_TOOL_ARGUMENTS', 'Hermes returned invalid SOC tool arguments', {
        status: 502, details: [invalidIp ? 'invalid IP address' : 'invalid timestamp'],
      });
    }
    return args;
  }

  async function execute(name, args, { signal, authorization } = {}) {
    if (authorization?.canReadSoc !== true) {
      throw new HermesError('HERMES_TOOL_UNAUTHORIZED', 'The actor is not authorized to read SOC evidence', { status: 403 });
    }
    validateArguments(name, args);
    if (signal?.aborted) throw new HermesError('HERMES_CANCELLED', 'Hermes request was cancelled', { status: 499 });
    const handler = handlers[name];
    const startedAt = Date.now();
    const result = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = callback => value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        callback(value);
      };
      const abort = () => finish(reject)(new HermesError(
        'HERMES_CANCELLED', 'Hermes request was cancelled', { status: 499 }
      ));
      const timer = setTimeout(() => finish(reject)(new HermesError(
        'HERMES_TOOL_TIMEOUT', 'SOC tool did not respond in time', { status: 504 }
      )), config.hermesToolTimeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(() => handler(args, { signal })).then(finish(resolve), finish(reject));
    });
    const cleanEvidence = (result.evidence || []).filter(item => item?.type && item?.id != null)
      .map(item => ({ type: item.type, id: compactText(item.id, 256) }));
    let cleanData = sanitize(result.data);
    let serialized = JSON.stringify({ data: cleanData, evidence: cleanEvidence });
    if (Buffer.byteLength(serialized) > config.hermesToolResultMaxBytes) {
      cleanData = {
        truncated: true,
        notice: 'The tool result was truncated by the BMB safety boundary.',
        preview: compactText(serialized, Math.floor(config.hermesToolResultMaxBytes / 2)),
      };
      serialized = JSON.stringify({ data: cleanData, evidence: cleanEvidence });
    }
    return {
      data: cleanData, evidence: cleanEvidence, serialized,
      latencyMs: Date.now() - startedAt, bytes: Buffer.byteLength(serialized),
    };
  }

  return { execute, specs: TOOL_SPECS, validateArguments };
}

module.exports = { TOOL_SPECS, compactText, createSocToolkit, publicAlert, sanitize };
