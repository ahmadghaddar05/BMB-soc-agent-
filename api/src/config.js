'use strict';

const fs = require('fs');

function bool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function runtimeConfig(env = process.env) {
  return {
    nodeEnv: env.NODE_ENV || 'development',
    databaseUrl: env.DATABASE_URL || '',
    authDisabled: bool(env.SOC_AUTH_DISABLED, false),
    adminUsername: env.SOC_ADMIN_USERNAME || 'admin',
    adminPassword: env.SOC_ADMIN_PASSWORD || '',
    sessionSecret: env.SOC_SESSION_SECRET || '',
    apiKey: env.SOC_API_KEY || '',
    sessionTtlMinutes: Math.min(1440, Math.max(15, parseInt(env.SOC_SESSION_TTL_MINUTES || '480', 10) || 480)),
    cookieSecure: bool(env.SOC_COOKIE_SECURE, (env.NODE_ENV || 'development') === 'production'),
    allowedOrigins: String(env.SOC_ALLOWED_ORIGINS || '')
      .split(',').map(value => value.trim()).filter(Boolean),
    alertSource: env.ALERT_SOURCE || 'mock',
    elasticUrl: env.ELASTICSEARCH_URL || '',
    elasticApiKey: env.ELASTIC_API_KEY || '',
    elasticVerifyTls: bool(env.ELASTIC_VERIFY_TLS, true),
    elasticCaCert: env.ELASTIC_CA_CERT || '',
    wazuhMode: env.WAZUH_MODE || 'mock',
    wazuhUrl: env.WAZUH_INDEXER_URL || '',
    wazuhPassword: env.WAZUH_INDEXER_PASS || '',
    hermesRequired: bool(env.HERMES_REQUIRED, false),
    hermesUrl: env.HERMES_API_URL || 'http://host.docker.internal:8642/v1',
    hermesApiKey: env.HERMES_API_KEY || '',
    hermesModel: env.HERMES_MODEL || 'hermes-agent',
    hermesTimeoutMs: boundedInt(env.HERMES_TIMEOUT_MS, 180000, 10000, 600000),
    hermesRequestTimeoutMs: boundedInt(env.HERMES_REQUEST_TIMEOUT_MS, 10000, 1000, 60000),
    hermesRetries: boundedInt(env.HERMES_MAX_RETRIES, 2, 0, 5),
    hermesPollIntervalMs: boundedInt(env.HERMES_POLL_INTERVAL_MS, 500, 100, 5000),
    hermesCapabilityTtlMs: boundedInt(env.HERMES_CAPABILITY_TTL_MS, 60000, 5000, 3600000),
    hermesAnalystMaxToolCalls: boundedInt(env.HERMES_ANALYST_MAX_TOOL_CALLS, 4, 1, 8),
    hermesAnalystTimeoutMs: boundedInt(env.HERMES_ANALYST_TIMEOUT_MS, 240000, 10000, 600000),
    hermesToolTimeoutMs: boundedInt(env.HERMES_TOOL_TIMEOUT_MS, 10000, 1000, 60000),
    hermesToolResultMaxBytes: boundedInt(env.HERMES_TOOL_RESULT_MAX_BYTES, 65536, 4096, 262144),
    hermesStrictCapabilities: bool(env.HERMES_STRICT_CAPABILITIES, true),
    hermesEnforceSafeToolsets: bool(env.HERMES_ENFORCE_SAFE_TOOLSETS, true),
    hermesRequireToollessProfile: bool(env.HERMES_REQUIRE_TOOLLESS_PROFILE, true),
    hermesForbiddenTools: String(env.HERMES_FORBIDDEN_TOOLS ||
      'terminal,execute_code,write_file,patch,delete_file,move_file,browser,web_search,web_extract,delegate_task,cronjob,shell,ssh')
      .split(',').map(value => value.trim().toLowerCase()).filter(Boolean),
  };
}

function validHttpUrl(value) {
  try { return ['http:','https:'].includes(new URL(value).protocol); }
  catch { return false; }
}

function validateStartupConfig(config = runtimeConfig()) {
  const errors = [];
  const warnings = [];
  if (!config.databaseUrl) errors.push('DATABASE_URL is required');
  if (config.nodeEnv === 'production' && config.authDisabled) {
    errors.push('SOC_AUTH_DISABLED cannot be true in production');
  }
  if (!config.authDisabled) {
    if (config.sessionSecret.length < 32) errors.push('SOC_SESSION_SECRET must be at least 32 characters');
    if (config.adminPassword.length < 12) errors.push('SOC_ADMIN_PASSWORD must be at least 12 characters');
  }
  if (config.apiKey && config.apiKey.length < 24) warnings.push('SOC_API_KEY should be at least 24 characters');
  if (config.nodeEnv === 'production' && !config.cookieSecure) warnings.push('SOC_COOKIE_SECURE is false; use true when the UI is served over HTTPS');
  if (!['mock','elastic','wazuh'].includes(config.alertSource)) errors.push('ALERT_SOURCE must be mock, elastic, or wazuh');
  if (config.alertSource === 'elastic') {
    if (!config.elasticUrl) errors.push('ELASTICSEARCH_URL is required when ALERT_SOURCE=elastic');
    else if (!validHttpUrl(config.elasticUrl)) errors.push('ELASTICSEARCH_URL must be a valid HTTP(S) URL');
    if (!config.elasticApiKey) errors.push('ELASTIC_API_KEY is required when ALERT_SOURCE=elastic');
    if (config.elasticVerifyTls && !config.elasticCaCert) errors.push('ELASTIC_CA_CERT is required when Elastic TLS verification is enabled');
    else if (config.elasticVerifyTls && !fs.existsSync(config.elasticCaCert)) errors.push('ELASTIC_CA_CERT does not exist at the configured path');
  }
  if (config.alertSource === 'wazuh' && config.wazuhMode !== 'mock') {
    if (!config.wazuhUrl) errors.push('WAZUH_INDEXER_URL is required for a real Wazuh source');
    else if (!validHttpUrl(config.wazuhUrl)) errors.push('WAZUH_INDEXER_URL must be a valid HTTP(S) URL');
    if (!config.wazuhPassword) errors.push('WAZUH_INDEXER_PASS is required for a real Wazuh source');
  }
  if ((config.hermesRequired || config.hermesApiKey) && !validHttpUrl(config.hermesUrl)) {
    errors.push('HERMES_API_URL must be a valid HTTP(S) URL');
  }
  if (config.hermesRequired && !config.hermesApiKey) errors.push('HERMES_API_KEY is required when HERMES_REQUIRED=true');
  if (config.hermesRequired && !config.hermesStrictCapabilities) errors.push('HERMES_STRICT_CAPABILITIES must be true when HERMES_REQUIRED=true');
  if (config.hermesRequired && !config.hermesEnforceSafeToolsets) errors.push('HERMES_ENFORCE_SAFE_TOOLSETS must be true when HERMES_REQUIRED=true');
  if (config.hermesRequired && !config.hermesRequireToollessProfile) errors.push('HERMES_REQUIRE_TOOLLESS_PROFILE must be true when HERMES_REQUIRED=true');
  if (config.hermesApiKey && config.hermesApiKey.length < 8) errors.push('HERMES_API_KEY must be at least 8 characters');
  if (!/^[A-Za-z0-9._:/-]{1,200}$/.test(config.hermesModel)) errors.push('HERMES_MODEL contains unsupported characters');
  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { bool, boundedInt, runtimeConfig, validateStartupConfig };
