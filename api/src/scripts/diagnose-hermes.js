'use strict';

const crypto = require('crypto');
const { runtimeConfig } = require('../config');
const { defaultHermesClient } = require('../services/hermes/client');

async function main() {
  const config = runtimeConfig();
  const report = {
    checked_at: new Date().toISOString(),
    configured: Boolean(config.hermesApiKey),
    endpoint: config.hermesUrl,
    configured_model: config.hermesModel,
    handshake: null,
    run: null,
  };

  if (!config.hermesApiKey) {
    report.run = { ok: false, code: 'HERMES_NOT_CONFIGURED', message: 'HERMES_API_KEY is not configured' };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const client = defaultHermesClient();
  try {
    const handshake = await client.handshake({ force: true });
    report.handshake = {
      ok: true,
      model: handshake.model,
      advertised_models: handshake.advertised_models,
      safe: handshake.safe,
      capabilities: handshake.features,
      latency_ms: handshake.latency_ms,
    };
  } catch (error) {
    report.handshake = {
      ok: false,
      code: error?.code || 'HERMES_UNAVAILABLE',
      message: error?.message || 'Hermes handshake failed',
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const result = await client.runAgent({
      input: 'Return the required JSON health response.',
      instructions: 'Return exactly this JSON object and no other text: {"status":"ok"}',
      sessionId: `bmb-diagnostic-${crypto.randomUUID()}`,
      sessionKey: `bmb-diagnostic:${crypto.randomUUID()}`,
      idempotencyKey: `bmb-diagnostic-${crypto.randomUUID()}`,
    });
    report.run = {
      ok: true,
      run_id: result.runId,
      model: result.model,
      latency_ms: result.latencyMs,
      usage: result.usage,
      output_valid: result.output.trim() === '{"status":"ok"}',
    };
  } catch (error) {
    report.run = {
      ok: false,
      code: error?.code || 'HERMES_UNAVAILABLE',
      message: error?.message || 'Hermes run failed',
      run_id: error?.hermesRunId || null,
      latency_ms: error?.latencyMs || null,
    };
    process.exitCode = 1;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({
    checked_at: new Date().toISOString(),
    configured: false,
    run: { ok: false, code: 'DIAGNOSTIC_FAILED', message: error?.message || 'Diagnostic failed' },
  }, null, 2)}\n`);
  process.exitCode = 1;
});
