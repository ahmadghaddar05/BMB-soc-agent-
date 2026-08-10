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

test('Phase 5 migration links incidents to Hermes runs and removes legacy provider settings', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/005_hermes_correlation.sql'), 'utf8');
  assert.match(sql, /incidents ADD COLUMN IF NOT EXISTS correlation_run_id/);
  assert.match(sql, /incidents_correlation_run_fk/);
  assert.match(sql, /idx_incidents_correlation_run_id/);
  assert.match(sql, /llm_provider','groq_model','anthropic_model','ollama_model/);
  assert.match(sql, /WHERE key='correlation_enabled'/);
});

test('Phase 6 migration creates durable investigation and case workflow records', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/006_durable_workflows.sql'), 'utf8');
  for (const table of ['investigations', 'investigation_alerts', 'investigation_notes', 'case_notes']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /incidents ADD COLUMN IF NOT EXISTS owner/);
  assert.match(sql, /investigation_alerts[\s\S]+REFERENCES alerts\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /investigation_notes[\s\S]+ON DELETE CASCADE/);
  assert.match(sql, /case_notes[\s\S]+ON DELETE CASCADE/);
  assert.match(sql, /evidence_type IN \([\s\S]+'investigation','case'/);
});

test('Phase 7 migration activates controlled action policy and approval records', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/007_controlled_actions.sql'), 'utf8');
  for (const column of ['policy_version', 'approval_required', 'idempotency_key', 'executed_at', 'executed_by', 'result', 'error_code']) {
    assert.match(sql, new RegExp(`action_requests ADD COLUMN IF NOT EXISTS ${column}`));
  }
  assert.match(sql, /action_requests_idempotency_key_unique/);
  assert.match(sql, /action_approvals_one_decision/);
  assert.match(sql, /investigation\.create/);
  assert.match(sql, /investigation\.update/);
  assert.match(sql, /action_request/);
});

test('Phase 8 migration creates durable autonomous runs and idempotent operations', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/008_autonomous_soc_agent.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS autonomous_runs/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS autonomous_operations/);
  assert.match(sql, /operation_key TEXT NOT NULL UNIQUE/);
  assert.match(sql, /request_case_assignment/);
  assert.match(sql, /autonomous_agent_enabled','false'/);
  assert.match(sql, /fetch_runs ADD COLUMN IF NOT EXISTS autonomous_run_id/);
});

test('Phase 9 migration creates approval-gated reversible response simulation records', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/009_simulated_response.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS simulated_response_states/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS simulated_response_events/);
  assert.match(sql, /response\.simulate/);
  assert.match(sql, /response\.rollback/);
  assert.match(sql, /request_simulated_response/);
  assert.match(sql, /simulated_response_proposals_enabled','false'/);
  assert.match(sql, /state IN \('active','reverted'\)/);
});

test('raw-event evidence migration preserves existing evidence types and adds durable citations', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/010_raw_event_evidence.sql'), 'utf8');
  for (const evidenceType of [
    'alert', 'incident', 'investigation', 'case', 'action_request',
    'autonomous_run', 'simulated_response', 'raw_event',
  ]) {
    assert.match(sql, new RegExp(`'${evidenceType}'`));
  }
  assert.match(sql, /DROP CONSTRAINT IF EXISTS agent_evidence_links_evidence_type_check/);
  assert.match(sql, /ADD CONSTRAINT agent_evidence_links_evidence_type_check/);
});

test('executive metric migration adds durable service mappings and response milestones', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/011_executive_metrics.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS business_service_mappings/);
  assert.match(sql, /Identity & Authentication/);
  assert.match(sql, /Core Banking/);
  assert.match(sql, /incidents ADD COLUMN IF NOT EXISTS first_response_at/);
  assert.match(sql, /incidents ADD COLUMN IF NOT EXISTS resolved_at/);
  assert.match(sql, /incident\.status_updated','case\.updated','case\.note_added/);
});

test('database RBAC migration creates role-bound users without storing plaintext passwords', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/012_database_rbac_users.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS app_users/);
  assert.match(sql, /role IN \('executive', 'soc_analyst', 'administrator'\)/);
  assert.match(sql, /password_hash TEXT NOT NULL/);
  assert.match(sql, /session_version INTEGER NOT NULL/);
  assert.match(sql, /UNIQUE INDEX IF NOT EXISTS app_users_username_unique[\s\S]+LOWER\(username\)/);
  assert.doesNotMatch(sql, /password\s+TEXT/i);
});

test('AI model profile migration selects the existing Hermes route by default', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/013_ai_model_profiles.sql'), 'utf8');
  assert.match(sql, /ai_model_profile/);
  assert.match(sql, /gpt_5_6_sol/);
  assert.match(sql, /ON CONFLICT\(key\) DO NOTHING/);
  assert.doesNotMatch(sql, /API_KEY\s*=/);
});

test('live collection migration enables AI-independent alert ingestion by default', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/014_live_elastic_collection.sql'), 'utf8');
  assert.match(sql, /live_collection_enabled','true/);
  assert.match(sql, /live_collection_interval_seconds','15/);
  assert.match(sql, /ON CONFLICT\(key\) DO NOTHING/);
});

test('workflow provenance migration creates an append-only explainability ledger', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/015_workflow_provenance.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS workflow_stage_events/);
  for (const stage of [
    'collected', 'normalized', 'enriched', 'triaged',
    'correlated', 'incident_decision',
  ]) {
    assert.match(sql, new RegExp(`'${stage}'`));
  }
  for (const executor of ['system', 'ai', 'analyst', 'cache']) {
    assert.match(sql, new RegExp(`'${executor}'`));
  }
  assert.match(sql, /idempotency_key TEXT NOT NULL UNIQUE/);
  assert.match(sql, /confidence >= 0 AND confidence <= 1/);
  assert.match(sql, /REFERENCES agent_runs\(id\) ON DELETE SET NULL/);
  assert.match(sql, /REFERENCES fetch_runs\(id\) ON DELETE SET NULL/);
});

test('alert retention migration defines severity policy and a durable run ledger', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/016_alert_retention.sql'), 'utf8');
  assert.match(sql, /alert_retention_critical_days','14'/);
  assert.match(sql, /alert_retention_high_days','10'/);
  assert.match(sql, /alert_retention_default_days','7'/);
  assert.match(sql, /alert_retention_enabled','false'/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS alert_retention_runs/);
  assert.match(sql, /initial_7_day_purge/);
  assert.match(sql, /COALESCE\(last_seen,timestamp,fetched_at\)/);
});

test('correlation workflow completion migration activates correlation and replays recent triage', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../src/db/migrations/017_correlation_workflow_completion.sql'),
    'utf8'
  );
  assert.match(sql, /VALUES \('correlation_enabled','true',NOW\(\)\)/);
  assert.match(sql, /VALUES \('correlation_cursor_json','',NOW\(\)\)/);
  assert.match(sql, /ON CONFLICT\(key\) DO UPDATE/);
});

test('analyst review migration creates an append-only correction ledger', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../src/db/migrations/018_analyst_decision_reviews.sql'),
    'utf8'
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS analyst_decision_reviews/);
  assert.match(sql, /'confirmed','challenged','needs_more_evidence'/);
  assert.match(sql, /char_length\(reason\) BETWEEN 10 AND 1000/);
  assert.match(sql, /idx_analyst_decision_reviews_entity/);
});

test('correlation capacity migration matches triage throughput and replays unprocessed alerts', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../src/db/migrations/019_correlation_backlog_capacity.sql'),
    'utf8'
  );
  assert.match(sql, /correlation_enabled','true'/);
  assert.match(sql, /correlation_new_alerts_per_cycle','50'/);
  assert.match(sql, /correlation_initial_alerts','40'/);
  assert.match(sql, /NOT EXISTS/);
  assert.match(sql, /w\.stage='correlated'/);
  assert.match(sql, /INTERVAL '7 days'/);
  assert.match(sql, /correlation_cursor_json/);
});

test('managed connector migration stores encrypted credentials and enforces one active source', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../src/db/migrations/020_managed_connectors.sql'),
    'utf8'
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS source_connectors/);
  assert.match(sql, /secret_ciphertext TEXT NOT NULL/);
  assert.match(sql, /secret_iv TEXT NOT NULL/);
  assert.match(sql, /secret_tag TEXT NOT NULL/);
  assert.match(sql, /collection_state JSONB NOT NULL/);
  assert.match(sql, /WHERE active = TRUE/);
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
