'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://unused:test@localhost/unused';
process.env.SOC_AUTH_DISABLED = 'true';

const db = require('../src/db');
const { createApp } = require('../src');

const originalQuery = db.query;
const originalSettings = db.getAllSettings;
const originalSetSetting = db.setSetting;

function routeApp() {
  process.env.SOC_AUTH_DISABLED = 'true';
  return createApp();
}

test.afterEach(() => {
  db.query = originalQuery;
  db.getAllSettings = originalSettings;
  db.setSetting = originalSetSetting;
});

function highestPlaceholder(sql) {
  return Math.max(0, ...[...String(sql).matchAll(/\$(\d+)/g)].map(match => Number(match[1])));
}

test('individual alert search supplies every SQL placeholder', async () => {
  db.query = async (sql, params = []) => {
    assert.ok(highestPlaceholder(sql) <= params.length, `${highestPlaceholder(sql)} placeholders but ${params.length} parameters`);
    return String(sql).includes('COUNT(*) AS n') ? { rows:[{ n:'0' }] } : { rows:[] };
  };
  const response = await request(routeApp()).get('/api/alerts?search=needle&page=1&limit=20');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.alerts, []);
});

test('individual alerts filter on source severity and expose descriptive Elastic fields', async () => {
  let selectSql = '';
  const alert = {
    id:'elastic:1', source_severity:'critical', risk_score:94,
    alert_reason:'Credential dumping behavior detected',
    event_action:'credential-dump', event_category:['process'], event_dataset:'edr.endpoint',
  };
  db.query = async (sql, params = []) => {
    assert.ok(highestPlaceholder(sql) <= params.length);
    if (String(sql).includes('COUNT(*) AS n')) return { rows:[{ n:'1' }] };
    selectSql = String(sql);
    return { rows:[alert] };
  };

  const response = await request(routeApp()).get('/api/alerts?severity=critical&page=1&limit=20');
  assert.equal(response.status, 200);
  assert.match(selectSql, /COALESCE\(source_severity, verdict->>'severity'\)=\$1/);
  for (const field of ['source_severity','alert_reason','event_action','event_category','event_dataset']) {
    assert.match(selectSql, new RegExp(`\\b${field}\\b`));
    assert.deepEqual(response.body.alerts[0][field], alert[field]);
  }
});

test('grouped alerts expose specific titles and search technical and asset identifiers', async () => {
  let groupsSql = '';
  const group = {
    representative_alert_id:'elastic:1', group_key:'group-1', source_severity:'critical',
    alert_reason:'Credential dumping behavior detected', event_action:'credential-dump',
    event_category:['process'], event_dataset:'edr.endpoint', occurrence_count:2,
  };
  db.query = async (sql, params = []) => {
    assert.ok(highestPlaceholder(sql) <= params.length);
    if (String(sql).includes('COUNT(DISTINCT group_key)')) return { rows:[{ n:1 }] };
    groupsSql = String(sql);
    return { rows:[group] };
  };

  const response = await request(routeApp()).get('/api/alert-groups?page=1&limit=20&search=DB01');
  assert.equal(response.status, 200);
  for (const field of ['alert_reason','event_action','event_category','event_dataset']) {
    assert.ok((groupsSql.match(new RegExp(`\\b${field}\\b`, 'g')) || []).length >= 3);
    assert.deepEqual(response.body.groups[0][field], group[field]);
  }
  for (const field of ['id','group_key','agent_name','hostname','target_db','username']) {
    assert.match(groupsSql, new RegExp(`COALESCE\\(${field}|\\b${field} ILIKE`));
  }
});

test('identity pivots search alert evidence and incidents linked through matching alerts', async () => {
  let alertSql = '';
  let incidentSql = '';
  const alert = {
    id:'elastic:identity-1', timestamp:'2026-07-20T08:00:00.000Z',
    username:'maya.georges', hostname:'HR-WS001', event_action:'successful-login',
  };
  const incident = {
    id:17, title:'Coordinated identity activity', severity:'high', status:'open',
  };
  db.query = async (sql, params = []) => {
    const text = String(sql);
    assert.ok(highestPlaceholder(text) <= params.length);
    assert.deepEqual(params, ['%maya.georges%']);
    if (text.includes('SELECT id, timestamp')) {
      alertSql = text;
      return { rows:[alert] };
    }
    incidentSql = text;
    return { rows:[incident] };
  };

  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok:false });
  try {
    const response = await request(routeApp()).get('/api/pivot?indicator=maya.georges');
    assert.equal(response.status, 200);
    assert.equal(response.body.alert_count, 1);
    assert.equal(response.body.incident_count, 1);
    assert.deepEqual(response.body.alerts, [alert]);
    assert.deepEqual(response.body.incidents, [incident]);
  } finally {
    global.fetch = originalFetch;
  }

  for (const field of ['src_ip','dst_ip','username','hostname','agent_name','process','event_dataset','event_action','alert_reason','enrichment']) {
    assert.match(alertSql, new RegExp(`\\b${field}\\b`));
  }
  assert.match(incidentSql, /EXISTS\s*\(/);
  assert.match(incidentSql, /a\.username/);
  assert.match(incidentSql, /a\.hostname/);
  assert.match(incidentSql, /a\.target_db/);
});

test('executive overview returns an auditable aggregate contract with no fabricated containment', async () => {
  const incident = {
    id:42, title:'Coordinated identity compromise', severity:'critical', confidence:0.91,
    attack_stages:['credential_access'], common_entities:{ users:['maya.georges'] },
    alert_ids:['elastic:1','elastic:2'], narrative:'Correlated evidence across two systems.',
    recommended_actions:['Validate identity activity'], first_seen:'2026-07-19T10:00:00.000Z',
    last_seen:'2026-07-19T10:10:00.000Z', status:'open', owner:null,
    business_impact:'high', alert_count:2,
  };
  const asset = {
    name:'Customer Database', type:'database', activity_count:8,
    high_risk_activity_count:3, business_impact:'high', last_seen:'2026-07-19T10:10:00.000Z',
  };
  db.query = async (sql, params = []) => {
    const text = String(sql);
    assert.ok(highestPlaceholder(text) <= params.length);
    if (text.includes('executive_activity_summary')) return { rows:[{
      total:100, critical:5, high:10, medium:20, low:65,
      triage_pending:20, triaged:75,
    }] };
    if (text.includes('executive_business_risk_summary')) {
      return { rows:[{ total:5, critical:1, unassigned_high:1, high:2, medium:2, low:1 }] };
    }
    if (text.includes('executive_business_risk_items')) return { rows:[incident] };
    if (text.includes('executive_fetch_metrics')) return { rows:[{
      stored:100, triaged:75, incidents_created:2, investigations_created:3,
      investigation_notes_added:4, case_notes_added:5, approvals_requested:1,
      autonomous_failures:1,
    }] };
    if (text.includes('executive_risk_trend')) return { rows:[{
      day:'2026-07-19', activities:10, critical:1, high:2, medium:3, low:4,
      pending:2, incidents_created:1, critical_incidents:1, high_incidents:0,
      high_impact:1, medium_impact:0, low_impact:0,
    }] };
    if (text.includes('executive_top_assets')) return { rows:[asset] };
    if (text.includes('executive_workflow_controls')) return { rows:[{
      pending_approvals:2, failed_actions:1, executed_internal_actions:3,
    }] };
    if (text.includes('executive_source_coverage')) return { rows:[{
      activities:100, asset_mapped:80, enriched:75,
    }] };
    throw new Error(`Unexpected query: ${text}`);
  };

  const response = await request(routeApp()).get('/api/executive/overview');
  assert.equal(response.status, 200);
  assert.equal(response.body.window_days, 30);
  assert.match(response.body.generated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(response.body.health.score, 81);
  assert.equal(response.body.health.status, 'guarded');
  assert.equal(response.body.health.methodology.derived, true);
  assert.deepEqual(response.body.business_risks.by_impact, { critical:1, high:2, medium:2, low:1 });
  assert.equal(response.body.business_risks.items[0].title, incident.title);
  assert.equal(response.body.automation.triage_rate, 75);
  assert.equal(response.body.automation.primary_metric, 'ai_triage_coverage');
  assert.equal(response.body.automation.end_to_end_completion_supported, false);
  assert.equal(response.body.automation.autonomous_completion_rate, null);
  assert.match(response.body.automation.scope_note, /does not automatically close/);
  assert.equal(response.body.time_saved.minutes, 730);
  assert.equal(response.body.time_saved.hours, 12.2);
  assert.match(response.body.time_saved.methodology, /token usage is not treated as human time/);
  assert.equal(response.body.risk_trend[0].date, '2026-07-19');
  assert.equal(response.body.risk_trend[0].telemetry_sufficient, true);
  assert.equal(response.body.risk_trend[0].critical_incidents_created, 1);
  assert.equal(typeof response.body.risk_trend[0].risk_score, 'number');
  assert.deepEqual(response.body.top_assets, [asset]);
  assert.equal(response.body.executive_metrics.cyber_risk_exposure.value, 19);
  assert.equal(response.body.executive_metrics.critical_business_services_at_risk.available, false);
  assert.equal(response.body.executive_metrics.mean_time_to_respond.available, false);
  assert.equal(response.body.automation.pending_approvals, 2);
  assert.equal(response.body.automation.external_actions_supported, false);
  assert.equal(response.body.decision_queue.unassigned_high_impact_incidents, 1);
  assert.equal(response.body.source_coverage.asset_mapping_percent, 80);
});

test('durable automation operation details remain addressable by id', async () => {
  const operation = { id:42, operation_type:'add_case_note', source_type:'case', source_id:'7', status:'completed' };
  db.query = async (sql, params = []) => {
    assert.match(String(sql), /FROM autonomous_operations WHERE id=\$1/);
    assert.deepEqual(params, ['42']);
    return { rows:[operation] };
  };
  const response = await request(routeApp()).get('/api/agent/operations/42');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, operation);
});

test('executive overview only accepts documented windows and applies the selected window', async () => {
  db.query = async () => { throw new Error('database should not be queried'); };
  const invalid = await request(routeApp()).get('/api/executive/overview?days=14');
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error.message, /7, 30, or 90/);

  const parameterized = [];
  db.query = async (sql, params = []) => {
    assert.ok(highestPlaceholder(sql) <= params.length);
    if (highestPlaceholder(sql)) parameterized.push(params);
    return { rows:[] };
  };
  const valid = await request(routeApp()).get('/api/executive/overview?days=7');
  assert.equal(valid.status, 200);
  assert.equal(valid.body.window_days, 7);
  assert.equal(parameterized.length, 5);
  assert.ok(parameterized.every(params => params.length === 1 && params[0] === 7));
});

test('invalid pagination is rejected before querying the database', async () => {
  db.query = async () => { throw new Error('database should not be queried'); };
  const response = await request(routeApp()).get('/api/alerts?page=0&limit=1000');
  assert.equal(response.status, 400);
});

test('grouped alert filters reject invalid pagination and enums', async () => {
  db.query = async () => { throw new Error('database should not be queried'); };
  const badLimit = await request(routeApp()).get('/api/alert-groups?limit=101');
  assert.equal(badLimit.status, 400);
  const badSeverity = await request(routeApp()).get('/api/alert-groups?severity=urgent');
  assert.equal(badSeverity.status, 400);
});

test('chat validates message and history before calling an AI provider', async () => {
  const invalidMessage = await request(routeApp()).post('/api/chat').send({ message:'' });
  assert.equal(invalidMessage.status, 400);
  const invalidHistory = await request(routeApp()).post('/api/chat').send({ message:'hello', history:'not-an-array' });
  assert.equal(invalidHistory.status, 400);
  const invalidStream = await request(routeApp()).post('/api/chat/stream').send({ message:'', history:[] });
  assert.equal(invalidStream.status, 400);
});

test('chat stream fails closed before opening when Hermes is not configured', async () => {
  const previous = process.env.HERMES_API_KEY;
  delete process.env.HERMES_API_KEY;
  try {
    const response = await request(routeApp()).post('/api/chat/stream').send({ message:'Find alert A' });
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'HERMES_NOT_CONFIGURED');
  } finally {
    if (previous === undefined) delete process.env.HERMES_API_KEY;
    else process.env.HERMES_API_KEY = previous;
  }
});

test('chat fails closed when Hermes is not configured and never reads legacy settings', async () => {
  const previous = process.env.HERMES_API_KEY;
  delete process.env.HERMES_API_KEY;
  db.getAllSettings = async () => { throw new Error('legacy settings must not be read'); };
  try {
    const response = await request(routeApp()).post('/api/chat').send({ message:'What is critical?' });
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, 'HERMES_NOT_CONFIGURED');
  } finally {
    if (previous === undefined) delete process.env.HERMES_API_KEY;
    else process.env.HERMES_API_KEY = previous;
  }
});

test('missing retriage alert returns 404 without selecting another alert', async () => {
  const queries = [];
  db.getAllSettings = async () => ({});
  db.query = async sql => { queries.push(String(sql)); return { rows:[], rowCount:0 }; };
  const response = await request(routeApp()).post('/api/alerts/missing/retriage').send({});
  assert.equal(response.status, 404);
  assert.equal(queries.filter(sql => sql.includes('SELECT * FROM alerts')).length, 0);
});

test('retriage selection is scoped to the requested alert ID', async () => {
  const queries = [];
  db.getAllSettings = async () => ({});
  db.query = async (sql, params) => {
    queries.push({ sql:String(sql), params });
    if (String(sql).includes('SELECT id,enrichment_status')) {
      return { rows:[{ id:'alert-a', enrichment_status:'enriched' }], rowCount:1 };
    }
    if (String(sql).includes('UPDATE alerts')) return { rows:[{ id:'alert-a' }], rowCount:1 };
    if (String(sql).includes('SELECT * FROM alerts')) return { rows:[] };
    return { rows:[] };
  };
  const response = await request(routeApp()).post('/api/alerts/alert-a/retriage').send({});
  assert.equal(response.status, 200);
  const selection = queries.find(query => query.sql.includes('SELECT * FROM alerts'));
  assert.match(selection.sql, /AND id=\$1/);
  assert.equal(selection.params[0], 'alert-a');
});

test('retriage rejects failed enrichment before starting Hermes', async () => {
  db.getAllSettings = async () => ({});
  db.query = async sql => String(sql).includes('SELECT id,enrichment_status')
    ? { rows:[{ id:'alert-a', enrichment_status:'enrichment_failed' }], rowCount:1 }
    : { rows:[], rowCount:0 };
  const response = await request(routeApp()).post('/api/alerts/alert-a/retriage').send({});
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'HERMES_ENRICHMENT_REQUIRED');
});

test('manual Hermes correlation endpoint is available and bounded by the worker', async () => {
  db.getAllSettings = async () => ({ correlation_enabled:'false' });
  db.query = async () => ({ rows:[], rowCount:0 });
  const response = await request(routeApp()).post('/api/scheduler/correlate-now').send({});
  assert.equal(response.status, 200);
  assert.equal(response.body.skipped_reason, 'no_new_triaged_alerts');
});

test('Phase 9 action policy exposes only approval-gated simulations and rejects real containment', async () => {
  db.query = async () => { throw new Error('database should not be queried'); };
  const policy = await request(routeApp()).get('/api/action-policy');
  assert.equal(policy.status, 200);
  assert.equal(policy.body.version, 'phase9-v1');
  assert.equal(policy.body.actions['case.update'].approvalRequired, true);
  assert.equal(policy.body.actions['case.add_note'].approvalRequired, false);
  assert.equal(policy.body.actions['response.simulate'].approvalRequired, true);
  assert.equal(policy.body.actions['response.rollback'].approvalRequired, true);
  assert.equal(policy.body.actions['host.isolate'], undefined);

  const denied = await request(routeApp()).post('/api/actions').send({
    action_type:'host.isolate', target_id:'server-1', parameters:{}, reason:'Contain endpoint',
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'ACTION_FORBIDDEN');
});

test('action list rejects unsupported status and oversized pages before querying', async () => {
  db.query = async () => { throw new Error('database should not be queried'); };
  const badStatus = await request(routeApp()).get('/api/actions?status=approved_and_executed');
  const badLimit = await request(routeApp()).get('/api/actions?limit=101');
  assert.equal(badStatus.status, 400);
  assert.equal(badLimit.status, 400);
});

test('simulated response list rejects invalid state, type, and pagination before querying', async () => {
  db.query = async () => { throw new Error('database should not be queried'); };
  const badState = await request(routeApp()).get('/api/responses?state=executed');
  const badType = await request(routeApp()).get('/api/responses?response_type=real_isolation');
  const badLimit = await request(routeApp()).get('/api/responses?limit=101');
  assert.equal(badState.status, 400);
  assert.equal(badType.status, 400);
  assert.equal(badLimit.status, 400);
});

test('settings permit Hermes correlation but still reject automatic closure and singleton promotion', async () => {
  const autoClose = await request(routeApp()).put('/api/settings').send({ autoclose_enabled:'true' });
  assert.equal(autoClose.status, 400);
  db.setSetting = async () => {};
  db.getAllSettings = async () => ({ correlation_enabled:'true' });
  const correlation = await request(routeApp()).put('/api/settings').send({ correlation_enabled:'true' });
  assert.equal(correlation.status, 200);
  const promotion = await request(routeApp()).put('/api/settings').send({ incident_promote_enabled:'true' });
  assert.equal(promotion.status, 400);
});

test('Phase 9 autonomous and simulated-response policy settings remain explicitly opt-in', async () => {
  db.setSetting = async () => {};
  db.getAllSettings = async () => ({ autonomous_agent_enabled:'true' });
  const enabled = await request(routeApp()).put('/api/settings').send({
    autonomous_agent_enabled:'true', autonomous_lookback_hours:'24',
    autonomous_max_items:'20', autonomous_min_confidence:'0.75',
    autonomous_assignment_enabled:'true', autonomous_default_owner:'Tier 2 SOC',
    simulated_response_proposals_enabled:'true',
  });
  assert.equal(enabled.status, 200);
  const badConfidence = await request(routeApp()).put('/api/settings').send({ autonomous_min_confidence:'1.1' });
  const badOwner = await request(routeApp()).put('/api/settings').send({ autonomous_default_owner:'' });
  assert.equal(badConfidence.status, 400);
  assert.equal(badOwner.status, 400);
});

test('missing incident update returns 404', async () => {
  db.query = async () => ({ rows:[], rowCount:0 });
  const response = await request(routeApp()).patch('/api/incidents/999').send({ status:'closed' });
  assert.equal(response.status, 404);
});

test('unknown settings are rejected instead of silently ignored', async () => {
  const response = await request(routeApp()).put('/api/settings').send({ made_up_setting:'true' });
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /Unsupported settings/);
});
