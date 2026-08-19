'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const {
  buildGroupKey,
} = require('./grouping');

function first(fields, name) {
  const value = fields?.[name];

  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : null;
  }

  return value ?? null;
}

function values(fields, name) {
  const value = fields?.[name];

  if (value === null || value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function normalizeTactic(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
}

const TACTIC_NAMES_BY_ID = {
  TA0043:'Reconnaissance', TA0001:'Initial Access', TA0002:'Execution',
  TA0003:'Persistence', TA0004:'Privilege Escalation', TA0006:'Credential Access',
  TA0007:'Discovery', TA0008:'Lateral Movement', TA0009:'Collection',
  TA0011:'Command and Control', TA0010:'Exfiltration', TA0040:'Impact',
};

function uniqueFieldValues(fields, names) {
  return [...new Set(names.flatMap(name => values(fields, name))
    .map(value => String(value).trim()).filter(Boolean))];
}

/*
 * The current dashboard still expects the old rule_level field.
 * This temporary mapping keeps the existing interface working:
 *
 * low      → 4
 * medium   → 8
 * high     → 12
 * critical → 15
 */
function severityToLegacyLevel(severity) {
  const levels = {
    low: 4,
    medium: 8,
    high: 12,
    critical: 15,
  };

  return levels[String(severity || '').toLowerCase()] || 0;
}

function connectionConfig(connection = null) {
  return connection || {
    url:process.env.ELASTICSEARCH_URL || '',
    apiKey:process.env.ELASTIC_API_KEY || '',
    alertAlias:process.env.ELASTIC_ALERT_ALIAS || '.alerts-security.alerts-default',
    eventIndices:process.env.ELASTIC_EVENT_INDICES || 'logs-*',
    verifyTls:process.env.ELASTIC_VERIFY_TLS !== 'false',
    caCert:process.env.ELASTIC_CA_CERT || '',
  };
}

function readCaCertificate(config) {
  const caPath = config.caCert;
  const verifyTls = config.verifyTls;

  if (!verifyTls) return undefined;

  if (!caPath) return undefined;

  if (caPath.includes('BEGIN CERTIFICATE')) return caPath;

  if (!fs.existsSync(caPath)) {
    throw new Error(
      `Elastic CA certificate not found: ${caPath}`
    );
  }

  return fs.readFileSync(caPath);
}

function requestJson(urlString, body, { method = 'POST', connection = null } = {}) {
  return new Promise((resolve, reject) => {
    const config = connectionConfig(connection);
    const target = new URL(urlString);
    const client = target.protocol === 'https:' ? https : http;
    const payload = body == null ? '' : JSON.stringify(body);
    const ca = target.protocol === 'https:' ? readCaCertificate(config) : undefined;

    const request = client.request(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method,
        ...(target.protocol === 'https:' && ca ? { ca } : {}),
        ...(target.protocol === 'https:' ? {
          rejectUnauthorized: config.verifyTls,
        } : {}),
        timeout: 30000,
        headers: {
          Authorization:
            `ApiKey ${config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      response => {
        let responseBody = '';

        response.setEncoding('utf8');

        response.on('data', chunk => {
          responseBody += chunk;
        });

        response.on('end', () => {
          let parsed;

          try {
            parsed = responseBody
              ? JSON.parse(responseBody)
              : {};
          } catch {
            reject(
              new Error(
                `Elastic returned invalid JSON: ` +
                responseBody.slice(0, 500)
              )
            );
            return;
          }

          if (
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            reject(
              new Error(
                `Elastic HTTP ${response.statusCode}: ` +
                JSON.stringify(parsed).slice(0, 700)
              )
            );
            return;
          }

          resolve(parsed);
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(
        new Error('Elastic request timed out')
      );
    });

    request.on('error', reject);
    request.end(payload || undefined);
  });
}

function normalizeAlert(hit, groupWindowMinutes = 5) {
  const fields = hit.fields || {};

  const mitreTechniques = uniqueFieldValues(fields, [
    'threat.technique.id',
    'kibana.alert.rule.threat.technique.id',
  ]).map(value => value.toUpperCase());
  const tacticIds = uniqueFieldValues(fields, [
    'threat.tactic.id',
    'kibana.alert.rule.threat.tactic.id',
  ]).map(value => value.toUpperCase());
  const tacticNames = uniqueFieldValues(fields, [
    'threat.tactic.name',
    'kibana.alert.rule.threat.tactic.name',
  ]);
  const mitreTactics = [...new Set([
    ...tacticNames,
    ...tacticIds.map(id => TACTIC_NAMES_BY_ID[id]).filter(Boolean),
  ].map(normalizeTactic))];

  const timestamp =
    first(fields, '@timestamp') ||
    new Date().toISOString();

  const severity = String(
    first(fields, 'kibana.alert.severity') ||
    'low'
  ).toLowerCase();

  const elasticUuid =
    first(fields, 'kibana.alert.uuid') ||
    hit._id;

  const ruleName =
    first(fields, 'kibana.alert.rule.name') ||
    'Elastic Security alert';

  const reason =
    first(fields, 'kibana.alert.reason') ||
    ruleName;

  const hostname =
    first(fields, 'host.name') ||
    first(fields, 'agent.name');

  const processName =
    first(fields, 'process.name') ||
    first(fields, 'process.executable');

  const normalized = {
    id: `elastic:${elasticUuid}`,

    timestamp,

    rule_id: String(
      first(fields, 'kibana.alert.rule.rule_id') ||
      first(fields, 'kibana.alert.rule.uuid') ||
      ''
    ),

    rule_level: severityToLegacyLevel(severity),
    rule_desc: ruleName,

    rule_groups: values(
      fields,
      'kibana.alert.rule.tags'
    ).map(String),

    decoder:
      first(fields, 'event.dataset'),

    agent_id:
      first(fields, 'agent.id'),

    agent_name:
      first(fields, 'agent.name'),

    full_log:
      first(fields, 'message') ||
      first(fields, 'event.original') ||
      reason,

    src_ip:
      first(fields, 'source.ip'),

    dst_ip:
      first(fields, 'destination.ip'),

    username:
      first(fields, 'user.name'),

    hostname,

    process: processName,

    target_db:
      first(fields, 'database.name'),

    mitre_techniques: mitreTechniques,

    mitre_tactics: mitreTactics,

    source_system: 'elastic',
    source_index: hit._index,
    elastic_alert_uuid: elasticUuid,

    risk_score:
      Number(
        first(fields, 'kibana.alert.risk_score')
      ) || 0,

    source_severity: severity,

    workflow_status:
      first(
        fields,
        'kibana.alert.workflow_status'
      ),

    alert_reason: reason,

    event_dataset:
      first(fields, 'event.dataset'),

    event_category: values(
      fields,
      'event.category'
    ).map(String),

    event_action:
      first(fields, 'event.action'),

    occurrence_count: 1,
    first_seen: timestamp,
    last_seen: timestamp,

    raw: {
      elastic_index: hit._index,
      elastic_document_id: hit._id,
      fields,
    },
  };

  normalized.group_key = buildGroupKey(
    normalized,
    groupWindowMinutes
  );

  return normalized;
}

function validateConfiguration(connection = null) {
  const config = connectionConfig(connection);
  if (!config.url) throw new Error('ELASTICSEARCH_URL is not configured');
  if (!config.apiKey) throw new Error('ELASTIC_API_KEY is not configured');
  return config;
}

async function checkHealth(connection = null) {
  const config = validateConfiguration(connection);
  const baseUrl = config.url.replace(/\/$/, '');
  const started = Date.now();
  const response = await requestJson(`${baseUrl}/`, null, { method: 'GET', connection:config });
  return {
    status: 'online', configured: true, reachable: true,
    latency_ms: Date.now() - started,
    cluster_name: response.cluster_name || null,
    version: response.version?.number || null,
  };
}

async function searchAlerts({
  minutes = 1,
  minRiskScore = 48,
  limit = 20,
  statuses = ['open', 'acknowledged'],
  severities = ['high', 'critical'],
  excludeRules = [],
  groupWindowMinutes = 5,
} = {}, connection = null) {
  const config = validateConfiguration(connection);

  const baseUrl =
    config.url.replace(/\/$/, '');

  const alias =
    config.alertAlias ||
    '.alerts-security.alerts-default';

  if (!/^[A-Za-z0-9._*-]+$/.test(alias)) {
    throw new Error(
      'ELASTIC_ALERT_ALIAS contains invalid characters'
    );
  }

  const mustNot = [
    {
      exists: {
        field: 'kibana.alert.building_block_type',
      },
    },
  ];

  if (excludeRules.length > 0) {
    mustNot.push({
      terms: {
        'kibana.alert.rule.name': excludeRules,
      },
    });
  }

  const body = {
    size: Math.min(
      Math.max(Number(limit) || 1, 1),
      200
    ),

    track_total_hits: true,
    _source: false,

    sort: [
      {
        '@timestamp': {
          order: 'desc',
        },
      },
    ],

    fields: [
      '@timestamp',
      'message',
      'event.original',
      'event.dataset',
      'event.category',
      'event.action',

      'kibana.alert.uuid',
      'kibana.alert.rule.rule_id',
      'kibana.alert.rule.uuid',
      'kibana.alert.rule.name',
      'kibana.alert.rule.tags',
      'kibana.alert.reason',
      'kibana.alert.severity',
      'kibana.alert.risk_score',
      'kibana.alert.workflow_status',

      'agent.id',
      'agent.name',
      'host.name',
      'host.ip',

      'source.ip',
      'source.port',
      'destination.ip',
      'destination.port',

      'user.name',

      'process.name',
      'process.executable',
      'process.command_line',
      'process.args',
      'process.working_directory',
      'process.entity_id',
      'process.pid',
      'process.hash.sha256',
      'process.code_signature.trusted',
      'process.code_signature.subject_name',
      'process.parent.name',
      'process.parent.executable',
      'process.parent.command_line',
      'process.parent.args',
      'process.parent.entity_id',
      'process.parent.pid',
      'process.parent.hash.sha256',

      'file.name',
      'file.path',
      'file.size',
      'file.mime_type',
      'file.hash.sha256',
      'file.code_signature.trusted',
      'file.code_signature.subject_name',

      'network.direction',
      'network.transport',
      'network.protocol',
      'dns.question.name',
      'dns.resolved_ip',
      'url.domain',
      'url.path',
      'url.original',

      'database.name',
      'database.operation',
      'database.query',
      'database.query_id',
      'database.transaction_id',
      'database.duration_ms',
      'database.rows_affected',
      'database.schema',
      'database.table',

      'authentication.type',
      'authentication.result',
      'authentication.logon_type',
      'authentication.mfa',
      'authentication.session_id',
      'authentication.failure_reason',

      'winlog.event_id',
      'winlog.event_data.TargetUserName',
      'winlog.event_data.IpAddress',
      'winlog.event_data.WorkstationName',
      'winlog.event_data.LogonType',
      'winlog.event_data.AuthenticationPackageName',
      'winlog.event_data.FailureReason',
      'winlog.event_data.Status',
      'winlog.event_data.SubStatus',

      'email.subject',
      'email.message_id',
      'email.direction',
      'email.delivery_action',
      'email.from.address',
      'email.to.address',
      'email.security.spf',
      'email.security.dkim',
      'email.security.dmarc',
      'email.security.reputation',
      'email.sandbox.status',
      'email.sandbox.verdict',
      'email.sandbox.score',
      'email.sandbox.observed_behaviors',

      'http.request.method',
      'http.request.bytes',
      'http.response.status_code',
      'http.response.bytes',
      'url.original',
      'url.query',
      'user_agent.original',
      'session.id',
      'network.transport',
      'network.protocol',
      'network.direction',

      'evidence.profile',
      'evidence.provenance',
      'evidence.answer_key_included',
      'evidence.assessment_basis',
      'evidence.context_completeness',
      'evidence.observed_context',

      'attack.campaign_id',
      'attack.stage',
      'attack.stage_order',
      'attack.tactic',
      'attack.tactic_id',
      'attack.tactic_name',
      'attack.technique_id',
      'attack.technique_name',
      'attack.observed_state',
      'correlation.session_id',
      'correlation.sequence',
      'correlation.join_keys',
      'correlation.path_position',
      'correlation.path_length',
      'security_control.status',
      'security_control.action',
      'security_control.observed',

      'policy.id',
      'policy.category',
      'policy.violation',
      'policy.authorized',
      'policy.security_alert',
      'policy.disposition',
      'policy.reason',
      'change.id',
      'change.approved',

      'threat.tactic.id',
      'threat.tactic.name',
      'threat.technique.id',
      'threat.technique.name',
      'kibana.alert.rule.threat.tactic.id',
      'kibana.alert.rule.threat.tactic.name',
      'kibana.alert.rule.threat.technique.id',
      'kibana.alert.rule.threat.technique.name',
    ],

    query: {
      bool: {
        filter: [
          {
            range: {
              '@timestamp': {
                gte: `now-${Number(minutes)}m`,
                lte: 'now',
              },
            },
          },
          {
            range: {
              'kibana.alert.risk_score': {
                gte: Number(minRiskScore),
              },
            },
          },
          {
            terms: {
              'kibana.alert.workflow_status':
                statuses,
            },
          },
          {
            terms: {
              'kibana.alert.severity':
                severities,
            },
          },
        ],

        must_not: mustNot,
      },
    },
  };

  const data = await requestJson(
    `${baseUrl}/${alias}/_search`,
    body,
    { connection:config }
  );

  const alerts = (
    data.hits?.hits || []
  ).map(hit =>
    normalizeAlert(
      hit,
      groupWindowMinutes
    )
  );

  const totalValue = data.hits?.total;

  const total =
    typeof totalValue === 'object'
      ? totalValue.value
      : totalValue ?? alerts.length;

  return {
    alerts,
    total,
    took: data.took ?? null,
  };
}


function validateCursor(cursor) {
  if (
    !Array.isArray(cursor) ||
    cursor.length !== 2 ||
    typeof cursor[0] !== 'string' ||
    typeof cursor[1] !== 'string' ||
    !cursor[0] ||
    !cursor[1]
  ) {
    throw new Error(
      'Elastic cursor must be [timestamp, alert UUID]'
    );
  }

  return cursor;
}

/*
 * Cursor-based, read-only Elastic fetch.
 *
 * Alerts are sorted from oldest to newest. Each page continues
 * after the final alert from the previous page using search_after.
 *
 * This function does not save the cursor and does not write to
 * PostgreSQL or Elastic.
 */
async function searchAlertsCursor({
  cursor,
  minRiskScore = 48,
  pageSize = 20,
  maxPages = 5,
  delaySeconds = 15,
  statuses = ['open', 'acknowledged'],
  severities = ['high', 'critical'],
  excludeRules = [],
  groupWindowMinutes = 5,
} = {}, connection = null) {
  const config = validateConfiguration(connection);

  const safeCursor = validateCursor(cursor);

  const safePageSize = Math.min(
    Math.max(Number(pageSize) || 20, 1),
    200
  );

  const safeMaxPages = Math.min(
    Math.max(Number(maxPages) || 1, 1),
    100
  );

  const safeDelaySeconds = Math.min(
    Math.max(Number(delaySeconds) || 0, 0),
    3600
  );

  /*
   * Freeze the upper time boundary for the entire pagination run.
   * Alerts newer than this boundary wait for the next cycle.
   */
  const upperBound = new Date(
    Date.now() - safeDelaySeconds * 1000
  ).toISOString();

  const baseUrl =
    config.url.replace(/\/$/, '');

  const alias =
    config.alertAlias ||
    '.alerts-security.alerts-default';

  if (!/^[A-Za-z0-9._*-]+$/.test(alias)) {
    throw new Error(
      'ELASTIC_ALERT_ALIAS contains invalid characters'
    );
  }

  const mustNot = [
    {
      exists: {
        field: 'kibana.alert.building_block_type',
      },
    },
  ];

  if (excludeRules.length > 0) {
    mustNot.push({
      terms: {
        'kibana.alert.rule.name': excludeRules,
      },
    });
  }

  const fields = [
    '@timestamp',
    'message',
    'event.original',
    'event.dataset',
    'event.category',
    'event.action',

    'kibana.alert.uuid',
    'kibana.alert.rule.rule_id',
    'kibana.alert.rule.uuid',
    'kibana.alert.rule.name',
    'kibana.alert.rule.tags',
    'kibana.alert.reason',
    'kibana.alert.severity',
    'kibana.alert.risk_score',
    'kibana.alert.workflow_status',

    'agent.id',
    'agent.name',
    'host.name',
    'host.ip',

    'source.ip',
    'source.port',
    'destination.ip',
    'destination.port',

    'user.name',

    'process.name',
    'process.executable',

    'file.name',
    'file.path',

    'database.name',

    'threat.tactic.id',
    'threat.tactic.name',
    'threat.technique.id',
    'threat.technique.name',
    'kibana.alert.rule.threat.tactic.id',
    'kibana.alert.rule.threat.tactic.name',
    'kibana.alert.rule.threat.technique.id',
    'kibana.alert.rule.threat.technique.name',

    'attack.campaign_id',
    'attack.stage',
    'attack.stage_order',
    'attack.tactic',
    'attack.tactic_id',
    'attack.tactic_name',
    'attack.technique_id',
    'attack.technique_name',
    'attack.observed_state',
    'correlation.session_id',
    'correlation.sequence',
    'correlation.join_keys',
    'correlation.path_position',
    'correlation.path_length',
    'security_control.status',
    'security_control.action',
    'security_control.observed',
  ];

  const collectedHits = [];

  let searchAfter = [...safeCursor];
  let pages = 0;
  let total = 0;
  let totalTook = 0;

  for (
    let pageNumber = 0;
    pageNumber < safeMaxPages;
    pageNumber += 1
  ) {
    const body = {
      size: safePageSize,
      track_total_hits: true,
      _source: false,

      sort: [
        {
          '@timestamp': {
            order: 'asc',
            format: 'strict_date_optional_time_nanos',
          },
        },
        {
          'kibana.alert.uuid': {
            order: 'asc',
            unmapped_type: 'keyword',
          },
        },
      ],

      search_after: searchAfter,
      fields,

      query: {
        bool: {
          filter: [
            {
              range: {
                '@timestamp': {
                  gte: safeCursor[0],
                  lte: upperBound,
                },
              },
            },
            {
              range: {
                'kibana.alert.risk_score': {
                  gte: Number(minRiskScore),
                },
              },
            },
            {
              terms: {
                'kibana.alert.workflow_status':
                  statuses,
              },
            },
            {
              terms: {
                'kibana.alert.severity':
                  severities,
              },
            },
          ],

          must_not: mustNot,
        },
      },
    };

    const data = await requestJson(
      `${baseUrl}/${alias}/_search`,
      body,
      { connection:config }
    );

    const hits = data.hits?.hits || [];

    if (pageNumber === 0) {
      const totalValue = data.hits?.total;

      total =
        typeof totalValue === 'object'
          ? totalValue.value
          : totalValue ?? hits.length;
    }

    totalTook += Number(data.took) || 0;

    if (!hits.length) {
      break;
    }

    collectedHits.push(...hits);
    pages += 1;

    const finalHit = hits[hits.length - 1];
    const nextCursor = finalHit.sort;

    if (
      !Array.isArray(nextCursor) ||
      nextCursor.length !== 2
    ) {
      throw new Error(
        'Elastic did not return a valid cursor'
      );
    }

    if (
      JSON.stringify(nextCursor) ===
      JSON.stringify(searchAfter)
    ) {
      throw new Error(
        'Elastic cursor did not advance'
      );
    }

    searchAfter = nextCursor;

    if (hits.length < safePageSize) {
      break;
    }
  }

  const alerts = collectedHits.map(hit =>
    normalizeAlert(
      hit,
      groupWindowMinutes
    )
  );

  return {
    alerts,
    pages,
    total,
    took: totalTook,
    previousCursor: safeCursor,
    nextCursor:
      alerts.length > 0
        ? searchAfter
        : safeCursor,
    upperBound,
  };
}

/*
 * This function matches the interface expected by pipeline.js.
 * We will activate it only after the independent test succeeds.
 */
async function fetchAlerts(options = {}, connection = null) {
  const result = await searchAlerts(options, connection);
  return result.alerts;
}

const RAW_EVENT_FIELDS = [
  '@timestamp', 'message', 'event.id', 'event.kind', 'event.dataset',
  'event.category', 'event.type', 'event.action', 'event.outcome', 'event.severity',
  'user.name', 'host.name', 'agent.name', 'source.ip', 'destination.ip',
  'process.name', 'process.executable', 'process.command_line', 'process.entity_id',
  'process.args', 'process.working_directory', 'process.pid', 'process.hash.sha256',
  'process.code_signature.trusted', 'process.code_signature.subject_name',
  'process.parent.name', 'process.parent.executable', 'process.parent.command_line',
  'process.parent.args', 'process.parent.entity_id', 'process.parent.pid',
  'process.parent.hash.sha256', 'file.name', 'file.path', 'file.size',
  'file.mime_type', 'file.hash.sha256', 'file.code_signature.trusted',
  'file.code_signature.subject_name', 'dns.question.name', 'dns.resolved_ip',
  'url.domain', 'url.path', 'url.original', 'url.query', 'database.name',
  'database.operation', 'database.query', 'database.query_id', 'database.transaction_id',
  'database.duration_ms', 'database.rows_affected', 'database.schema', 'database.table',
  'authentication.type', 'authentication.result', 'authentication.logon_type',
  'authentication.mfa', 'authentication.session_id', 'authentication.failure_reason',
  'email.subject', 'email.message_id', 'email.direction', 'email.delivery_action',
  'email.from.address', 'email.to.address', 'email.security.spf', 'email.security.dkim',
  'email.security.dmarc', 'email.security.reputation', 'email.sandbox.status',
  'email.sandbox.verdict', 'email.sandbox.score', 'email.sandbox.observed_behaviors',
  'http.request.method', 'http.request.bytes', 'http.response.status_code',
  'http.response.bytes', 'user_agent.original', 'session.id', 'network.transport',
  'network.protocol', 'network.direction', 'evidence.profile', 'evidence.provenance',
  'evidence.answer_key_included', 'evidence.assessment_basis',
  'evidence.context_completeness', 'evidence.observed_context',
  'correlation.session_id', 'correlation.sequence', 'correlation.join_keys',
  'policy.id', 'policy.domain', 'policy.category', 'policy.violation',
  'policy.authorized', 'policy.security_alert', 'policy.disposition', 'policy.reason',
  'change.id', 'change.approved', 'attack.campaign_id', 'attack.stage',
  'attack.stage_order', 'attack.tactic', 'attack.tactic_id', 'attack.tactic_name',
  'attack.technique_id', 'attack.technique_name', 'attack.observed_state',
  'threat.tactic.id', 'threat.tactic.name', 'threat.technique.id', 'threat.technique.name',
  'security_control.status', 'security_control.action', 'security_control.observed',
  'correlation.path_position', 'correlation.path_length',
];

function normalizeRawEvent(hit) {
  const fields = hit.fields || {};
  return {
    id: `${hit._index}:${hit._id}`,
    timestamp: first(fields, '@timestamp'),
    source_index: hit._index,
    document_id: hit._id,
    event_id: first(fields, 'event.id'),
    kind: first(fields, 'event.kind'),
    dataset: first(fields, 'event.dataset'),
    categories: values(fields, 'event.category').map(String),
    types: values(fields, 'event.type').map(String),
    action: first(fields, 'event.action'),
    outcome: first(fields, 'event.outcome'),
    severity: first(fields, 'event.severity'),
    username: first(fields, 'user.name'),
    hostname: first(fields, 'host.name') || first(fields, 'agent.name'),
    source_ip: first(fields, 'source.ip'),
    destination_ip: first(fields, 'destination.ip'),
    process: {
      name: first(fields, 'process.name'),
      executable: first(fields, 'process.executable'),
      command_line: first(fields, 'process.command_line'),
    },
    url: {
      domain: first(fields, 'url.domain'),
      path: first(fields, 'url.path'),
    },
    database: first(fields, 'database.name'),
    policy: {
      id: first(fields, 'policy.id'),
      domain: first(fields, 'policy.domain'),
      category: first(fields, 'policy.category'),
      violation: first(fields, 'policy.violation'),
      authorized: first(fields, 'policy.authorized'),
      security_alert: first(fields, 'policy.security_alert'),
      disposition: first(fields, 'policy.disposition'),
      reason: first(fields, 'policy.reason'),
    },
    change: {
      id: first(fields, 'change.id'),
      approved: first(fields, 'change.approved'),
    },
    campaign: {
      id: first(fields, 'attack.campaign_id'),
      stage: first(fields, 'attack.stage'),
      tactic: first(fields, 'attack.tactic'),
      tactic_id: first(fields, 'attack.tactic_id') || first(fields, 'threat.tactic.id'),
      tactic_name: first(fields, 'attack.tactic_name') || first(fields, 'threat.tactic.name'),
      technique_id: first(fields, 'attack.technique_id') || first(fields, 'threat.technique.id'),
      technique_name: first(fields, 'attack.technique_name') || first(fields, 'threat.technique.name'),
      observed_state: first(fields, 'attack.observed_state'),
    },
    security_control: {
      status: first(fields, 'security_control.status'),
      action: first(fields, 'security_control.action'),
      observed: first(fields, 'security_control.observed'),
    },
    message: first(fields, 'message'),
  };
}

async function searchEvents(options = {}, { request = requestJson, connection = null } = {}) {
  const config = validateConfiguration(connection);
  const baseUrl = config.url.replace(/\/$/, '');
  const indices = config.eventIndices || 'logs-*';
  if (!/^[A-Za-z0-9._,*-]{1,300}$/.test(indices)) {
    throw new Error('ELASTIC_EVENT_INDICES contains invalid characters');
  }

  const hours = Math.min(Math.max(Number(options.hours) || 24, 1), 168);
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 25);
  const filters = [{ range: { '@timestamp': { gte: `now-${hours}h`, lte: 'now' } } }];
  const term = (field, value) => {
    if (value !== undefined && value !== null && value !== '') filters.push({ term: { [field]: value } });
  };
  term('event.dataset', options.dataset);
  term('event.action', options.action);
  term('user.name', options.username);
  term('host.name', options.hostname);
  term('process.name', options.process);
  term('url.domain', options.url_domain);
  term('policy.violation', options.policy_violation);
  if (options.source_ip) {
    filters.push({ bool: { should: [
      { term: { 'source.ip': options.source_ip } },
      { term: { 'client.ip': options.source_ip } },
    ], minimum_should_match: 1 } });
  }

  const data = await request(
    `${baseUrl}/${indices}/_search?ignore_unavailable=true&allow_no_indices=true`,
    {
      size: limit,
      track_total_hits: false,
      _source: false,
      sort: [{ '@timestamp': { order: 'desc', unmapped_type: 'date' } }],
      fields: RAW_EVENT_FIELDS,
      query: { bool: { filter: filters } },
    },
    { connection:config }
  );
  return (data.hits?.hits || []).map(normalizeRawEvent);
}

module.exports = {
  searchAlerts,
  searchAlertsCursor,
  searchEvents,
  fetchAlerts,
  normalizeAlert,
  normalizeRawEvent,
  checkHealth,
  connectionConfig,
  validateConfiguration,
};
