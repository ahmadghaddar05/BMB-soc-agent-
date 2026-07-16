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

function routeApp() {
  process.env.SOC_AUTH_DISABLED = 'true';
  return createApp();
}

test.afterEach(() => {
  db.query = originalQuery;
  db.getAllSettings = originalSettings;
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
