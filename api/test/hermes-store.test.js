'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentStore } = require('../src/services/hermes/store');

test('durable chat start creates the run before its foreign-keyed user message', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      const text = String(sql);
      queries.push(text);
      if (text.includes('INSERT INTO agent_conversations')) {
        return { rows:[{ id:'11111111-1111-4111-8111-111111111111' }], rowCount:1 };
      }
      if (text.includes('SELECT role, content')) return { rows:[], rowCount:0 };
      return { rows:[], rowCount:1 };
    },
    release() {},
  };
  const store = createAgentStore({ connect:async () => client });
  const started = await store.beginChat({
    actor: 'analyst', question: 'What matters?', requestId: 'request-1',
    promptVersion: 'prompt-v1', schemaVersion: 'schema-v1',
  });
  assert.equal(started.conversationId, '11111111-1111-4111-8111-111111111111');
  assert.ok(queries.indexOf('BEGIN') < queries.findIndex(sql => sql.includes('INSERT INTO agent_runs')));
  assert.ok(queries.findIndex(sql => sql.includes('INSERT INTO agent_runs')) <
    queries.findIndex(sql => sql.includes('INSERT INTO agent_messages')));
  assert.equal(queries.at(-1), 'COMMIT');
});

test('durable conversations are scoped to the authenticated actor', async () => {
  const client = {
    async query(sql) {
      if (String(sql).includes('SELECT id FROM agent_conversations')) return { rows:[], rowCount:0 };
      return { rows:[], rowCount:1 };
    },
    release() {},
  };
  const store = createAgentStore({ connect:async () => client });
  await assert.rejects(store.beginChat({
    conversationId: '11111111-1111-4111-8111-111111111111', actor: 'different-analyst',
    question: 'Continue', requestId: 'request-2', promptVersion: 'v1', schemaVersion: 'v1',
  }), error => error.code === 'CONVERSATION_NOT_FOUND');
});

test('durable triage start records the alert input and audit event atomically', async () => {
  const queries = [];
  const client = {
    async query(sql, params) { queries.push({ sql:String(sql), params }); return { rows:[], rowCount:1 }; },
    release() {},
  };
  const store = createAgentStore({ async connect() { return client; } });
  const started = await store.beginTriage({
    alertId:'alert-A', actor:'scheduler', requestId:'request-triage',
    promptVersion:'prompt-v1', schemaVersion:'schema-v1', mode:'pipeline',
    signature:'sig', cacheKey:'cache',
  });
  assert.match(started.runId, /^[0-9a-f-]{36}$/);
  assert.ok(queries.some(call => call.sql.includes("'triage','running'")));
  assert.ok(queries.some(call => call.sql.includes("'alert',$2,'input'")));
  assert.ok(queries.some(call => call.sql.includes("'agent.run.started'")));
  assert.equal(queries[0].sql, 'BEGIN');
  assert.equal(queries.at(-1).sql, 'COMMIT');
});

test('durable correlation start records every candidate alert atomically', async () => {
  const queries = [];
  const client = {
    async query(sql, params) { queries.push({ sql:String(sql), params }); return { rows:[], rowCount:1 }; },
    release() {},
  };
  const store = createAgentStore({ async connect() { return client; } });
  const started = await store.beginCorrelation({
    alertIds:['A','B'], actor:'scheduler', requestId:'request-correlation',
    promptVersion:'prompt-v1', schemaVersion:'schema-v1', settingsSummary:{ entity_window_hours:6 },
  });
  assert.match(started.runId, /^[0-9a-f-]{36}$/);
  assert.ok(queries.some(call => call.sql.includes("'correlation','running'")));
  assert.equal(queries.filter(call => call.sql.includes("'alert',$2,'input'")).length, 2);
  assert.ok(queries.some(call => call.sql.includes("'agent.run.started'")));
  assert.equal(queries[0].sql, 'BEGIN');
  assert.equal(queries.at(-1).sql, 'COMMIT');
});

test('completed correlation links output incidents and usage to its Hermes run atomically', async () => {
  const queries = [];
  const client = {
    async query(sql, params) { queries.push({ sql:String(sql), params }); return { rows:[], rowCount:1 }; },
    release() {},
  };
  const store = createAgentStore({ async connect() { return client; } });
  await store.completeCorrelation({
    runId:'11111111-1111-4111-8111-111111111111', actor:'scheduler', requestId:'request-complete',
    output:{ incidents:[{ alert_ids:['A','B'] }] }, incidentIds:[17],
    persistence:{ created:1, updated:0, unchanged:0 },
    hermes:{
      model:'hermes-agent', runId:'hermes-17', capabilities:{ safe:true },
      usage:{ prompt_tokens:20, completion_tokens:10, total_tokens:30 }, attempts:1, latencyMs:8,
    },
  });
  assert.ok(queries.some(call => call.sql.includes("status='completed'")));
  assert.ok(queries.some(call => call.sql.includes("'incident',$2,'output'") && call.params[1] === '17'));
  assert.ok(queries.some(call => call.sql.includes("'agent.run.completed'")));
  assert.equal(queries[0].sql, 'BEGIN');
  assert.equal(queries.at(-1).sql, 'COMMIT');
});

test('grounded tool completion persists a bounded summary, evidence links, and an audit event atomically', async () => {
  const queries = [];
  const client = {
    async query(sql, params) { queries.push({ sql:String(sql), params }); return { rows:[], rowCount:1 }; },
    release() {},
  };
  const database = {
    async query(sql, params) {
      queries.push({ sql:String(sql), params });
      if (String(sql).includes('INSERT INTO agent_tool_calls')) return { rows:[{ id:7 }], rowCount:1 };
      return { rows:[], rowCount:1 };
    },
    async connect() { return client; },
  };
  const store = createAgentStore(database);
  const toolCallId = await store.beginToolCall({
    runId:'11111111-1111-4111-8111-111111111111', hermesRunId:'hermes-step-1',
    toolName:'get_alert', arguments:{ id:'A' },
  });
  await store.completeToolCall({
    toolCallId, runId:'11111111-1111-4111-8111-111111111111', actor:'analyst',
    requestId:'request-3', toolName:'get_alert',
    result:{ bytes:100, latencyMs:4, data:{ found:true } },
    evidence:[{ type:'alert', id:'A' }],
  });
  assert.equal(toolCallId, 7);
  assert.ok(queries.some(call => call.sql.includes("status='completed'")));
  assert.ok(queries.some(call => call.sql.includes('INSERT INTO agent_evidence_links')));
  assert.ok(queries.some(call => call.sql.includes("'agent.tool.completed'")));
  assert.ok(queries.findIndex(call => call.sql === 'BEGIN') < queries.findIndex(call => call.sql === 'COMMIT'));
});

test('failed Hermes sub-runs remain independently queryable', async () => {
  const calls = [];
  const store = createAgentStore({
    async query(sql, params) { calls.push({ sql:String(sql), params }); return { rows:[], rowCount:1 }; },
  });
  await store.recordHermesStepFailure({
    runId:'11111111-1111-4111-8111-111111111111', stepNumber:2,
    hermesRunId:'hermes-failed-2', error:{ code:'HERMES_INVALID_OUTPUT', attempts:1, latencyMs:8 },
  });
  assert.match(calls[0].sql, /INSERT INTO agent_run_steps/);
  assert.equal(calls[0].params[2], 'hermes-failed-2');
  assert.equal(calls[0].params.at(-1), '{"error_code":"HERMES_INVALID_OUTPUT"}');
});
