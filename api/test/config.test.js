'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runtimeConfig, validateStartupConfig } = require('../src/config');

const base = {
  NODE_ENV:'test', DATABASE_URL:'postgres://test', ALERT_SOURCE:'mock',
  SOC_EXECUTIVE_USERNAME:'ciso', SOC_EXECUTIVE_PASSWORD:'executive-horse-battery',
  SOC_ANALYST_USERNAME:'analyst', SOC_ANALYST_PASSWORD:'analyst-horse-battery',
  SOC_ADMIN_USERNAME:'admin', SOC_ADMIN_PASSWORD:'admin-horse-battery',
  SOC_SESSION_SECRET:'0123456789abcdef0123456789abcdef',
};

test('mock startup configuration is valid without external alert credentials', () => {
  const result = validateStartupConfig(runtimeConfig(base));
  assert.equal(result.ok, true);
});

test('mode-specific source configuration fails before startup without required secrets', () => {
  const result = validateStartupConfig(runtimeConfig({ ...base, ALERT_SOURCE:'elastic' }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('ELASTICSEARCH_URL is required when ALERT_SOURCE=elastic'));
  assert.ok(result.errors.includes('ELASTIC_API_KEY is required when ALERT_SOURCE=elastic'));
});

test('production cannot disable authentication and warns when HTTPS cookies are disabled', () => {
  const result = validateStartupConfig(runtimeConfig({
    ...base, NODE_ENV:'production', SOC_AUTH_DISABLED:'true', SOC_COOKIE_SECURE:'false',
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('SOC_AUTH_DISABLED cannot be true in production'));
  assert.ok(result.warnings.some(message => message.includes('SOC_COOKIE_SECURE')));
});

test('all role accounts require strong passwords and unique usernames', () => {
  const weak = validateStartupConfig(runtimeConfig({ ...base, SOC_ANALYST_PASSWORD:'short' }));
  assert.equal(weak.ok, false);
  assert.ok(weak.errors.includes('SOC_ANALYST_PASSWORD must be at least 12 characters'));

  const duplicate = validateStartupConfig(runtimeConfig({ ...base, SOC_EXECUTIVE_USERNAME:'admin' }));
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.errors.includes('Role account usernames must be unique'));
});

test('Hermes-required startup fails closed without its server credential', () => {
  const result = validateStartupConfig(runtimeConfig({ ...base, HERMES_REQUIRED:'true' }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('HERMES_API_KEY is required when HERMES_REQUIRED=true'));
});

test('Hermes timing and retry settings are bounded', () => {
  const config = runtimeConfig({
    ...base, HERMES_TIMEOUT_MS:'99999999', HERMES_REQUEST_TIMEOUT_MS:'1',
    HERMES_MAX_RETRIES:'99', HERMES_POLL_INTERVAL_MS:'0',
    HERMES_ANALYST_MAX_TOOL_CALLS:'99', HERMES_ANALYST_TIMEOUT_MS:'1',
    HERMES_TRIAGE_MAX_TOOL_CALLS:'99', HERMES_TRIAGE_TIMEOUT_MS:'1',
    HERMES_CORRELATION_TIMEOUT_MS:'99999999',
    HERMES_TOOL_TIMEOUT_MS:'99999999', HERMES_TOOL_RESULT_MAX_BYTES:'1',
  });
  assert.equal(config.hermesTimeoutMs, 600000);
  assert.equal(config.hermesRequestTimeoutMs, 1000);
  assert.equal(config.hermesRetries, 5);
  assert.equal(config.hermesPollIntervalMs, 100);
  assert.equal(config.hermesAnalystMaxToolCalls, 8);
  assert.equal(config.hermesAnalystTimeoutMs, 10000);
  assert.equal(config.hermesTriageMaxToolCalls, 4);
  assert.equal(config.hermesTriageTimeoutMs, 10000);
  assert.equal(config.hermesCorrelationTimeoutMs, 600000);
  assert.equal(config.hermesToolTimeoutMs, 60000);
  assert.equal(config.hermesToolResultMaxBytes, 4096);
});

test('Splunk startup configuration fails without required credentials', () => {
  const result = validateStartupConfig(runtimeConfig({ ...base, ALERT_SOURCE:'splunk' }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('SPLUNK_URL is required when ALERT_SOURCE=splunk'));
  assert.ok(result.errors.includes('SPLUNK_TOKEN is required when ALERT_SOURCE=splunk'));
});
