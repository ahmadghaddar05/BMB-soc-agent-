'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://unused:test@localhost/unused';
process.env.SOC_AUTH_DISABLED = 'false';
process.env.SOC_ADMIN_USERNAME = 'analyst';
process.env.SOC_ADMIN_PASSWORD = 'correct-horse-battery';
process.env.SOC_SESSION_SECRET = '0123456789abcdef0123456789abcdef';

const { createApp } = require('../src');
const { sessionFor, signPayload, verifyPayload } = require('../src/middleware/auth');

function authApp(role = 'administrator') {
  process.env.SOC_AUTH_DISABLED = 'false';
  process.env.SOC_ADMIN_USERNAME = 'analyst';
  process.env.SOC_ADMIN_PASSWORD = 'correct-horse-battery';
  process.env.SOC_USER_ROLE = role;
  process.env.SOC_SESSION_SECRET = '0123456789abcdef0123456789abcdef';
  return createApp();
}

test('signed session payload round-trips and rejects tampering', () => {
  const config = { sessionTtlMinutes: 60 };
  const payload = sessionFor('analyst', config);
  const secret = process.env.SOC_SESSION_SECRET;
  const token = signPayload(payload, secret);
  assert.equal(verifyPayload(token, secret).sub, 'analyst');
  assert.equal(verifyPayload(`${token}x`, secret), null);
});

test('login creates an HttpOnly session and session endpoint returns CSRF token', async () => {
  const app = authApp();
  const login = await request(app).post('/api/auth/login').send({ username:'analyst', password:'correct-horse-battery' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.username, 'analyst');
  assert.ok(login.body.csrf);
  const cookie = login.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const session = await request(app).get('/api/auth/session').set('Cookie', cookie);
  assert.equal(session.status, 200);
  assert.equal(session.body.user.role, 'administrator');
});

test('login session uses the configured production role', async () => {
  const app = authApp('executive');
  const login = await request(app).post('/api/auth/login').send({ username:'analyst', password:'correct-horse-battery' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'executive');
  const session = await request(app).get('/api/auth/session').set('Cookie', login.headers['set-cookie'][0]);
  assert.equal(session.status, 200);
  assert.equal(session.body.user.role, 'executive');
});

test('invalid login and missing CSRF are rejected', async () => {
  const app = authApp();
  const unauthorized = await request(app).put('/api/settings').send({ scheduler_enabled:'false' });
  assert.equal(unauthorized.status, 401);

  const invalid = await request(app).post('/api/auth/login').send({ username:'analyst', password:'wrong' });
  assert.equal(invalid.status, 401);

  const login = await request(app).post('/api/auth/login').send({ username:'analyst', password:'correct-horse-battery' });
  const forbidden = await request(app).put('/api/settings').set('Cookie', login.headers['set-cookie'][0]).send({ scheduler_enabled:'false' });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error.message, 'Invalid CSRF token');
});

test('logout requires a valid session CSRF token', async () => {
  const app = authApp();
  const login = await request(app).post('/api/auth/login').send({ username:'analyst', password:'correct-horse-battery' });
  const cookie = login.headers['set-cookie'][0];
  const forbidden = await request(app).post('/api/auth/logout').set('Cookie', cookie).send({});
  assert.equal(forbidden.status, 403);
  const logout = await request(app).post('/api/auth/logout')
    .set('Cookie', cookie).set('X-CSRF-Token', login.body.csrf).send({});
  assert.equal(logout.status, 200);
  assert.match(logout.headers['set-cookie'][0], /Max-Age=0/);
});

test('executive sessions are read-only across protected SOC workflows', async () => {
  const app = authApp('executive');
  const login = await request(app).post('/api/auth/login')
    .send({ username:'analyst', password:'correct-horse-battery' });
  const cookie = login.headers['set-cookie'][0];
  const protectedRequests = [
    request(app).put('/api/settings').send({ scheduler_enabled:'false' }),
    request(app).patch('/api/incidents/7').send({ status:'closed' }),
    request(app).post('/api/investigations').send({ title:'Denied', alert_ids:['alert-1'] }),
    request(app).post('/api/actions/00000000-0000-0000-0000-000000000001/decision').send({ decision:'approved', reason:'Denied' }),
    request(app).post('/api/responses/00000000-0000-0000-0000-000000000001/rollback').send({}),
    request(app).get('/api/admin/runtime'),
    request(app).get('/api/settings'),
    request(app).get('/api/alerts'),
    request(app).get('/api/investigations'),
    request(app).get('/api/actions'),
    request(app).get('/api/responses'),
    request(app).get('/api/runs'),
    request(app).get('/api/reports/incidents?detailed=true'),
  ];

  for (const pending of protectedRequests) {
    const response = await pending.set('Cookie', cookie).set('X-CSRF-Token', login.body.csrf);
    assert.equal(response.status, 403);
    assert.match(JSON.stringify(response.body), /role cannot (perform|access)/i);
  }
});

test('SOC analyst sessions can read operational policy but not administration data', async () => {
  const app = authApp('soc_analyst');
  const login = await request(app).post('/api/auth/login')
    .send({ username:'analyst', password:'correct-horse-battery' });
  const cookie = login.headers['set-cookie'][0];

  const operational = await request(app).get('/api/action-policy').set('Cookie', cookie);
  assert.equal(operational.status, 200);

  for (const path of ['/api/settings', '/api/scheduler/status', '/api/runs', '/api/admin/runtime']) {
    const response = await request(app).get(path).set('Cookie', cookie);
    assert.equal(response.status, 403);
    assert.match(JSON.stringify(response.body), /role cannot access/i);
  }
});
