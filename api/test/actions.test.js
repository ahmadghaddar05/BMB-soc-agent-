'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ActionError, createActionService, normalize } = require('../src/services/actions');

function databaseWith(handler) {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return handler(String(sql), params, calls);
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  };
  return { database: { connect: async () => client }, calls };
}

test('Phase 7 policy rejects external containment and validates allowlisted actions', () => {
  assert.throws(
    () => normalize('host.isolate', 'server-1', {}),
    error => error instanceof ActionError && error.code === 'ACTION_FORBIDDEN' && error.status === 403
  );
  const direct = normalize('investigation.add_note', '4f5f15c5-bf70-47d4-916b-a6fb870c208a', { body: ' Review evidence. ' });
  assert.equal(direct.policy.approvalRequired, false);
  assert.equal(direct.parameters.body, 'Review evidence.');
  const gated = normalize('case.update', '7', { owner: 'Incident Lead', status: 'open' });
  assert.equal(gated.policy.approvalRequired, true);
});

test('low-risk note action executes immediately and records an audit event', async () => {
  const action = {
    id: '10000000-0000-4000-8000-000000000001', action_type: 'investigation.add_note',
    target_type: 'investigation', target_id: '4f5f15c5-bf70-47d4-916b-a6fb870c208a',
    approval_required: false, status: 'pending', parameters: { body: 'Preserve this evidence.' },
  };
  const { database, calls } = databaseWith((sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.includes('INSERT INTO audit_events')) return { rows: [] };
    if (sql.includes('WHERE idempotency_key=')) return { rows: [] };
    if (sql.startsWith('SELECT 1 FROM investigations')) return { rows: [{ '?column?': 1 }] };
    if (sql.includes('INSERT INTO action_requests')) return { rows: [action] };
    if (sql.includes('INSERT INTO investigation_notes')) return { rows: [{ id: 12, body: action.parameters.body }] };
    if (sql.includes("SET status='executed'")) return { rows: [{ ...action, status: 'executed', result: { target_id: action.target_id } }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const service = createActionService(database);
  const result = await service.submit({
    actionType: action.action_type, targetId: action.target_id, parameters: action.parameters,
    reason: 'Document the grounded finding', actor: 'admin', requestId: 'req-1', idempotencyKey: 'note-1',
  });
  assert.equal(result.action_request.status, 'executed');
  assert.equal(result.result.record.id, 12);
  assert.ok(calls.some(call => call.sql.includes('INSERT INTO audit_events')));
  assert.ok(calls.some(call => call.sql === 'COMMIT'));
});

test('sensitive owner change remains pending until one explicit approval executes it', async () => {
  const pending = {
    id: '10000000-0000-4000-8000-000000000002', action_type: 'case.update', target_type: 'case',
    target_id: '7', approval_required: true, status: 'pending', parameters: { owner: 'Incident Lead' },
  };
  const { database, calls } = databaseWith((sql) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('INSERT INTO audit_events') || sql.includes('INSERT INTO action_approvals')) return { rows: [] };
    if (sql.includes('WHERE idempotency_key=')) return { rows: [] };
    if (sql.startsWith('SELECT 1 FROM incidents')) return { rows: [{ '?column?': 1 }] };
    if (sql.includes('INSERT INTO action_requests')) return { rows: [pending] };
    if (sql.includes('FOR UPDATE')) return { rows: [pending] };
    if (sql.includes("status='approved'")) return { rows: [] };
    if (sql.startsWith('UPDATE incidents SET owner=')) return { rows: [{ id: 7, owner: 'Incident Lead', status: 'open' }] };
    if (sql.includes("status='executed'")) return { rows: [{ ...pending, status: 'executed', executed_by: 'lead' }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const service = createActionService(database);
  const submitted = await service.submit({
    actionType: 'case.update', targetId: '7', parameters: { owner: 'Incident Lead' },
    reason: 'Assign an accountable owner', actor: 'admin', idempotencyKey: 'case-owner-7',
  });
  assert.equal(submitted.action_request.status, 'pending');
  assert.ok(!calls.some(call => call.sql.startsWith('UPDATE incidents SET owner=')));
  const decided = await service.decide({ id: pending.id, decision: 'approved', reason: 'Assignment confirmed', actor: 'lead' });
  assert.equal(decided.action_request.status, 'executed');
  assert.ok(calls.some(call => call.sql.includes('INSERT INTO action_approvals')));
  assert.equal(calls.filter(call => call.sql.startsWith('UPDATE incidents SET owner=')).length, 1);
});

test('idempotency returns the original request without executing it again', async () => {
  const existing = { id: '10000000-0000-4000-8000-000000000003', status: 'executed', action_type: 'case.add_note' };
  const { database, calls } = databaseWith(sql => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('WHERE idempotency_key=')) return { rows: [existing] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const result = await createActionService(database).submit({
    actionType: 'case.add_note', targetId: '7', parameters: { body: 'Known note' },
    reason: 'Preserve finding', actor: 'admin', idempotencyKey: 'same-request',
  });
  assert.equal(result.idempotent_replay, true);
  assert.equal(result.action_request.id, existing.id);
  assert.ok(!calls.some(call => call.sql.includes('INSERT INTO action_requests')));
});
