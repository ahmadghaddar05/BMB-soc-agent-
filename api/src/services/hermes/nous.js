'use strict';

// Direct Nous (OpenAI-compatible) provider adapter.
//
// This module lets the SOC application swap its AI boundary to a Nous-hosted
// chat model (e.g. hy3:free) WITHOUT changing any of the strict triage /
// grounded-analyst logic. The Hermes service layer still calls runAgent() with
// the same `input` + `instructions` contract; this adapter turns that into a
// single /chat/completions request and returns the *exact same* shape the rest
// of the code already validates:
//   { runId, output (string), model, usage, attempts, latencyMs, capabilities }
//
// Tool-calling (agentic / hybrid) is intentionally NOT supported here: Nous's
// hy3:free free tier is unreliable for parallel function calling, and the BMB
// application owns the only permitted SOC tools. The SOC toolkit is therefore
// only available through the Hermes provider. If a Nous run requests a tool in
// a tool-allowing mode, the caller's existing screening policy rejects it.

const crypto = require('crypto');
const { runtimeConfig } = require('../../config');
const { HermesError } = require('./errors');

function buildMessages({ input, instructions }) {
  // The Hermes contract passes `instructions` (system) and `input` (user
  // payload). We mirror that onto the chat roles.
  return [
    { role: 'system', content: String(instructions || 'You are a strict SOC analysis engine.') },
    { role: 'user', content: String(input || '') },
  ];
}

function extractContent(data) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const message = choice?.message;
  if (message && typeof message.content === 'string') return message.content;
  // Some providers nest under .text or return an object.
  if (typeof message?.content === 'object' && message.content !== null) {
    return JSON.stringify(message.content);
  }
  if (typeof data?.content === 'string') return data.content;
  throw new HermesError(
    'HERMES_INVALID_OUTPUT',
    'Nous returned no message content',
    { status: 502 }
  );
}

function extractUsage(data) {
  const u = data?.usage || {};
  const input = Number(u.prompt_tokens ?? u.input_tokens ?? 0);
  const output = Number(u.completion_tokens ?? u.output_tokens ?? 0);
  const total = Number(u.total_tokens ?? (input + output));
  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: total,
  };
}

// Emulate the Hermes run lifecycle by issuing one synchronous completion.
// Returns the same object runAgent() returns for the Hermes path.
async function runNousCompletion({ input, instructions, signal, config = runtimeConfig(), fetchImpl = global.fetch, onSubmitted } = {}) {
  if (!config.nousApiKey) {
    throw new HermesError('HERMES_NOT_CONFIGURED', 'NOUS_API_KEY is not configured', { status: 503 });
  }
  if (typeof fetchImpl !== 'function') {
    throw new HermesError('HERMES_UNAVAILABLE', 'A fetch implementation is required for Nous', { status: 502 });
  }

  const runId = `nous-${crypto.randomUUID()}`;
  const startedAt = Date.now();
  if (onSubmitted) await onSubmitted(runId);

  const messages = buildMessages({ input, instructions });
  const body = {
    model: config.nousModel,
    messages,
    temperature: 0.1,
    max_tokens: 2048,
  };
  if (config.nousJsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.nousRequestTimeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let response;
  try {
    response = await fetchImpl(`${config.nousBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.nousApiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    throw new HermesError(
      error?.name === 'AbortError' ? 'HERMES_REQUEST_TIMEOUT' : 'HERMES_UNAVAILABLE',
      error?.name === 'AbortError' ? 'Nous did not respond in time' : 'Nous is currently unavailable',
      { status: error?.name === 'AbortError' ? 504 : 502, retriable: true, cause: error }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new HermesError(
      'HERMES_HTTP_ERROR',
      `Nous request failed with HTTP ${response.status}: ${text.slice(0, 300)}`,
      { status: response.status === 429 ? 503 : 502, retriable: response.status === 429 }
    );
  }

  const data = await response.json().catch(() => null);
  if (!data) {
    throw new HermesError('HERMES_PROTOCOL_ERROR', 'Nous returned invalid JSON', { status: 502 });
  }

  const output = extractContent(data).trim();
  if (!output) {
    throw new HermesError('HERMES_INVALID_OUTPUT', 'Nous returned an empty response', { status: 502 });
  }

  const usage = extractUsage(data);
  return {
    runId,
    output,
    model: config.nousModel,
    attempts: 1,
    latencyMs: Date.now() - startedAt,
    capabilities: {
      checked_at: new Date().toISOString(),
      latency_ms: Date.now() - startedAt,
      model: config.nousModel,
      provider: 'nous',
      features: { run_submission: true, run_status: true, run_stop: false },
      advertised_models: [config.nousModel],
      active_toolsets: [],
      active_tools: [],
      safe: true,
    },
    usage,
  };
}

// Minimal capability check for the Nous provider. Nous has no /models or
// /capabilities endpoint in the Hermes sense, so we validate config only.
function handshakeNous({ config = runtimeConfig() } = {}) {
  if (!config.nousApiKey) {
    throw new HermesError('HERMES_NOT_CONFIGURED', 'NOUS_API_KEY is not configured', { status: 503 });
  }
  return {
    checked_at: new Date().toISOString(),
    latency_ms: 0,
    model: config.nousModel,
    provider: 'nous',
    features: { run_submission: true, run_status: true, run_stop: false },
    advertised_models: [config.nousModel],
    active_toolsets: [],
    active_tools: [],
    safe: true,
  };
}

module.exports = { runNousCompletion, handshakeNous, buildMessages, extractContent, extractUsage };
