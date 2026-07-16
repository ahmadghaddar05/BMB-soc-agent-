'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHermesClient } = require('../src/services/hermes/client');
const { HermesError } = require('../src/services/hermes/errors');
const { parseChatOutput, validateCitations } = require('../src/services/hermes/schemas');
const { chatHermes } = require('../src/services/hermes/chat');

const config = {
  hermesUrl: 'http://hermes.test:8642/v1', hermesApiKey: 'secret-key', hermesModel: 'hermes-agent',
  hermesRequestTimeoutMs: 1000, hermesRetries: 1, hermesPollIntervalMs: 1,
  hermesTimeoutMs: 1000, hermesCapabilityTtlMs: 60000, hermesStrictCapabilities: true,
  hermesEnforceSafeToolsets: true,
  hermesRequireToollessProfile: true,
  hermesForbiddenTools: ['terminal', 'write_file', 'web_search', 'delegate_task'],
};

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function handshakeResponse(url, toolsets = []) {
  if (url.endsWith('/capabilities')) return jsonResponse({
    object: 'hermes.api_server.capabilities', platform: 'hermes-agent', model: 'hermes-agent',
    auth: { type: 'bearer', required: true },
    features: { run_submission: true, run_status: true, run_stop: true },
  });
  if (url.endsWith('/models')) return jsonResponse({ object: 'list', data: [{ id: 'hermes-agent' }] });
  if (url.endsWith('/toolsets')) return jsonResponse(toolsets);
  return null;
}

test('Hermes capability handshake validates and caches the safe server contract', async () => {
  const calls = [];
  const client = createHermesClient({ config, fetchImpl: async url => {
    calls.push(url);
    return handshakeResponse(url);
  } });
  const first = await client.handshake();
  const second = await client.handshake();
  assert.equal(first.safe, true);
  assert.equal(second, first);
  assert.equal(calls.length, 3);
});

test('Hermes capability handshake accepts the toolset list envelope used by current servers', async () => {
  const client = createHermesClient({ config, fetchImpl: async url => {
    if (url.endsWith('/toolsets')) return jsonResponse({
      object: 'list',
      data: [],
    });
    return handshakeResponse(url);
  } });
  const result = await client.handshake();
  assert.equal(result.safe, true);
  assert.deepEqual(result.active_toolsets, []);
  assert.deepEqual(result.active_tools, []);
});

test('Hermes capability handshake still rejects malformed toolset envelopes', async () => {
  const client = createHermesClient({ config, fetchImpl: async url => {
    if (url.endsWith('/toolsets')) return jsonResponse({ object: 'list', data: {} });
    return handshakeResponse(url);
  } });
  await assert.rejects(client.handshake(), error => error.code === 'HERMES_PROTOCOL_ERROR');
});

test('Hermes capability handshake rejects unsafe host tools', async () => {
  const client = createHermesClient({ config, fetchImpl: async url => handshakeResponse(url, [{
    name: 'core', enabled: true, configured: true, tools: ['read_file', 'write_file'],
  }]) });
  await assert.rejects(client.handshake(), error => {
    assert.equal(error.code, 'HERMES_UNSAFE_TOOL_PROFILE');
    return true;
  });
});

test('Hermes capability handshake rejects a server without run cancellation', async () => {
  const client = createHermesClient({ config, fetchImpl: async url => {
    if (url.endsWith('/capabilities')) return jsonResponse({
      object: 'hermes.api_server.capabilities', platform: 'hermes-agent', model: 'hermes-agent',
      auth: { type: 'bearer', required: true },
      features: { run_submission: true, run_status: true, run_stop: false },
    });
    return handshakeResponse(url);
  } });
  await assert.rejects(client.handshake(), error => error.code === 'HERMES_CAPABILITY_MISMATCH');
});

test('Hermes SOC profile rejects even read-only host tools because evidence is API-supplied', async () => {
  const client = createHermesClient({ config, fetchImpl: async url => handshakeResponse(url, [{
    name: 'file', enabled: true, configured: true, tools: ['read_file'],
  }]) });
  await assert.rejects(client.handshake(), error => error.code === 'HERMES_UNSAFE_TOOL_PROFILE');
});

test('Hermes retries transient responses with an idempotency key', async () => {
  let calls = 0;
  const delays = [];
  const client = createHermesClient({
    config,
    sleepImpl: async ms => { delays.push(ms); },
    fetchImpl: async (_url, options) => {
      calls += 1;
      assert.equal(options.headers['Idempotency-Key'], 'same-operation');
      return calls === 1
        ? jsonResponse({ error: 'busy' }, 429, { 'Retry-After': '0' })
        : jsonResponse({ ok: true });
    },
  });
  const result = await client.request('/test', {
    method: 'POST', body: { test: true }, idempotencyKey: 'same-operation',
  });
  assert.equal(result.attempts, 2);
  assert.equal(delays.length, 1);
});

test('Hermes run polling returns normalized usage and model output', async () => {
  let polls = 0;
  const client = createHermesClient({
    config, sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      const capability = handshakeResponse(url);
      if (capability) return capability;
      if (url.endsWith('/runs') && options.method === 'POST') return jsonResponse({ run_id: 'run-1', status: 'started' }, 202);
      if (url.endsWith('/runs/run-1')) {
        polls += 1;
        return jsonResponse(polls === 1
          ? { object: 'hermes.run', run_id: 'run-1', status: 'running' }
          : {
            object: 'hermes.run', run_id: 'run-1', status: 'completed', model: 'hermes-agent',
            output: '{"answer":"Investigate alert A","citations":[],"confidence":"medium"}',
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });
  const submitted = [];
  const result = await client.runAgent({
    input: 'question', instructions: 'instructions', idempotencyKey: 'run-operation',
    onSubmitted: runId => submitted.push(runId),
  });
  assert.deepEqual(submitted, ['run-1']);
  assert.equal(result.usage.total_tokens, 15);
  assert.equal(result.output.includes('Investigate'), true);
});

test('cancelling a submitted Hermes run invokes the stop endpoint', async () => {
  const controller = new AbortController();
  let stopped = false;
  const client = createHermesClient({
    config, sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      const capability = handshakeResponse(url);
      if (capability) return capability;
      if (url.endsWith('/runs') && options.method === 'POST') return jsonResponse({ run_id: 'run-cancel', status: 'started' }, 202);
      if (url.endsWith('/runs/run-cancel/stop')) { stopped = true; return jsonResponse({ status: 'stopping' }); }
      throw new Error(`Unexpected URL ${url}`);
    },
  });
  await assert.rejects(client.runAgent({
    input: 'question', instructions: 'instructions', signal: controller.signal,
    onSubmitted: () => controller.abort(),
  }), error => error.code === 'HERMES_CANCELLED');
  assert.equal(stopped, true);
});

test('structured chat output rejects invalid JSON and hallucinated evidence IDs', () => {
  assert.throws(() => parseChatOutput('not-json'), error => error.code === 'HERMES_INVALID_OUTPUT');
  const output = parseChatOutput(JSON.stringify({
    answer: 'Unsupported citation', citations: [{ type: 'alert', id: 'missing' }], confidence: 'low',
  }));
  assert.throws(
    () => validateCitations(output, { alerts: [{ id: 'real' }], incidents: [] }),
    error => error.code === 'HERMES_UNGROUNDED_OUTPUT'
  );
});

test('chat orchestration persists the run, evidence, response, and Hermes-only identity', async () => {
  const calls = [];
  const store = {
    async beginChat() { calls.push('begin'); return { conversationId: 'conversation', runId: 'local-run', idempotencyKey: 'key', history: [] }; },
    async recordEvidenceSnapshot() { calls.push('evidence'); },
    async attachHermesRun() { calls.push('attach'); },
    async completeChat() { calls.push('complete'); },
    async failChat() { calls.push('fail'); },
  };
  const client = {
    async runAgent(options) {
      await options.onSubmitted('hermes-run');
      return {
        runId: 'hermes-run', model: 'hermes-agent', attempts: 1, latencyMs: 2,
        capabilities: { safe: true }, usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
        output: JSON.stringify({ answer: 'Alert A is high risk.', citations: [{ type: 'alert', id: 'A' }], confidence: 'high' }),
      };
    },
  };
  const result = await chatHermes('What matters?', {
    actor: 'analyst', requestId: 'request', client, store,
    evidenceBuilder: async () => ({ generated_at: 'now', stats: {}, alerts: [{ id: 'A' }], incidents: [] }),
  });
  assert.deepEqual(calls, ['begin', 'evidence', 'attach', 'complete']);
  assert.equal(result.provider, 'hermes');
  assert.equal(result.tokens, 7);
  assert.deepEqual(result.citations, [{ type: 'alert', id: 'A' }]);
});
