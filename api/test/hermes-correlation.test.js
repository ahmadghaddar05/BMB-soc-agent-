'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCorrelationOutput } = require('../src/services/hermes/schemas');
const {
  OUTPUT_SCHEMA_VERSION, PROMPT_VERSION, correlateHermes,
  validateCorrelationGroups,
} = require('../src/services/hermes/correlation');

function alert(id, overrides = {}) {
  return {
    id, timestamp: '2026-07-16T10:00:00.000Z', triaged_at: '2026-07-16T10:01:00.000Z',
    rule_id: `rule-${id}`, rule_level: 12, rule_desc: `Alert ${id}`,
    source_severity: 'high', username: 'maya.georges', hostname: 'HOST-A',
    src_ip: '192.0.2.10', dst_ip: '10.0.0.5', process: 'powershell.exe',
    target_db: null, mitre_tactics: ['credential_access'],
    verdict: { verdict: 'needs_investigation', severity: 'high', confidence: 0.8, attack_stage: 'credential_access' },
    ...overrides,
  };
}

function output(overrides = {}) {
  return {
    incidents: [{
      title: 'Connected identity activity', severity: 'high', confidence: 0.83,
      alert_ids: ['A', 'B'], attack_stages: ['credential_access'],
      common_entities: { users: ['maya.georges'], hosts: ['HOST-A'], ips: ['192.0.2.10'] },
      narrative: 'Alerts A and B share the same identity and host in the supplied window.',
      recommended_actions: ['Validate the identity activity with the system owner'],
      ...overrides,
    }],
  };
}

function hermesResult(value) {
  return {
    runId: 'hermes-correlation-1', output: JSON.stringify(value), model: 'hermes-agent',
    attempts: 1, latencyMs: 4, capabilities: { safe: true },
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
  };
}

function fakeStore(calls) {
  return {
    async beginCorrelation(value) {
      calls.push(['begin', value]);
      return { runId: 'local-correlation-run', idempotencyKey: 'idem-correlation' };
    },
    async attachHermesRun(_runId, hermesRunId) { calls.push(['attach', hermesRunId]); },
    async recordHermesStep(value) { calls.push(['step', value.stepType]); },
    async recordHermesStepFailure(value) { calls.push(['step-failed', value.error.code]); },
    async completeCorrelation(value) { calls.push(['complete', value.incidentIds]); },
    async failCorrelation(value) { calls.push(['failed', value.error.code]); },
  };
}

const config = { hermesCorrelationTimeoutMs: 1000, hermesTimeoutMs: 1000 };

test('correlation schema is strict and requires multi-alert groups', () => {
  assert.equal(parseCorrelationOutput(JSON.stringify(output())).incidents.length, 1);
  assert.throws(
    () => parseCorrelationOutput(JSON.stringify(output({ alert_ids: ['A'] }))),
    error => error.code === 'HERMES_INVALID_OUTPUT'
  );
  assert.throws(
    () => parseCorrelationOutput(JSON.stringify({ ...output(), invented: true })),
    error => error.code === 'HERMES_INVALID_OUTPUT'
  );
});

test('deterministic guards reject unknown IDs, overlapping groups, and disconnected evidence', () => {
  const candidates = [alert('A'), alert('B')];
  assert.throws(
    () => validateCorrelationGroups(output({ alert_ids: ['A', 'missing'] }), candidates, ['A'], 6),
    error => error.code === 'HERMES_UNGROUNDED_OUTPUT'
  );
  const overlapping = output();
  overlapping.incidents.push({ ...overlapping.incidents[0], title: 'Second', alert_ids: ['A', 'B'] });
  assert.throws(
    () => validateCorrelationGroups(overlapping, candidates, ['A'], 6),
    error => error.code === 'HERMES_INVALID_OUTPUT'
  );
  assert.throws(
    () => validateCorrelationGroups(output(), [
      alert('A'), alert('B', { username: 'other', hostname: 'HOST-B', src_ip: '198.51.100.9', dst_ip: '10.0.0.9', process: 'cmd.exe' }),
    ], ['A'], 6),
    error => error.code === 'HERMES_UNGROUNDED_OUTPUT'
  );
});

test('Hermes correlation is tool-less, grounded, persisted, and fully audited', async () => {
  const calls = [];
  const client = { async runAgent(options) {
    assert.match(options.instructions, /never request tools/i);
    assert.match(options.input, /untrusted_alert_candidates/);
    assert.equal(options.sessionKey, 'bmb-correlation:local-correlation-run');
    await options.onSubmitted('hermes-correlation-1');
    return hermesResult(output());
  } };
  let persisted;
  const result = await correlateHermes([alert('A'), alert('B')], ['A'], {
    correlation_entity_window_hours: '6',
  }, {
    client, store: fakeStore(calls), config, actor: 'scheduler', requestId: 'request-1',
    async persist(incidents, runId) {
      persisted = { incidents, runId };
      return { created: 1, updated: 0, unchanged: 0, incidentIds: [17] };
    },
  });
  assert.equal(result.provider, 'hermes');
  assert.equal(result.total_tokens, 30);
  assert.equal(result.run_id, 'local-correlation-run');
  assert.equal(persisted.runId, 'local-correlation-run');
  assert.deepEqual(persisted.incidents[0].common_entities.users, ['maya.georges']);
  assert.deepEqual(calls.map(item => item[0]), ['begin', 'attach', 'step', 'complete']);
  assert.equal(calls[0][1].promptVersion, PROMPT_VERSION);
  assert.equal(calls[0][1].schemaVersion, OUTPUT_SCHEMA_VERSION);
});

test('invalid Hermes output records the failed sub-run and failed parent run', async () => {
  const calls = [];
  const client = { async runAgent(options) {
    await options.onSubmitted('hermes-invalid');
    return { ...hermesResult(output({ alert_ids: ['A', 'fabricated'] })), runId: 'hermes-invalid' };
  } };
  await assert.rejects(correlateHermes([alert('A'), alert('B')], ['A'], {}, {
    client, store: fakeStore(calls), config, async persist() { throw new Error('must not persist'); },
  }), error => error.code === 'HERMES_UNGROUNDED_OUTPUT');
  assert.deepEqual(calls.map(item => item[0]), ['begin', 'attach', 'step-failed', 'failed']);
});
