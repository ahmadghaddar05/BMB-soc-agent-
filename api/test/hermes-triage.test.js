'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTriageTurn, validateCitations } = require('../src/services/hermes/schemas');
const {
  PROMPT_VERSION, OUTPUT_SCHEMA_VERSION,
  triageCacheIdentity, triageHermes, validateTriageCitations,
} = require('../src/services/hermes/triage');

function alert(overrides = {}) {
  return {
    id: 'alert-A', timestamp: '2026-07-16T10:00:00.000Z', source_system: 'elastic',
    rule_id: 'rule-1', rule_level: 12, rule_desc: 'Suspicious activity',
    source_severity: 'high', risk_score: 80, enrichment_status: 'enriched',
    enrichment: { user: { privileged: true }, src_threat_intel: { found: false } },
    src_ip: '192.0.2.10', hostname: 'HOST-A', username: 'analyst',
    ...overrides,
  };
}

function final(overrides = {}) {
  return {
    type: 'final', severity: 'high', verdict: 'needs_investigation', confidence: 0.72,
    attack_stage: 'credential_access', key_findings: ['Privileged identity is affected'],
    recommended_actions: ['Validate the activity with the identity owner'],
    narrative: 'The supplied alert requires analyst validation.',
    citations: [{ type: 'alert', id: 'alert-A' }], limitations: ['No raw log was supplied'],
    ...overrides,
  };
}

function store(calls) {
  return {
    async beginTriage(value) {
      calls.push(['begin', value]);
      return { runId: 'local-run', idempotencyKey: 'idempotency' };
    },
    async attachHermesRun(_runId, hermesRunId) { calls.push(['attach', hermesRunId]); },
    async recordHermesStep(value) { calls.push(['step', value.stepType]); },
    async recordHermesStepFailure(value) { calls.push(['step-failed', value.error.code]); },
    async beginToolCall(value) { calls.push(['tool-begin', value.toolName]); return 9; },
    async completeToolCall(value) { calls.push(['tool-complete', value.toolName]); },
    async failToolCall(value) { calls.push(['tool-failed', value.error.code]); },
    async completeTriage(value) { calls.push(['complete', value.output.triage_path]); },
    async failTriage(value) { calls.push(['failed', value.error.code]); },
  };
}

function hermesResult(runId, output) {
  return {
    runId, output: JSON.stringify(output), model: 'hermes-agent', attempts: 1,
    latencyMs: 2, capabilities: { safe: true },
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

const config = {
  hermesTriageTimeoutMs: 1000,
  hermesTriageMaxToolCalls: 3,
};

test('Hermes triage schema is strict and requires grounded citations', () => {
  const parsed = parseTriageTurn(JSON.stringify(final()));
  assert.equal(parsed.verdict, 'needs_investigation');
  validateCitations(parsed, [{ type: 'alert', id: 'alert-A' }]);
  assert.throws(() => parseTriageTurn(JSON.stringify(final({ confidence: 2 }))),
    error => error.code === 'HERMES_INVALID_OUTPUT');
  assert.throws(() => parseTriageTurn(JSON.stringify({ ...final(), invented: true })),
    error => error.code === 'HERMES_INVALID_OUTPUT');
  assert.throws(() => validateCitations(final({ citations: [{ type: 'alert', id: 'missing' }] }),
    [{ type: 'alert', id: 'alert-A' }]), error => error.code === 'HERMES_UNGROUNDED_OUTPUT');
  assert.throws(() => validateTriageCitations(final({
    citations: [{ type: 'asset', id: 'HOST-A' }],
  }), [
    { type: 'alert', id: 'alert-A' }, { type: 'asset', id: 'HOST-A' },
  ], 'alert-A'), error => error.code === 'HERMES_UNGROUNDED_OUTPUT');
});

test('pipeline triage uses one Hermes run, no tools, and records strict provenance', async () => {
  const calls = [];
  const client = { async runAgent(options) {
    await options.onSubmitted('hermes-1');
    assert.match(options.instructions, /Automatic closure is disabled/);
    assert.match(options.input, /untrusted_alert_evidence/);
    assert.equal(options.sessionKey, 'bmb-triage:local-run');
    return hermesResult('hermes-1', final());
  } };
  const result = await triageHermes(alert(), { triage_mode: 'pipeline' }, {
    client, store: store(calls), toolkit: { specs: [] }, config,
    signature: 'sig', cacheKey: 'cache', actor: 'scheduler', requestId: 'request',
  });
  assert.equal(result.provider, 'hermes');
  assert.equal(result.triage_path, 'hermes_pipeline');
  assert.equal(result.hermes_calls, 1);
  assert.equal(result.total_tokens, 15);
  assert.deepEqual(calls.map(item => item[0]), ['begin', 'attach', 'step', 'complete']);
  assert.equal(calls[0][1].promptVersion, PROMPT_VERSION);
  assert.equal(calls[0][1].schemaVersion, OUTPUT_SCHEMA_VERSION);
});

test('agentic triage executes only a bounded BMB application tool before final output', async () => {
  const calls = [];
  let turn = 0;
  const client = { async runAgent(options) {
    turn++;
    await options.onSubmitted(`hermes-${turn}`);
    return hermesResult(`hermes-${turn}`, turn === 1
      ? { type: 'tool_call', tool: 'get_asset_context', arguments: { hostname: 'HOST-A' } }
      : final({ citations: [
        { type: 'alert', id: 'alert-A' }, { type: 'asset', id: 'HOST-A' },
      ] }));
  } };
  const toolkit = {
    specs: [{ name: 'get_asset_context', description: 'Asset', parameters: { type: 'object' } }],
    async execute() {
      return {
        data: { found: true }, evidence: [{ type: 'asset', id: 'HOST-A' }],
        serialized: '{"data":{"found":true},"evidence":[{"type":"asset","id":"HOST-A"}]}',
        latencyMs: 1, bytes: 80,
      };
    },
  };
  const result = await triageHermes(alert(), { triage_mode: 'agentic' }, {
    client, store: store(calls), toolkit, config, signature: 'sig', cacheKey: 'cache',
  });
  assert.equal(result.triage_path, 'hermes_agentic');
  assert.equal(result.hermes_calls, 2);
  assert.equal(result.tools_used.length, 1);
  assert.deepEqual(calls.map(item => item[0]), [
    'begin', 'attach', 'step', 'tool-begin', 'tool-complete',
    'attach', 'step', 'complete',
  ]);
});

test('hybrid triage escalates only through the deterministic policy', async () => {
  const calls = [];
  let turn = 0;
  const client = { async runAgent(options) {
    turn++;
    await options.onSubmitted(`hermes-${turn}`);
    return hermesResult(`hermes-${turn}`, turn === 1
      ? final({ severity: 'critical', confidence: 0.6 })
      : final({ severity: 'critical', confidence: 0.91, verdict: 'true_positive' }));
  } };
  const result = await triageHermes(alert(), { triage_mode: 'hybrid' }, {
    client, store: store(calls), toolkit: { specs: [] }, config,
    signature: 'sig', cacheKey: 'cache',
  });
  assert.equal(result.agentic_escalated, true);
  assert.equal(result.triage_path, 'hermes_hybrid_agentic');
  assert.equal(result.hermes_calls, 2);
});

test('screening denies and audits an unexpected tool request', async () => {
  const calls = [];
  const client = { async runAgent(options) {
    await options.onSubmitted('hermes-screen-tool');
    return hermesResult('hermes-screen-tool', {
      type: 'tool_call', tool: 'get_asset_context', arguments: { hostname: 'HOST-A' },
    });
  } };
  await assert.rejects(triageHermes(alert(), { triage_mode: 'pipeline' }, {
    client, store: store(calls),
    toolkit: { specs: [{ name: 'get_asset_context', description: 'Asset', parameters: {} }] },
    config, signature: 'sig', cacheKey: 'cache',
  }), error => error.code === 'HERMES_UNEXPECTED_TOOL_CALL');
  assert.deepEqual(calls.map(item => item[0]), [
    'begin', 'attach', 'step', 'tool-begin', 'tool-failed', 'failed',
  ]);
});

test('agentic triage stops and audits requests beyond its tool budget', async () => {
  const calls = [];
  let turn = 0;
  const client = { async runAgent(options) {
    turn++;
    await options.onSubmitted(`hermes-budget-${turn}`);
    return hermesResult(`hermes-budget-${turn}`, {
      type: 'tool_call', tool: 'get_asset_context', arguments: { hostname: 'HOST-A' },
    });
  } };
  const toolkit = {
    specs: [{ name: 'get_asset_context', description: 'Asset', parameters: {} }],
    async execute() {
      return {
        data: { found: true }, evidence: [{ type: 'asset', id: 'HOST-A' }],
        serialized: '{"data":{"found":true},"evidence":[{"type":"asset","id":"HOST-A"}]}',
        latencyMs: 1, bytes: 80,
      };
    },
  };
  await assert.rejects(triageHermes(alert(), { triage_mode: 'agentic' }, {
    client, store: store(calls), toolkit,
    config: { ...config, hermesTriageMaxToolCalls: 1 },
    signature: 'sig', cacheKey: 'cache',
  }), error => error.code === 'HERMES_TOOL_BUDGET_EXHAUSTED');
  assert.equal(turn, 2);
  assert.equal(calls.filter(item => item[0] === 'tool-complete').length, 1);
  assert.equal(calls.filter(item => item[0] === 'tool-failed').length, 1);
  assert.equal(calls.at(-1)[0], 'failed');
});

test('failed enrichment is rejected before creating a Hermes audit run', async () => {
  let began = false;
  await assert.rejects(triageHermes(alert({ enrichment_status: 'enrichment_failed' }), {}, {
    store: { async beginTriage() { began = true; } }, config,
  }), error => error.code === 'HERMES_ENRICHMENT_REQUIRED');
  assert.equal(began, false);
});

test('cache identity changes with alert, enrichment, prompt contract, and model inputs', () => {
  const first = triageCacheIdentity(alert(), 'sig', 'hermes-agent');
  assert.equal(first.cacheKey, triageCacheIdentity(alert(), 'sig', 'hermes-agent').cacheKey);
  assert.notEqual(first.cacheKey, triageCacheIdentity(alert({ id: 'alert-B' }), 'sig', 'hermes-agent').cacheKey);
  assert.notEqual(first.cacheKey, triageCacheIdentity(alert({ enrichment: { changed: true } }), 'sig', 'hermes-agent').cacheKey);
  assert.notEqual(first.cacheKey, triageCacheIdentity(alert(), 'sig', 'different-model').cacheKey);
});
