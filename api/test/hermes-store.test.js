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
