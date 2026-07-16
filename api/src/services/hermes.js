'use strict';

const { runtimeConfig } = require('../config');
const { defaultHermesClient } = require('./hermes/client');
const { chatHermes } = require('./hermes/chat');
const { TOOL_SPECS } = require('./hermes/soc-tools');

async function checkHermesHealth() {
  const config = runtimeConfig();
  if (!config.hermesApiKey) {
    return { status: 'disabled', configured: false, reachable: false, safe: false };
  }
  const started = Date.now();
  try {
    const snapshot = await defaultHermesClient().handshake({ force: true });
    return {
      status: 'online', configured: true, reachable: true, safe: snapshot.safe,
      latency_ms: snapshot.latency_ms, model: snapshot.model,
      advertised_models: snapshot.advertised_models.length,
      active_toolsets: snapshot.active_toolsets,
      active_tools: snapshot.active_tools,
      application_tool_mode: 'bounded_read_only',
      application_tool_count: TOOL_SPECS.length,
      application_tools: TOOL_SPECS.map(tool => tool.name),
      capabilities: snapshot.features,
    };
  } catch (error) {
    const unreachable = ['HERMES_UNAVAILABLE', 'HERMES_REQUEST_TIMEOUT'].includes(error?.code);
    return {
      status: 'degraded', configured: true, reachable: !unreachable, safe: false,
      latency_ms: Date.now() - started, model: config.hermesModel,
      error_code: error?.code || 'HERMES_UNAVAILABLE',
      error: error?.message || 'Hermes health check failed',
    };
  }
}

module.exports = { chatHermes, checkHermesHealth };
