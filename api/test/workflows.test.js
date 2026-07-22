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

function app() {
  process.env.SOC_AUTH_DISABLED = 'true';
  return createApp();
}

test.afterEach(() => { db.query = originalQuery; });

test('investigation creation validates evidence before querying', async () => {
  db.query = async () => { throw new Error('database should not be queried'); };
  const response = await request(app()).post('/api/investigations').send({ title:'Test', alert_ids:[] });
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /alert_ids/);
});

test('investigation creation stores unique evidence and authenticated actor', async () => {
  let captured;
  db.query = async (sql, params) => {
    captured = { sql:String(sql), params };
    return { rows:[{
      id:'4f5f15c5-bf70-47d4-916b-a6fb870c208a', title:'Credential review',
      search_query:'maya', status:'open', owner:'development', created_by:'development',
      alert_ids:['alert-1'], note_count:0,
    }], rowCount:1 };
  };
  const response = await request(app()).post('/api/investigations').send({
    title:' Credential review ', search_query:' maya ', alert_ids:['alert-1','alert-1'],
  });
  assert.equal(response.status, 201);
  assert.deepEqual(captured.params.slice(0, 4), ['Credential review','maya',['alert-1'],'development']);
  assert.match(captured.sql, /investigation\.created/);
  assert.deepEqual(response.body.notes, []);
});

test('missing investigation update and delete return 404', async () => {
  db.query = async () => ({ rows:[], rowCount:0 });
  const update = await request(app()).patch('/api/investigations/4f5f15c5-bf70-47d4-916b-a6fb870c208a').send({ owner:'Analyst' });
  const remove = await request(app()).delete('/api/investigations/4f5f15c5-bf70-47d4-916b-a6fb870c208a');
  assert.equal(update.status, 404);
  assert.equal(remove.status, 404);
});

test('case updates are bounded to owner and supported status', async () => {
  db.query = async () => { throw new Error('database should not be queried'); };
  const empty = await request(app()).patch('/api/cases/7').send({ title:'Not allowed' });
  const badStatus = await request(app()).patch('/api/cases/7').send({ status:'contained' });
  assert.equal(empty.status, 400);
  assert.equal(badStatus.status, 400);
});

test('case note is append-only and records the actor in the audit CTE', async () => {
  let captured;
  db.query = async (sql, params) => {
    captured = { sql:String(sql), params };
    return { rows:[{ id:11, incident_id:7, body:'Validate account activity', author:'development' }], rowCount:1 };
  };
  const response = await request(app()).post('/api/cases/7/notes').send({ body:' Validate account activity ' });
  assert.equal(response.status, 201);
  assert.deepEqual(captured.params.slice(0, 3), ['7','Validate account activity','development']);
  assert.match(captured.sql, /case\.note_added/);
});

test('workflow list pagination is rejected before database access', async () => {
  db.query = async () => { throw new Error('database should not be queried'); };
  const investigations = await request(app()).get('/api/investigations?limit=101');
  const cases = await request(app()).get('/api/cases?page=0');
  assert.equal(investigations.status, 400);
  assert.equal(cases.status, 400);
});
