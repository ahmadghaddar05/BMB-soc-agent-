'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSocToolkit, sanitize } = require('../src/services/hermes/soc-tools');

const config = {
  hermesToolTimeoutMs: 1000,
  hermesToolResultMaxBytes: 65536,
};
const authorized = { authorization: { canReadSoc: true } };

test('alert search is bounded, parameterized, and includes untriaged collected alerts', async () => {
  const calls = [];
  const database = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [{
        id: 'elastic:manual-1', timestamp: new Date('2026-07-16T08:00:00Z'),
        source_system: 'elastic', rule_desc: 'Manual critical alert', source_severity: 'critical',
        risk_score: 99, triage_status: 'pending', enrichment_status: 'enriched', src_ip: '198.51.100.77',
      }] };
    },
  };
  const toolkit = createSocToolkit({ database, config });
  const result = await toolkit.execute('search_alerts', {
    query: 'Manual', severity: 'critical', source_ip: '198.51.100.77', hours: 24, limit: 10,
  }, authorized);
  assert.equal(result.data.alerts[0].id, 'elastic:manual-1');
  assert.equal(result.data.alerts[0].triage_status, 'pending');
  assert.deepEqual(result.evidence, [{ type: 'alert', id: 'elastic:manual-1' }]);
  assert.doesNotMatch(calls[0].sql, /triage_status\s*=/i);
  const placeholders = [...calls[0].sql.matchAll(/\$(\d+)/g)].map(match => Number(match[1]));
  assert.equal(Math.max(...placeholders), calls[0].params.length);
  assert.ok(calls[0].params.every(value => !String(value).includes('SELECT *')));
});

test('tool schemas reject unknown tools, extra arguments, and model-authored query controls', async () => {
  const toolkit = createSocToolkit({ database: {}, config });
  await assert.rejects(
    toolkit.execute('run_sql', { sql: 'SELECT * FROM alerts' }, authorized),
    error => error.code === 'HERMES_TOOL_DENIED'
  );
  await assert.rejects(
    toolkit.execute('get_alert', { id: 'A', sql: 'DROP TABLE alerts' }, authorized),
    error => error.code === 'HERMES_INVALID_TOOL_ARGUMENTS'
  );
  await assert.rejects(
    toolkit.execute('pivot_observable', { type: 'ip', value: 'not-an-ip' }, authorized),
    error => error.code === 'HERMES_INVALID_TOOL_ARGUMENTS'
  );
});

test('SOC tools require an explicit read authorization context', async () => {
  const toolkit = createSocToolkit({ database: {}, config });
  await assert.rejects(
    toolkit.execute('get_alert', { id: 'A' }),
    error => error.code === 'HERMES_TOOL_UNAUTHORIZED' && error.status === 403
  );
});

test('every tool execution has a hard timeout', async () => {
  const toolkit = createSocToolkit({
    database: { query: async () => new Promise(() => {}) },
    config: { ...config, hermesToolTimeoutMs: 10 },
  });
  await assert.rejects(
    toolkit.execute('get_alert', { id: 'A' }, authorized),
    error => error.code === 'HERMES_TOOL_TIMEOUT'
  );
});

test('tool result sanitization redacts secrets, raw logs, control characters, and excessive depth', () => {
  const cleaned = sanitize({
    password: 'secret', api_key: 'key', full_log: 'raw',
    message: 'safe\u0000 text', nested: { a: { b: { c: { d: { e: { f: 'too deep' } } } } } },
  });
  assert.equal(cleaned.password, '[redacted]');
  assert.equal(cleaned.api_key, '[redacted]');
  assert.equal(cleaned.full_log, '[redacted]');
  assert.equal(cleaned.message, 'safe text');
  assert.match(JSON.stringify(cleaned.nested), /maximum depth reached/);
});

test('enrichment tools use only fixed service paths and URL-encode model values', async () => {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    return new Response(JSON.stringify({ user: 'alice/admin' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  const toolkit = createSocToolkit({ database: {}, fetchImpl, config });
  const result = await toolkit.execute('get_identity_context', { username: 'alice/admin' }, authorized);
  assert.equal(urls[0], 'http://enrichment:3001/ad/users/alice%2Fadmin');
  assert.deepEqual(result.evidence, [{ type: 'identity', id: 'alice/admin' }]);
});

test('controlled action tool requires separate action permission and delegates only to the policy service', async () => {
  const submitted = [];
  const actionService = {
    async submit(input) {
      submitted.push(input);
      return { action_request: {
        id: '10000000-0000-4000-8000-000000000004', action_type: input.actionType,
        target_type: 'case', target_id: input.targetId, status: 'pending', approval_required: true,
        reason: input.reason,
      }, idempotent_replay: false };
    },
  };
  const toolkit = createSocToolkit({ database: {}, actionService, config });
  const args = {
    action_type: 'case.update', target_id: '7', parameters: { owner: 'Incident Lead' },
    reason: 'Assign the active incident',
  };
  await assert.rejects(
    toolkit.execute('request_soc_action', args, authorized),
    error => error.code === 'HERMES_TOOL_UNAUTHORIZED' && error.status === 403
  );
  const result = await toolkit.execute('request_soc_action', args, {
    authorization: { canRequestActions: true }, actor: 'admin', runId: 'run-7', requestId: 'req-7',
  });
  assert.equal(submitted.length, 1);
  assert.equal(result.data.action_request.status, 'pending');
  assert.equal(result.data.analyst_approval_required, true);
  assert.deepEqual(result.evidence, [{ type: 'action_request', id: '10000000-0000-4000-8000-000000000004' }]);
});

test('durable workflow tools expose bounded read-only investigation and case context', async () => {
  const calls = [];
  const database = {
    async query(sql, params) {
      calls.push({ sql:String(sql), params });
      if (String(sql).includes('FROM investigations i')) return { rows:[{
        id:'4f5f15c5-bf70-47d4-916b-a6fb870c208a', title:'Credential review', status:'open',
        owner:'SOC Analyst', evidence_count:2, note_count:1,
      }] };
      if (String(sql).includes('FROM incidents i')) return { rows:[{
        id:7, title:'Credential attack', status:'open', severity:'high', owner:'SOC Analyst', note_count:2,
      }] };
      return { rows:[] };
    },
  };
  const toolkit = createSocToolkit({ database, config });
  const investigations = await toolkit.execute('list_investigations', { status:'open', limit:5 }, authorized);
  const cases = await toolkit.execute('list_cases', { owner:'SOC Analyst', limit:5 }, authorized);
  assert.deepEqual(investigations.evidence, [{ type:'investigation', id:'4f5f15c5-bf70-47d4-916b-a6fb870c208a' }]);
  assert.deepEqual(cases.evidence, [{ type:'case', id:'7' }]);
  assert.ok(calls.every(call => !/\b(?:INSERT|UPDATE|DELETE)\b/i.test(call.sql)));
  assert.equal(calls[0].params.at(-1), 5);
  assert.equal(calls[1].params.at(-1), 5);
});
