'use strict';

const fs = require('fs');
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

function readCaCertificate() {
  const caPath = process.env.ELASTIC_CA_CERT;

  if (!caPath) {
    throw new Error('ELASTIC_CA_CERT is not configured');
  }

  if (!fs.existsSync(caPath)) {
    throw new Error(
      `Elastic CA certificate not found: ${caPath}`
    );
  }

  return fs.readFileSync(caPath);
}

function requestJson(urlString, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(urlString);
    const payload = JSON.stringify(body);

    const request = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        ca: readCaCertificate(),
        rejectUnauthorized:
          process.env.ELASTIC_VERIFY_TLS !== 'false',
        timeout: 30000,
        headers: {
          Authorization:
            `ApiKey ${process.env.ELASTIC_API_KEY}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Content-Length': Buffer.byteLength(payload),
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
    request.end(payload);
  });
}

function normalizeAlert(hit, groupWindowMinutes = 5) {
  const fields = hit.fields || {};

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

    mitre_techniques: values(
      fields,
      'threat.technique.id'
    ).map(value => String(value).toUpperCase()),

    mitre_tactics: values(
      fields,
      'threat.tactic.name'
    ).map(normalizeTactic),

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

function validateConfiguration() {
  const required = [
    'ELASTICSEARCH_URL',
    'ELASTIC_API_KEY',
    'ELASTIC_CA_CERT',
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`${key} is not configured`);
    }
  }
}

async function searchAlerts({
  minutes = 1,
  minRiskScore = 48,
  limit = 20,
  statuses = ['open', 'acknowledged'],
  severities = ['high', 'critical'],
  excludeRules = [],
  groupWindowMinutes = 5,
} = {}) {
  validateConfiguration();

  const baseUrl =
    process.env.ELASTICSEARCH_URL.replace(/\/$/, '');

  const alias =
    process.env.ELASTIC_ALERT_ALIAS ||
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

      'file.name',
      'file.path',

      'database.name',

      'threat.tactic.id',
      'threat.tactic.name',
      'threat.technique.id',
      'threat.technique.name',
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
    body
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
} = {}) {
  validateConfiguration();

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
    process.env.ELASTICSEARCH_URL.replace(/\/$/, '');

  const alias =
    process.env.ELASTIC_ALERT_ALIAS ||
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
      body
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
async function fetchAlerts(options = {}) {
  const result = await searchAlerts(options);
  return result.alerts;
}

module.exports = {
  searchAlerts,
  searchAlertsCursor,
  fetchAlerts,
  normalizeAlert,
};
