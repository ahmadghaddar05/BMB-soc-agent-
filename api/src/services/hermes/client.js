'use strict';

const crypto = require('crypto');
const { runtimeConfig } = require('../../config');
const { HermesError } = require('./errors');
const { validate } = require('./schemas');

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const RETRIABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function normalizedBaseUrl(value) {
  const trimmed = String(value || '').replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function abortError() {
  return new HermesError('HERMES_CANCELLED', 'Hermes request was cancelled', { status: 499 });
}

function abortableDelay(ms, signal, sleepImpl) {
  if (signal?.aborted) return Promise.reject(abortError());
  if (sleepImpl) return sleepImpl(ms, signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', cancelled);
      resolve();
    }
    function cancelled() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancelled);
      reject(abortError());
    }
    signal?.addEventListener('abort', cancelled, { once: true });
  });
}

function retryDelay(response, attempt) {
  const header = response?.headers?.get?.('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(10000, Math.max(0, seconds * 1000));
    const timestamp = Date.parse(header);
    if (Number.isFinite(timestamp)) return Math.min(10000, Math.max(0, timestamp - Date.now()));
  }
  return Math.min(5000, 250 * (2 ** attempt)) + Math.floor(Math.random() * 100);
}

async function readJson(response) {
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > MAX_RESPONSE_BYTES) {
    throw new HermesError('HERMES_PROTOCOL_ERROR', 'Hermes returned an oversized response', { status: 502 });
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new HermesError('HERMES_PROTOCOL_ERROR', 'Hermes returned an oversized response', { status: 502 });
  }
  if (!text) return {};
  try { return JSON.parse(text); }
  catch {
    throw new HermesError('HERMES_PROTOCOL_ERROR', 'Hermes returned invalid JSON', { status: 502 });
  }
}

function isForbiddenTool(toolName, forbidden) {
  const normalized = String(toolName || '').trim().toLowerCase().replace(/[-.]/g, '_');
  return forbidden.some(value => {
    const item = String(value).trim().toLowerCase().replace(/[-.]/g, '_');
    return normalized === item || normalized.startsWith(`${item}_`) || normalized.endsWith(`_${item}`);
  });
}

function createHermesClient({ config = runtimeConfig(), fetchImpl = global.fetch, sleepImpl = null } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  const baseUrl = normalizedBaseUrl(config.hermesUrl);
  let cachedCapabilities = null;

  async function request(path, {
    method = 'GET', body, headers = {}, signal, timeoutMs = config.hermesRequestTimeoutMs,
    retries = config.hermesRetries, idempotencyKey,
  } = {}) {
    const canRetry = method === 'GET' || method === 'HEAD' || Boolean(idempotencyKey);
    const maxRetries = canRetry ? retries : 0;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (signal?.aborted) throw abortError();
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      const cancel = () => controller.abort();
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      };
      signal?.addEventListener('abort', cancel, { once: true });
      let response;
      try {
        response = await fetchImpl(`${baseUrl}${path}`, {
          method,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${config.hermesApiKey}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        cleanup();
        if (signal?.aborted) throw abortError();
        lastError = new HermesError(
          timedOut ? 'HERMES_REQUEST_TIMEOUT' : 'HERMES_UNAVAILABLE',
          timedOut ? 'Hermes did not respond in time' : 'Hermes is currently unavailable',
          { status: timedOut ? 504 : 502, retriable: true, cause: error }
        );
        lastError.attempts = attempt + 1;
        if (attempt >= maxRetries) throw lastError;
        await abortableDelay(retryDelay(null, attempt), signal, sleepImpl);
        continue;
      }

      if (!response.ok) {
        response.body?.cancel?.().catch(() => {});
        cleanup();
        const retriable = RETRIABLE_STATUSES.has(response.status);
        lastError = new HermesError(
          response.status === 401 || response.status === 403 ? 'HERMES_AUTH_FAILED' : 'HERMES_HTTP_ERROR',
          response.status === 401 || response.status === 403
            ? 'Hermes authentication failed'
            : `Hermes request failed with HTTP ${response.status}`,
          { status: response.status === 429 ? 503 : 502, retriable }
        );
        lastError.attempts = attempt + 1;
        if (!retriable || attempt >= maxRetries) throw lastError;
        await abortableDelay(retryDelay(response, attempt), signal, sleepImpl);
        continue;
      }

      try {
        const data = await readJson(response);
        cleanup();
        return { data, attempts: attempt + 1, status: response.status };
      } catch (error) {
        cleanup();
        if (signal?.aborted) throw abortError();
        if (error instanceof HermesError) throw error;
        lastError = new HermesError(
          timedOut ? 'HERMES_REQUEST_TIMEOUT' : 'HERMES_UNAVAILABLE',
          timedOut ? 'Hermes did not respond in time' : 'Hermes is currently unavailable',
          { status: timedOut ? 504 : 502, retriable: true, cause: error }
        );
        lastError.attempts = attempt + 1;
        if (attempt >= maxRetries) throw lastError;
        await abortableDelay(retryDelay(null, attempt), signal, sleepImpl);
      }
    }
    throw lastError;
  }

  async function handshake({ signal, force = false } = {}) {
    if (!config.hermesApiKey) {
      throw new HermesError('HERMES_NOT_CONFIGURED', 'Hermes is not configured', { status: 503 });
    }
    if (!force && cachedCapabilities && cachedCapabilities.expiresAt > Date.now()) return cachedCapabilities.value;

    const started = Date.now();
    const [capResult, modelResult, toolsetResult] = await Promise.all([
      request('/capabilities', { signal }),
      request('/models', { signal }),
      request('/toolsets', { signal }),
    ]);
    const capabilities = validate('capabilities', capResult.data);
    const models = validate('models', modelResult.data);
    const toolsets = validate('toolsets', toolsetResult.data);
    const required = ['run_submission', 'run_status', 'run_stop'];
    const missing = required.filter(name => capabilities.features[name] !== true);
    if (config.hermesStrictCapabilities && missing.length) {
      throw new HermesError('HERMES_CAPABILITY_MISMATCH', `Hermes is missing required capabilities: ${missing.join(', ')}`, { status: 503 });
    }
    const advertisedModels = models.data.map(model => model.id);
    if (!advertisedModels.includes(config.hermesModel)) {
      throw new HermesError('HERMES_MODEL_UNAVAILABLE', 'The configured Hermes model is not advertised by the server', { status: 503 });
    }

    const activeTools = toolsets
      .filter(toolset => toolset.enabled && toolset.configured)
      .flatMap(toolset => toolset.tools.map(tool => ({ toolset: toolset.name, tool })));
    const unsafeTools = activeTools.filter(entry => isForbiddenTool(entry.tool, config.hermesForbiddenTools));
    const profileViolations = config.hermesRequireToollessProfile ? activeTools : unsafeTools;
    if (config.hermesEnforceSafeToolsets && profileViolations.length) {
      throw new HermesError('HERMES_UNSAFE_TOOL_PROFILE', 'Hermes has unsafe host tools enabled for the SOC integration', {
        status: 503,
        details: profileViolations.slice(0, 20),
      });
    }

    const value = {
      checked_at: new Date().toISOString(),
      latency_ms: Date.now() - started,
      model: config.hermesModel,
      features: Object.fromEntries(required.map(name => [name, capabilities.features[name] === true])),
      advertised_models: advertisedModels,
      active_toolsets: toolsets.filter(item => item.enabled && item.configured).map(item => item.name),
      active_tools: activeTools.map(item => item.tool),
      safe: profileViolations.length === 0,
    };
    cachedCapabilities = { value, expiresAt: Date.now() + config.hermesCapabilityTtlMs };
    return value;
  }

  async function stopRun(runId) {
    try {
      await request(`/runs/${encodeURIComponent(runId)}/stop`, {
        method: 'POST', body: {}, retries: 0, idempotencyKey: `stop-${runId}`,
      });
      return true;
    } catch { return false; }
  }

  async function runAgent({ input, instructions, sessionId, sessionKey, conversationHistory = [], signal, idempotencyKey, onSubmitted } = {}) {
    const startedAt = Date.now();
    let runId = null;
    let attempts = 0;
    try {
      const capabilitySnapshot = await handshake({ signal });
      const submit = await request('/runs', {
        method: 'POST',
        body: {
          model: config.hermesModel,
          input,
          instructions,
          session_id: sessionId,
          conversation_history: conversationHistory,
        },
        headers: {
          ...(sessionId ? { 'X-Hermes-Session-Id': sessionId } : {}),
          ...(sessionKey ? { 'X-Hermes-Session-Key': sessionKey } : {}),
        },
        signal,
        idempotencyKey: idempotencyKey || crypto.randomUUID(),
      });
      attempts += submit.attempts;
      const submitted = validate('runStart', submit.data);
      runId = submitted.run_id;
      if (onSubmitted) await onSubmitted(runId);

      while (true) {
        if (signal?.aborted) throw abortError();
        if (Date.now() - startedAt >= config.hermesTimeoutMs) {
          throw new HermesError('HERMES_RUN_TIMEOUT', 'Hermes did not complete the run in time', { status: 504 });
        }
        await abortableDelay(config.hermesPollIntervalMs, signal, sleepImpl);
        const polled = await request(`/runs/${encodeURIComponent(runId)}`, { signal });
        attempts += polled.attempts;
        const state = validate('runStatus', polled.data);
        if (state.run_id !== runId) {
          throw new HermesError('HERMES_PROTOCOL_ERROR', 'Hermes returned a mismatched run identifier', { status: 502 });
        }
        if (state.status === 'completed') {
          if (typeof state.output !== 'string' || !state.output.trim()) {
            throw new HermesError('HERMES_INVALID_OUTPUT', 'Hermes returned an empty response', { status: 502 });
          }
          const usage = {
            prompt_tokens: state.usage?.input_tokens || 0,
            completion_tokens: state.usage?.output_tokens || 0,
            total_tokens: state.usage?.total_tokens || 0,
          };
          return {
            runId, output: state.output, model: state.model || config.hermesModel,
            usage, attempts, latencyMs: Date.now() - startedAt, capabilities: capabilitySnapshot,
          };
        }
        if (state.status === 'pending_approval') {
          throw new HermesError('HERMES_APPROVAL_REQUIRED', 'Hermes requested an unsupported host-tool approval', { status: 503 });
        }
        if (state.status === 'failed') {
          throw new HermesError('HERMES_RUN_FAILED', 'Hermes could not complete the run', { status: 502 });
        }
        if (state.status === 'cancelled') throw abortError();
      }
    } catch (error) {
      if (runId) await stopRun(runId);
      if (error && typeof error === 'object') {
        error.hermesRunId = runId;
        error.attempts = attempts + (error.attempts || 0);
        error.latencyMs = Date.now() - startedAt;
      }
      throw error;
    }
  }

  return { baseUrl, handshake, request, runAgent, stopRun };
}

let singleton;
let singletonKey;
function defaultHermesClient() {
  const config = runtimeConfig();
  const key = JSON.stringify({
    url: config.hermesUrl, key: config.hermesApiKey, model: config.hermesModel,
    retries: config.hermesRetries, timeout: config.hermesTimeoutMs,
    requestTimeout: config.hermesRequestTimeoutMs, poll: config.hermesPollIntervalMs,
    ttl: config.hermesCapabilityTtlMs, strict: config.hermesStrictCapabilities,
    enforceSafe: config.hermesEnforceSafeToolsets, forbidden: config.hermesForbiddenTools,
    requireToolless: config.hermesRequireToollessProfile,
  });
  if (!singleton || key !== singletonKey) {
    singleton = createHermesClient({ config });
    singletonKey = key;
  }
  return singleton;
}

module.exports = { createHermesClient, defaultHermesClient, isForbiddenTool, normalizedBaseUrl };
