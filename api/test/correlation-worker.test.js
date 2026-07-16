'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { correlatePending, incidentKey, upsertIncident } = require('../src/workers/correlation');

const originalQuery = db.query;
const originalSetSetting = db.setSetting;

test.afterEach(() => {
  db.query = originalQuery;
  db.setSetting = originalSetSetting;
});

function incident() {
  return {
    title: 'Connected alerts', severity: 'high', confidence: 0.8,
    alert_ids: ['A', 'B'], attack_stages: [],
    common_entities: { users: ['maya'], hosts: [], ips: [] },
    narrative: 'A and B share maya.', recommended_actions: ['Validate maya activity'],
  };
}

test('incident identity is versioned, deterministic, and order independent', () => {
  assert.equal(incidentKey(['A', 'B']), incidentKey(['B', 'A']));
  assert.notEqual(incidentKey(['A']), incidentKey(['A', 'B']));
});

test('existing incident retains its stable key and narrative when membership is unchanged', async () => {
  const queries = [];
  db.query = async (sql, params) => {
    queries.push({ sql:String(sql), params });
    if (String(sql).includes("status='open'")) return { rows:[{
      id: 4, incident_key: 'stable-key', alert_ids: ['A', 'B'], attack_stages: [],
      severity: 'high', confidence: 0.7, title: 'Original title', narrative: 'Original narrative',
      recommended_actions: ['Original action'], common_entities: { users: ['maya'] },
    }] };
    return { rows:[], rowCount:1 };
  };
  const result = await upsertIncident(
    { ...incident(), title: 'Churned title', narrative: 'Churned narrative' },
    '2026-07-16T10:00:00.000Z', '2026-07-16T10:01:00.000Z', 5, 'run-id', ['A']
  );
  assert.equal(result.status, 'unchanged');
  const update = queries.find(call => call.sql.includes('UPDATE incidents'));
  assert.equal(update.params[4], 'Original title');
  assert.equal(update.params[5], 'Original narrative');
  assert.doesNotMatch(update.sql, /incident_key=/);
});

test('overlap with multiple open incidents fails closed', async () => {
  db.query = async () => ({ rows:[{ id:1 }, { id:2 }] });
  await assert.rejects(
    upsertIncident(incident(), '2026-07-16T10:00:00Z', '2026-07-16T10:01:00Z', null, 'run'),
    error => error.code === 'CORRELATION_AMBIGUOUS_OVERLAP'
  );
});

test('cursor advances only after Hermes output and incident persistence succeed', async () => {
  const fresh = [
    { id:'A', timestamp:'2026-07-16T10:00:00Z', triaged_at:'2026-07-16T10:02:00Z', username:'maya', rule_level:12 },
    { id:'B', timestamp:'2026-07-16T10:01:00Z', triaged_at:'2026-07-16T10:03:00Z', username:'maya', rule_level:12 },
    { id:'C', timestamp:'2026-07-16T10:02:00Z', triaged_at:'2026-07-16T10:04:00Z', username:'maya', rule_level:12 },
  ];
  const settingsWritten = [];
  db.query = async sql => {
    const text = String(sql);
    if (text.includes('FROM alerts') && text.includes('COALESCE(triaged_at')) return { rows:fresh };
    if (text.includes('FROM alerts')) return { rows:[] };
    if (text.includes('INSERT INTO incidents')) return { rows:[{ id:9, inserted:true, status:'open' }] };
    if (text.includes("status='open'")) return { rows:[] };
    if (text.includes('WHERE incident_key=$1')) return { rows:[] };
    throw new Error(`Unexpected query: ${text}`);
  };
  db.setSetting = async (key, value) => settingsWritten.push([key, value]);
  const correlate = async (_candidates, _freshIds, _settings, options) => ({
    ...(await options.persist([incident()], 'correlation-run')),
    total_tokens: 12, prompt_tokens: 8, completion_tokens: 4,
    run_id: 'correlation-run', hermes_run_id: 'hermes-run',
  });
  const result = await correlatePending({ correlation_max_alerts:'2' }, 7, { correlate });
  assert.equal(result.incidents_created, 1);
  assert.equal(result.new_alerts, 2);
  assert.equal(settingsWritten.length, 1);
  assert.equal(JSON.parse(settingsWritten[0][1])[1], 'B');

  settingsWritten.length = 0;
  await assert.rejects(correlatePending({ correlation_max_alerts:'2' }, 7, {
    correlate: async () => { throw new Error('Hermes failed'); },
  }), /Hermes failed/);
  assert.equal(settingsWritten.length, 0);
});
