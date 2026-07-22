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

test('Phase 9 policy rejects real containment and approval-gates response simulations', () => {
  assert.throws(
    () => normalize('host.isolate', 'server-1', {}),
    error => error instanceof ActionError && error.code === 'ACTION_FORBIDDEN' && error.status === 403
  );
  const direct = normalize('investigation.add_note', '4f5f15c5-bf70-47d4-916b-a6fb870c208a', { body: ' Review evidence. ' });
  assert.equal(direct.policy.approvalRequired, false);
  assert.equal(direct.parameters.body, 'Review evidence.');
  const gated = normalize('case.update', '7', { owner: 'Incident Lead', status: 'open' });
  assert.equal(gated.policy.approvalRequired, true);
  const simulated = normalize('response.simulate', 'server-1', {
    response_type:'endpoint_isolate', evidence_alert_ids:['alert-a'],
  });
  assert.equal(simulated.policy.approvalRequired, true);
  assert.deepEqual(simulated.parameters.evidence_alert_ids, ['alert-a']);
  assert.throws(() => normalize('response.simulate', 'not-an-ip', {
    response_type:'ip_block', evidence_alert_ids:['alert-a'],
  }), error => error.code === 'ACTION_INVALID');
});

test('simulated response activates only after approval, verifies, and rolls back through a second approval', async () => {
  const responseId = '20000000-0000-4000-8000-000000000001';
  const requests = new Map();
  let active = false;
  const { database, calls } = databaseWith((sql, params) => {
    if (['BEGIN','COMMIT','ROLLBACK'].includes(sql) || sql.includes('INSERT INTO audit_events') ||
        sql.includes('INSERT INTO action_approvals') || sql.includes('INSERT INTO simulated_response_events')) return { rows:[] };
    if (sql.includes('SELECT * FROM action_requests WHERE idempotency_key=')) return { rows:[] };
    if (sql.includes("FROM action_requests WHERE action_type='response.simulate'") ||
        sql.includes("FROM action_requests WHERE action_type='response.rollback'")) return { rows:[] };
    if (sql.includes('FROM simulated_response_states') && sql.includes("state='active'") && sql.startsWith('SELECT 1')) {
      return { rows:active ? [{ ok:1 }] : [] };
    }
    if (sql.includes('WITH supplied AS') && sql.includes('AS matched')) {
      return { rows:[{ supplied:2, valid:2, matched:1 }] };
    }
    if (sql.includes('SELECT id,response_type,target_value,state FROM simulated_response_states')) {
      return { rows:[{ id:responseId, response_type:'endpoint_isolate', target_value:'server-1', state:'active' }] };
    }
    if (sql.includes('INSERT INTO action_requests')) {
      const request = {
        id:params[1] === 'response.rollback' ? '10000000-0000-4000-8000-000000000005' : '10000000-0000-4000-8000-000000000004',
        action_type:params[1], target_type:params[2], target_id:params[3], requested_by:params[4],
        status:'pending', parameters:params[5], approval_required:true, preview:params[10],
      };
      requests.set(request.id, request);
      return { rows:[request] };
    }
    if (sql.includes('FOR UPDATE')) return { rows:[requests.get(params[0])] };
    if (sql.includes("status='approved'")) return { rows:[] };
    if (sql.includes('INSERT INTO simulated_response_states')) {
      active = true;
      return { rows:[{ id:responseId, response_type:'endpoint_isolate', target_value:'server-1', state:'active' }] };
    }
    if (sql.includes('UPDATE simulated_response_states SET verified_at=')) {
      return { rows:[{ id:responseId, response_type:'endpoint_isolate', target_value:'server-1', state:'active', verification:params[1] }] };
    }
    if (sql.includes("UPDATE simulated_response_states SET state='reverted'")) {
      active = false;
      return { rows:[{ id:responseId, response_type:'endpoint_isolate', target_value:'server-1', state:'reverted', verification:params[3] }] };
    }
    if (sql.includes("UPDATE action_requests SET status='executed'")) {
      const request = requests.get(params[0]);
      const executed = { ...request, status:'executed', result:params[2] };
      requests.set(request.id, executed);
      return { rows:[executed] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const service = createActionService(database);
  const proposed = await service.submit({
    actionType:'response.simulate', targetId:'server-1',
    parameters:{ response_type:'endpoint_isolate', evidence_alert_ids:['alert-a','alert-b'] },
    reason:'Critical correlated evidence requires a response exercise', actor:'agent', idempotencyKey:'simulate-1',
  });
  assert.equal(proposed.action_request.status, 'pending');
  assert.equal(proposed.action_request.preview.external_side_effects, false);
  assert.equal(active, false);
  const activated = await service.decide({ id:proposed.action_request.id, decision:'approved', reason:'Exercise approved', actor:'lead' });
  assert.equal(activated.action_request.status, 'executed');
  assert.equal(activated.result.record.verification.verified, true);
  assert.equal(active, true);

  const rollback = await service.submit({
    actionType:'response.rollback', targetId:responseId, parameters:{},
    reason:'Exercise completed', actor:'lead', idempotencyKey:'rollback-1',
  });
  assert.equal(rollback.action_request.status, 'pending');
  assert.equal(active, true);
  const reverted = await service.decide({ id:rollback.action_request.id, decision:'approved', reason:'Return simulation to baseline', actor:'lead' });
  assert.equal(reverted.result.record.state, 'reverted');
  assert.equal(active, false);
  assert.equal(calls.filter(call => call.sql.includes('INSERT INTO action_approvals')).length, 2);
});

test('simulated response rejects a target that is not present in its supplied alerts', async () => {
  const { database, calls } = databaseWith(sql => {
    if (['BEGIN','ROLLBACK'].includes(sql)) return { rows:[] };
    if (sql.includes('SELECT * FROM action_requests WHERE idempotency_key=')) return { rows:[] };
    if (sql.includes("FROM action_requests WHERE action_type='response.simulate'")) return { rows:[] };
    if (sql.includes('FROM simulated_response_states') && sql.includes("state='active'")) return { rows:[] };
    if (sql.includes('WITH supplied AS') && sql.includes('AS matched')) {
      return { rows:[{ supplied:1, valid:1, matched:0 }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  await assert.rejects(createActionService(database).submit({
    actionType:'response.simulate', targetId:'unrelated-host',
    parameters:{ response_type:'endpoint_isolate', evidence_alert_ids:['alert-a'] },
    reason:'Exercise an unrelated target', actor:'agent', idempotencyKey:'mismatch-1',
  }), error => error.code === 'ACTION_TARGET_NOT_FOUND' && error.status === 404);
  assert.ok(calls.some(call => call.sql === 'ROLLBACK'));
  assert.ok(!calls.some(call => call.sql.includes('INSERT INTO action_requests')));
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
