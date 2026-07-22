'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  POLICY_VERSION, incidentNote, operationKey, runAutonomousAgent,
} = require('../src/workers/autonomous');

function fakeDatabase() {
  const operations = new Map();
  const runs = [];
  let operationId = 0;
  return {
    operations, runs,
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes('INSERT INTO autonomous_runs')) {
        const row = { id:'11111111-1111-4111-8111-111111111111', fetch_run_id:params[0], trigger:params[1], status:'running' };
        runs.push(row); return { rows:[row], rowCount:1 };
      }
      if (text.includes('FROM incidents') && text.includes("severity IN ('high','critical')")) {
        return { rows:[{
          id:7, title:'Coordinated identity compromise', severity:'critical', confidence:0.94,
          alert_ids:['alert-a','alert-b'], narrative:'Two validated alerts share maya.',
          recommended_actions:['Validate the identity'], common_entities:{ users:['maya'] }, owner:null,
          correlation_run_id:'22222222-2222-4222-8222-222222222222', updated_at:'2026-07-17T08:00:00Z',
        }] };
      }
      if (text.includes('FROM alerts a')) return { rows:[] };
      if (text.includes('status=\'completed\' AND operation_key=ANY')) return { rows:[] };
      if (text.includes('INSERT INTO autonomous_operations')) {
        const key = params[1];
        if (operations.has(key)) return { rows:[], rowCount:0 };
        const row = { id:++operationId, run_id:params[0], operation_key:key, operation_type:params[2], source_type:params[3], source_id:params[4], status:'running', attempts:1 };
        operations.set(key, row); return { rows:[row], rowCount:1 };
      }
      if (text.includes('SELECT * FROM autonomous_operations WHERE operation_key')) {
        return { rows:[operations.get(params[0])].filter(Boolean) };
      }
      if (text.includes("SET status='completed'")) {
        const row = [...operations.values()].find(item => item.id === params[0]);
        Object.assign(row, { status:'completed', target_type:params[1], target_id:params[2], result:params[3] });
        return { rows:[row], rowCount:1 };
      }
      if (text.includes("SET status='failed'")) {
        const row = [...operations.values()].find(item => item.id === params[0]);
        Object.assign(row, { status:'failed', error_code:params[1], error:params[2] });
        return { rows:[row], rowCount:1 };
      }
      if (text.includes('GROUP BY status,operation_type')) {
        const counts = new Map();
        for (const row of operations.values()) {
          if (row.run_id !== params[0]) continue;
          const key = `${row.status}|${row.operation_type}`;
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        return { rows:[...counts].map(([key,n]) => {
          const [status, operation_type] = key.split('|'); return { status, operation_type, n };
        }) };
      }
      if (text.includes('UPDATE autonomous_runs SET status=$2')) {
        Object.assign(runs[0], { status:params[1], metrics:params[2] });
        return { rows:[runs[0]], rowCount:1 };
      }
      throw new Error(`Unexpected autonomous query: ${text.slice(0, 90)}`);
    },
  };
}

test('Phase 9 agent creates internal records and proposes response simulations through approval', async () => {
  const database = fakeDatabase();
  const calls = [];
  const actionService = {
    async submit(input) {
      calls.push(input);
      const target = input.actionType === 'investigation.create'
        ? '33333333-3333-4333-8333-333333333333' : String(input.targetId);
      return { action_request:{ id:`action-${calls.length}`, status:input.actionType === 'case.update' ? 'pending' : 'executed', target_type:input.actionType.startsWith('case.') ? 'case' : 'investigation', target_id:target }, idempotent_replay:false };
    },
  };
  const result = await runAutonomousAgent({
    autonomous_lookback_hours:'24', autonomous_max_items:'20', autonomous_min_confidence:'0.7',
    autonomous_assignment_enabled:'true', autonomous_default_owner:'Tier 2 SOC',
    simulated_response_proposals_enabled:'true',
  }, 42, { database, actionService, trigger:'test' });

  assert.equal(result.status, 'completed');
  assert.equal(result.policy_version, POLICY_VERSION);
  assert.equal(result.metrics.investigations_created, 1);
  assert.equal(result.metrics.investigation_notes_added, 1);
  assert.equal(result.metrics.case_notes_added, 1);
  assert.equal(result.metrics.approvals_requested, 2);
  assert.equal(result.metrics.simulated_responses_proposed, 1);
  assert.deepEqual(calls.map(call => call.actionType), [
    'investigation.create','investigation.add_note','case.add_note','case.update','response.simulate',
  ]);
  assert.equal(calls.at(-2).parameters.owner, 'Tier 2 SOC');
  assert.equal(calls.at(-1).parameters.response_type, 'identity_suspend');
  assert.deepEqual(calls.at(-1).parameters.evidence_alert_ids, ['alert-a','alert-b']);
  assert.match(calls.at(-1).reason, /approval is required/i);
  assert.ok(calls.every(call => !['host.isolate','account.disable','ip.block'].includes(call.actionType)));
});

test('operation keys are deterministic and grounded notes state the safety boundary', () => {
  assert.equal(operationKey('case-note','case',7,'run-1'), operationKey('case-note','case',7,'run-1'));
  assert.notEqual(operationKey('case-note','case',7,'run-1'), operationKey('case-note','case',7,'run-2'));
  assert.match(incidentNote({ id:7, severity:'high', confidence:0.8, alert_ids:['a','b'] }), /No containment, closure, or false-positive decision was executed/);
});
