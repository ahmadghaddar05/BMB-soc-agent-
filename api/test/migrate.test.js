'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { migrationFiles, runMigrations } = require('../src/db/migrate');

test('migration files are versioned and sorted', () => {
  const files = migrationFiles();
  assert.ok(files.length >= 1);
  assert.deepEqual(files, [...files].sort());
  assert.ok(files.every(file => /^\d{3}_.+\.sql$/.test(file)));
});

test('consolidated schema supports fresh creation and idempotent metric upgrades', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_current_schema.sql'), 'utf8');
  for (const table of ['settings','alerts','incidents','fetch_runs','triage_cache']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  for (const column of ['llm_calls','llm_tokens','prompt_tokens','completion_tokens','correlation_calls','duration_ms']) {
    assert.match(sql, new RegExp(`ALTER TABLE fetch_runs ADD COLUMN IF NOT EXISTS ${column}`));
  }
  assert.match(sql, /ON CONFLICT\(key\) DO NOTHING/);
});

test('Hermes audit migration creates every durable agent and approval record', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/002_hermes_agent_audit.sql'), 'utf8');
  for (const table of [
    'agent_conversations', 'agent_messages', 'agent_runs', 'agent_tool_calls',
    'agent_evidence_links', 'action_requests', 'action_approvals', 'audit_events',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /agent_runs_idempotency_key_unique/);
  assert.match(sql, /provider = 'hermes'/);
});

test('grounded analyst migration records every Hermes sub-run durably', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/003_grounded_hermes_analyst.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS agent_run_steps/);
  assert.match(sql, /agent_run_steps_run_step_unique/);
  assert.match(sql, /agent_run_steps_hermes_run_unique/);
});

test('Phase 4 migration binds cache provenance and keeps unsafe automation disabled', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/004_hermes_triage.sql'), 'utf8');
  for (const column of [
    'alert_signature', 'prompt_version', 'output_schema_version',
    'enrichment_fingerprint', 'agent_run_id', 'expires_at',
  ]) {
    assert.match(sql, new RegExp(`triage_cache ADD COLUMN IF NOT EXISTS ${column}`));
  }
  assert.match(sql, /alerts ADD COLUMN IF NOT EXISTS triage_run_id/);
  assert.match(sql, /DELETE FROM triage_cache/);
  assert.match(sql, /autoclose_enabled','correlation_enabled','incident_promote_enabled/);
});

test('migration runner records every unapplied migration in one transaction', async () => {
  const calls = [];
  let released = false;
  const client = {
    async query(text, params) {
      calls.push({ text:String(text), params });
      if (String(text).includes('SELECT version FROM schema_migrations')) return { rows:[] };
      return { rows:[] };
    },
    release() { released = true; },
  };
  await runMigrations({ connect:async () => client }, { info() {} });
  assert.equal(calls[0].text, 'BEGIN');
  assert.equal(calls.at(-1).text, 'COMMIT');
  assert.equal(calls.filter(call => call.text.includes('INSERT INTO schema_migrations')).length, migrationFiles().length);
  assert.equal(released, true);
});
