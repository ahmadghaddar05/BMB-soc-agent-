'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://unused:test@localhost/unused';
process.env.SOC_AUTH_DISABLED = 'false';
process.env.SOC_EXECUTIVE_USERNAME = 'ciso';
process.env.SOC_EXECUTIVE_PASSWORD = 'executive-horse-battery';
process.env.SOC_ANALYST_USERNAME = 'analyst';
process.env.SOC_ANALYST_PASSWORD = 'analyst-horse-battery';
process.env.SOC_ADMIN_USERNAME = 'admin';
process.env.SOC_ADMIN_PASSWORD = 'admin-horse-battery';
process.env.SOC_SESSION_SECRET = '0123456789abcdef0123456789abcdef';

const db = require('../src/db');
const { createApp } = require('../src');
const { sessionFor, signPayload, verifyPayload } = require('../src/middleware/auth');
const {
  bootstrapUserDirectory,
  hashPassword,
  verifyPassword,
} = require('../src/services/user-directory');

const originalQuery = db.query;
const originalConnect = db.connect;
let templates;
let state;

test.before(async () => {
  const definitions = [
    ['1', 'ciso', 'Executive User', 'executive', 'executive-horse-battery'],
    ['2', 'analyst', 'SOC Analyst', 'soc_analyst', 'analyst-horse-battery'],
    ['3', 'admin', 'Security Administrator', 'administrator', 'admin-horse-battery'],
  ];
  templates = await Promise.all(definitions.map(async ([id, username, displayName, role, password]) => ({
    id, username, display_name:displayName, role,
    password_hash:await hashPassword(password),
    active:true, session_version:1, created_by:'test', created_at:new Date().toISOString(),
    updated_at:new Date().toISOString(), last_login_at:null,
  })));
});

test.afterEach(() => {
  db.query = originalQuery;
  db.connect = originalConnect;
});

function rowsForDirectory() {
  return state.users.map(user => ({ ...user }));
}

function installDirectory() {
  state = { users:templates.map(user => ({ ...user })), audits:[], nextId:4 };

  async function execute(text, params = []) {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    if (sql.includes('FROM app_users WHERE LOWER(username)=LOWER($1)')) {
      const user = state.users.find(item => item.username.toLowerCase() === String(params[0]).toLowerCase());
      return { rows:user ? [{ ...user }] : [] };
    }
    if (sql.includes('FROM app_users WHERE id=$1 AND active=TRUE AND session_version=$2')) {
      const user = state.users.find(item =>
        String(item.id) === String(params[0]) && item.active && item.session_version === Number(params[1]));
      return { rows:user ? [{ ...user }] : [] };
    }
    if (sql.startsWith('UPDATE app_users SET last_login_at=NOW()')) {
      const user = state.users.find(item => String(item.id) === String(params[0]));
      if (user) user.last_login_at = new Date().toISOString();
      return { rows:[] };
    }
    if (sql.includes('COUNT(*)::int AS total') && sql.includes('COUNT(*) FILTER') && sql.includes('FROM app_users')) {
      const active = state.users.filter(user => user.active);
      return { rows:[{
        total:state.users.length,
        active:active.length,
        executives:active.filter(user => user.role === 'executive').length,
        analysts:active.filter(user => user.role === 'soc_analyst').length,
        administrators:active.filter(user => user.role === 'administrator').length,
      }] };
    }
    if (sql.startsWith('SELECT id,username,display_name,role,active,created_by') && sql.includes('ORDER BY active DESC')) {
      return { rows:rowsForDirectory() };
    }
    if (sql.startsWith('INSERT INTO app_users')) {
      const [username, displayName, role, passwordHash, createdBy] = params;
      if (state.users.some(user => user.username.toLowerCase() === username.toLowerCase())) {
        const error = new Error('duplicate');
        error.code = '23505';
        throw error;
      }
      const user = {
        id:String(state.nextId++), username, display_name:displayName, role, password_hash:passwordHash,
        active:true, session_version:1, created_by:createdBy,
        created_at:new Date().toISOString(), updated_at:new Date().toISOString(), last_login_at:null,
      };
      state.users.push(user);
      return { rows:[{ ...user }] };
    }
    if (sql.includes('FROM app_users WHERE id=$1 FOR UPDATE')) {
      const user = state.users.find(item => String(item.id) === String(params[0]));
      return { rows:user ? [{ ...user }] : [] };
    }
    if (sql.includes("WHERE role='administrator' AND active=TRUE")) {
      return { rows:[{ total:state.users.filter(user => user.role === 'administrator' && user.active).length }] };
    }
    if (sql.startsWith('DELETE FROM app_users WHERE id=$1')) {
      state.users = state.users.filter(user => String(user.id) !== String(params[0]));
      return { rows:[] };
    }
    if (sql.startsWith('INSERT INTO audit_events')) {
      state.audits.push(params);
      return { rows:[] };
    }
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows:[] };
    throw new Error(`Unexpected auth test query: ${sql}`);
  }

  db.query = execute;
  db.connect = async () => ({ query:execute, release() {} });
}

function authApp() {
  process.env.SOC_AUTH_DISABLED = 'false';
  process.env.SOC_SESSION_SECRET = '0123456789abcdef0123456789abcdef';
  installDirectory();
  return createApp();
}

async function login(app, username = 'admin', password = 'admin-horse-battery') {
  return request(app).post('/api/auth/login').send({ username, password });
}

test('signed session payload round-trips and rejects tampering', () => {
  const config = { sessionTtlMinutes:60 };
  const payload = sessionFor({ id:'2', session_version:3 }, config);
  const secret = process.env.SOC_SESSION_SECRET;
  const token = signPayload(payload, secret);
  assert.equal(verifyPayload(token, secret).sub, '2');
  assert.equal(verifyPayload(token, secret).sv, 3);
  assert.equal(verifyPayload(`${token}x`, secret), null);
});

test('one login endpoint creates an HttpOnly session and returns the database-assigned role', async () => {
  const app = authApp();
  const authenticated = await login(app);
  assert.equal(authenticated.status, 200);
  assert.equal(authenticated.body.user.username, 'admin');
  assert.equal(authenticated.body.user.role, 'administrator');
  assert.ok(authenticated.body.csrf);
  const cookie = authenticated.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const session = await request(app).get('/api/auth/session').set('Cookie', cookie);
  assert.equal(session.status, 200);
  assert.equal(session.body.user.role, 'administrator');
  assert.equal(session.body.user.display_name, 'Security Administrator');
});

test('each credential pair receives only its server-assigned role without a role choice', async () => {
  const app = authApp();
  const accounts = [
    ['ciso', 'executive-horse-battery', 'executive'],
    ['analyst', 'analyst-horse-battery', 'soc_analyst'],
    ['admin', 'admin-horse-battery', 'administrator'],
  ];
  for (const [username, password, role] of accounts) {
    const authenticated = await login(app, username, password);
    assert.equal(authenticated.status, 200);
    assert.equal(authenticated.body.user.role, role);
  }
});

test('a client-supplied role cannot change the role stored for an account', async () => {
  const app = authApp();
  const authenticated = await request(app).post('/api/auth/login').send({
    username:'ciso', password:'executive-horse-battery', portal_role:'administrator', role:'administrator',
  });
  assert.equal(authenticated.status, 200);
  assert.equal(authenticated.body.user.role, 'executive');
});

test('an empty directory imports bootstrap accounts once using password hashes', async () => {
  const calls = [];
  const client = {
    async query(text, params = []) {
      const sql = String(text);
      calls.push({ sql, params });
      if (sql.includes('SELECT COUNT(*)::int AS total FROM app_users')) return { rows:[{ total:0 }] };
      return { rows:[] };
    },
    release() {},
  };
  const config = {
    authDisabled:false,
    authAccounts:[{
      username:'bootstrap-admin',
      displayName:'Bootstrap Administrator',
      role:'administrator',
      password:'bootstrap-secure-password',
    }],
  };
  const result = await bootstrapUserDirectory(config, { info() {} }, { connect:async () => client });
  assert.equal(result.created, 1);
  const insert = calls.find(call => call.sql.includes('INSERT INTO app_users'));
  assert.ok(insert);
  assert.notEqual(insert.params[3], config.authAccounts[0].password);
  assert.equal(await verifyPassword(config.authAccounts[0].password, insert.params[3]), true);
});

test('invalid login and missing CSRF are rejected', async () => {
  const app = authApp();
  const unauthorized = await request(app).put('/api/settings').send({ scheduler_enabled:'false' });
  assert.equal(unauthorized.status, 401);

  const invalid = await login(app, 'admin', 'wrong-password');
  assert.equal(invalid.status, 401);

  const authenticated = await login(app);
  const forbidden = await request(app).put('/api/settings')
    .set('Cookie', authenticated.headers['set-cookie'][0])
    .send({ scheduler_enabled:'false' });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error.message, 'Invalid CSRF token');
});

test('logout requires a valid session CSRF token', async () => {
  const app = authApp();
  const authenticated = await login(app);
  const cookie = authenticated.headers['set-cookie'][0];
  const forbidden = await request(app).post('/api/auth/logout').set('Cookie', cookie).send({});
  assert.equal(forbidden.status, 403);
  const logout = await request(app).post('/api/auth/logout')
    .set('Cookie', cookie).set('X-CSRF-Token', authenticated.body.csrf).send({});
  assert.equal(logout.status, 200);
  assert.match(logout.headers['set-cookie'][0], /Max-Age=0/);
});

test('removing a database user invalidates its signed session immediately', async () => {
  const app = authApp();
  const authenticated = await login(app, 'analyst', 'analyst-horse-battery');
  const cookie = authenticated.headers['set-cookie'][0];
  state.users = state.users.filter(user => user.username !== 'analyst');
  const session = await request(app).get('/api/auth/session').set('Cookie', cookie);
  assert.equal(session.status, 401);
});

test('administrator can create a role-bound user and that user signs in through the same endpoint', async () => {
  const app = authApp();
  const administrator = await login(app);
  const created = await request(app).post('/api/admin/users')
    .set('Cookie', administrator.headers['set-cookie'][0])
    .set('X-CSRF-Token', administrator.body.csrf)
    .send({
      display_name:'Maya Georges',
      username:'maya.georges',
      role:'soc_analyst',
      password:'maya-secure-password',
    });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.role, 'soc_analyst');
  assert.equal(created.body.user.password_hash, undefined);

  const userLogin = await login(app, 'maya.georges', 'maya-secure-password');
  assert.equal(userLogin.status, 200);
  assert.equal(userLogin.body.user.role, 'soc_analyst');
});

test('administrator can remove another user but cannot remove the current account', async () => {
  const app = authApp();
  const administrator = await login(app);
  const cookie = administrator.headers['set-cookie'][0];
  const headers = request(app).delete('/api/admin/users/2')
    .set('Cookie', cookie).set('X-CSRF-Token', administrator.body.csrf);
  const removed = await headers;
  assert.equal(removed.status, 200);
  assert.equal(state.users.some(user => user.id === '2'), false);
  assert.ok(state.audits.length > 0);

  const self = await request(app).delete('/api/admin/users/3')
    .set('Cookie', cookie).set('X-CSRF-Token', administrator.body.csrf);
  assert.equal(self.status, 409);
  assert.match(self.body.error.message, /own account/i);
});

test('executive sessions are read-only across protected SOC workflows', async () => {
  const app = authApp();
  const authenticated = await login(app, 'ciso', 'executive-horse-battery');
  const cookie = authenticated.headers['set-cookie'][0];
  const protectedRequests = [
    request(app).put('/api/settings').send({ scheduler_enabled:'false' }),
    request(app).patch('/api/incidents/7').send({ status:'closed' }),
    request(app).post('/api/investigations').send({ title:'Denied', alert_ids:['alert-1'] }),
    request(app).post('/api/actions/00000000-0000-0000-0000-000000000001/decision').send({ decision:'approved', reason:'Denied' }),
    request(app).post('/api/responses/00000000-0000-0000-0000-000000000001/rollback').send({}),
    request(app).get('/api/admin/runtime'),
    request(app).get('/api/settings'),
    request(app).get('/api/alerts'),
    request(app).get('/api/incidents'),
    request(app).get('/api/incidents/7'),
    request(app).get('/api/investigations'),
    request(app).get('/api/actions'),
    request(app).get('/api/responses'),
    request(app).get('/api/runs'),
    request(app).get('/api/reports/incidents?detailed=true'),
  ];

  for (const pending of protectedRequests) {
    const response = await pending.set('Cookie', cookie).set('X-CSRF-Token', authenticated.body.csrf);
    assert.equal(response.status, 403);
    assert.match(JSON.stringify(response.body), /role cannot (perform|access)/i);
  }
});

test('SOC analyst sessions can read operational policy but not administration data', async () => {
  const app = authApp();
  const authenticated = await login(app, 'analyst', 'analyst-horse-battery');
  const cookie = authenticated.headers['set-cookie'][0];

  const operational = await request(app).get('/api/action-policy').set('Cookie', cookie);
  assert.equal(operational.status, 200);

  for (const path of [
    '/api/settings', '/api/scheduler/status', '/api/runs',
    '/api/admin/runtime', '/api/admin/users', '/api/admin/ai-models',
  ]) {
    const response = await request(app).get(path).set('Cookie', cookie);
    assert.equal(response.status, 403);
    assert.match(JSON.stringify(response.body), /role cannot access/i);
  }
});
