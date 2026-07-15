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

function authApp() {
  process.env.SOC_AUTH_DISABLED = 'false';
  process.env.SOC_ADMIN_USERNAME = 'analyst';
  process.env.SOC_ADMIN_PASSWORD = 'correct-horse-battery';
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
