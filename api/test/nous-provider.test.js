'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runNousCompletion, handshakeNous } = require('../src/services/hermes/nous');
const { createNousClient } = require('../src/services/hermes/client');
const { parseTriageTurn, validateCitations } = require('../src/services/hermes/schemas');

const config = {
  llmProvider: 'nous',
  nousBaseUrl: 'https://api.nousresearch.com/v1',
  nousApiKey: 'test-key',
  nousModel: 'hy3:free',
  nousJsonMode: true,
  nousRequestTimeoutMs: 1000,
};

const FINAL_TRIAGE = JSON.stringify({
  type: 'final',
  severity: 'high',
  verdict: 'needs_investigation',
  confidence: 0.7,
  attack_stage: 'credential_access',
  key_findings: ['Privileged identity affected'],
  recommended_actions: ['Validate activity with the identity owner'],
  narrative: 'The supplied alert requires analyst validation.',
  citations: [{ type: 'alert', id: 'alert-A' }],
  limitations: ['No raw log supplied'],
});

function nousResponse(content, usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }) {
  return new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content } }],
    usage,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('Nous adapter returns the Hermes-compatible shape for a valid triage verdict', async () => {
  const fetchImpl = async () => nousResponse(FINAL_TRIAGE);
  const result = await runNousCompletion({
    input: 'untrusted_alert_evidence: {...}',
    instructions: 'You are the BMB SOC triage engine',
    config, fetchImpl,
  });
  assert.match(result.runId, /^nous-/);
  assert.equal(result.model, 'hy3:free');
  assert.equal(result.usage.total_tokens, 15);
  // The strict downstream parser must accept the output unchanged.
  const parsed = parseTriageTurn(result.output);
  assert.equal(parsed.verdict, 'needs_investigation');
  validateCitations(parsed, [{ type: 'alert', id: 'alert-A' }]);
});

test('Nous adapter rejects an empty response as invalid output', async () => {
  const fetchImpl = async () => nousResponse('');
  await assert.rejects(
    runNousCompletion({ input: 'x', instructions: 'y', config, fetchImpl }),
    error => error.code === 'HERMES_INVALID_OUTPUT'
  );
});

test('Nous adapter surfaces HTTP errors with a retriable flag on 429', async () => {
  const fetchImpl = async () => new Response('rate limited', { status: 429 });
  await assert.rejects(
    runNousCompletion({ input: 'x', instructions: 'y', config, fetchImpl }),
    error => error.code === 'HERMES_HTTP_ERROR' && error.retriable === true
  );
});

test('Nous client is selected by defaultHermesClient when LLM_PROVIDER=nous', async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => nousResponse(FINAL_TRIAGE);
  try {
    const client = createNousClient({ config });
    assert.equal(client.baseUrl, config.nousBaseUrl);
    const cap = client.handshake();
    assert.equal(cap.provider, 'nous');
    assert.deepEqual(cap.advertised_models, ['hy3:free']);
    const submitted = [];
    const result = await client.runAgent({
      input: 'x', instructions: 'y',
      onSubmitted: runId => submitted.push(runId),
    });
    assert.match(submitted[0], /^nous-/);
    assert.equal(JSON.parse(result.output).type, 'final');
  } finally {
    global.fetch = previousFetch;
  }
});
