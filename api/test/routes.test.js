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

test('Phase 7 action policy is explicit and forbidden containment fails before database access', async () => {
  db.query = async () => { throw new Error('database should not be queried'); };
  const policy = await request(routeApp()).get('/api/action-policy');
  assert.equal(policy.status, 200);
  assert.equal(policy.body.version, 'phase7-v1');
  assert.equal(policy.body.actions['case.update'].approvalRequired, true);
  assert.equal(policy.body.actions['case.add_note'].approvalRequired, false);
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

test('Phase 8 autonomous policy settings are bounded and remain explicitly opt-in', async () => {
  db.setSetting = async () => {};
  db.getAllSettings = async () => ({ autonomous_agent_enabled:'true' });
  const enabled = await request(routeApp()).put('/api/settings').send({
    autonomous_agent_enabled:'true', autonomous_lookback_hours:'24',
    autonomous_max_items:'20', autonomous_min_confidence:'0.75',
    autonomous_assignment_enabled:'true', autonomous_default_owner:'Tier 2 SOC',
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
