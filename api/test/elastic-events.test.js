'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAlert, normalizeRawEvent, searchEvents } = require('../src/services/elastic');
const { publicAlert } = require('../src/services/hermes/soc-tools');

test('raw event search uses fixed indices, allowlisted fields, exact filters, and hard bounds', async t => {
  const previous = {
    url: process.env.ELASTICSEARCH_URL,
    key: process.env.ELASTIC_API_KEY,
    indices: process.env.ELASTIC_EVENT_INDICES,
  };
  t.after(() => {
    if (previous.url === undefined) delete process.env.ELASTICSEARCH_URL;
    else process.env.ELASTICSEARCH_URL = previous.url;
    if (previous.key === undefined) delete process.env.ELASTIC_API_KEY;
    else process.env.ELASTIC_API_KEY = previous.key;
    if (previous.indices === undefined) delete process.env.ELASTIC_EVENT_INDICES;
    else process.env.ELASTIC_EVENT_INDICES = previous.indices;
  });
  process.env.ELASTICSEARCH_URL = 'https://elastic.example:9200';
  process.env.ELASTIC_API_KEY = 'test-key';
  process.env.ELASTIC_EVENT_INDICES = 'logs-*';
  const calls = [];
  const request = async (url, body) => {
    calls.push({ url, body });
    return { hits:{ hits:[{
      _index:'logs-edr.endpoint-default', _id:'doc-1', fields:{
        '@timestamp':['2026-07-17T08:00:00Z'], 'event.id':['event-1'],
        'event.kind':['event'], 'event.dataset':['edr.endpoint'],
        'event.action':['prohibited-website-access'], 'user.name':['maya.georges'],
        'policy.violation':[true], 'policy.security_alert':[false],
      },
    }] } };
  };
  const events = await searchEvents({
    username:'maya.georges', policy_violation:true, hours:999, limit:999,
  }, { request });
  assert.equal(events[0].id, 'logs-edr.endpoint-default:doc-1');
  assert.equal(events[0].policy.security_alert, false);
  assert.match(calls[0].url, /\/logs-\*\/_search/);
  assert.equal(calls[0].body.size, 25);
  assert.deepEqual(calls[0].body.query.bool.filter[0], {
    range:{ '@timestamp':{ gte:'now-168h', lte:'now' } },
  });
  assert.ok(calls[0].body.fields.includes('policy.violation'));
  assert.equal(calls[0].body._source, false);
  assert.doesNotMatch(JSON.stringify(calls[0].body), /query_string|script|runtime_mappings/);
});

test('raw event search rejects model-independent unsafe index configuration', async t => {
  const previous = {
    url: process.env.ELASTICSEARCH_URL,
    key: process.env.ELASTIC_API_KEY,
    indices: process.env.ELASTIC_EVENT_INDICES,
  };
  t.after(() => {
    if (previous.url === undefined) delete process.env.ELASTICSEARCH_URL;
    else process.env.ELASTICSEARCH_URL = previous.url;
    if (previous.key === undefined) delete process.env.ELASTIC_API_KEY;
    else process.env.ELASTIC_API_KEY = previous.key;
    if (previous.indices === undefined) delete process.env.ELASTIC_EVENT_INDICES;
    else process.env.ELASTIC_EVENT_INDICES = previous.indices;
  });
  process.env.ELASTICSEARCH_URL = 'https://elastic.example:9200';
  process.env.ELASTIC_API_KEY = 'test-key';
  process.env.ELASTIC_EVENT_INDICES = '../_all';
  await assert.rejects(
    searchEvents({ username:'maya.georges' }, { request:async () => ({}) }),
    /ELASTIC_EVENT_INDICES contains invalid characters/
  );
});

test('public alert evidence exposes only allowlisted technical context from stored Elastic fields', () => {
  const alert = publicAlert({
    id:'elastic:alert-1', source_system:'elastic', full_log:'Observed process evidence',
    raw:{ fields:{
      'process.command_line':['powershell.exe -EncodedCommand SQBFAFgA'],
      'process.hash.sha256':['a'.repeat(64)],
      'process.parent.name':['WINWORD.EXE'],
      'process.parent.command_line':['WINWORD.EXE invoice.docm'],
      'file.hash.sha256':['b'.repeat(64)],
      'authentication.session_id':['session-17'],
      'email.delivery_action':['quarantined'],
      'http.response.status_code':[403],
      'database.query':['SELECT * FROM users'],
      'evidence.profile':['bmb-edr-context-v1'],
      'evidence.answer_key_included':[false],
      'attack.campaign_id':['BMB-CAMPAIGN-17'],
      'correlation.session_id':['session-chain-17'],
      'correlation.sequence':[3],
      'policy.authorized':[true],
      'policy.reason':['Approved maintenance'],
      'change.id':['CHG-482204'],
      'change.approved':[true],
      'expected_verdict':['true_positive'],
    } },
  });
  assert.equal(alert.observed_summary, 'Observed process evidence');
  assert.equal(alert.technical_context.process.command_line, 'powershell.exe -EncodedCommand SQBFAFgA');
  assert.equal(alert.technical_context.parent_process.name, 'WINWORD.EXE');
  assert.equal(alert.technical_context.file.sha256, 'b'.repeat(64));
  assert.equal(alert.technical_context.authentication.session_id, 'session-17');
  assert.equal(alert.technical_context.email.delivery_action, 'quarantined');
  assert.equal(alert.technical_context.web.status_code, 403);
  assert.equal(alert.technical_context.database.query, 'SELECT * FROM users');
  assert.equal(alert.technical_context.evidence_quality.answer_key_included, false);
  assert.equal(alert.technical_context.correlation.campaign_id, 'BMB-CAMPAIGN-17');
  assert.equal(alert.technical_context.correlation.session_id, 'session-chain-17');
  assert.equal(alert.technical_context.correlation.sequence, 3);
  assert.equal(alert.technical_context.authorization_context.authorized, true);
  assert.equal(alert.technical_context.authorization_context.change_id, 'CHG-482204');
  assert.equal(alert.technical_context.authorization_context.change_approved, true);
  assert.doesNotMatch(JSON.stringify(alert), /expected_verdict|true_positive/);
});

test('Elastic normalization preserves source and rule-level ATT&CK mappings', () => {
  const alert = normalizeAlert({
    _index:'.alerts-security.alerts-default', _id:'alert-mitre-1', fields:{
      '@timestamp':['2026-08-19T08:00:00Z'],
      'kibana.alert.uuid':['alert-mitre-1'],
      'kibana.alert.rule.name':['Network movement chain'],
      'kibana.alert.severity':['high'],
      'threat.technique.id':['T1046'],
      'kibana.alert.rule.threat.technique.id':['T1021.002'],
      'threat.tactic.id':['TA0007'],
      'threat.tactic.name':['Discovery'],
      'kibana.alert.rule.threat.tactic.id':['TA0008'],
    },
  });
  assert.deepEqual(alert.mitre_techniques, ['T1046', 'T1021.002']);
  assert.deepEqual(alert.mitre_tactics, ['discovery', 'lateral_movement']);
});

test('Elastic normalization preserves generator attack metadata when the rule has no ATT&CK mapping', () => {
  const alert = normalizeAlert({
    _index:'.alerts-security.alerts-default', _id:'alert-generator-mitre', fields:{
      '@timestamp':['2026-08-19T08:00:00Z'],
      'kibana.alert.uuid':['alert-generator-mitre'],
      'kibana.alert.rule.name':['Generated C2 detection'],
      'kibana.alert.severity':['high'],
      'attack.tactic_id':['TA0011'],
      'attack.tactic_name':['Command and Control'],
      'attack.technique_id':['T1071.001'],
      'attack.stage':['command_and_control'],
    },
  });
  assert.deepEqual(alert.mitre_techniques, ['T1071.001']);
  assert.deepEqual(alert.mitre_tactics, ['command_and_control']);
});

test('raw Elastic evidence exposes ATT&CK path and observed control state', () => {
  const event = normalizeRawEvent({
    _index:'logs-edr.endpoint-default', _id:'event-mitre-1', fields:{
      '@timestamp':['2026-08-19T08:00:00Z'],
      'attack.campaign_id':['BMB-FULL-CHAIN-1'],
      'attack.stage':['lateral_movement'],
      'attack.tactic_id':['TA0008'],
      'attack.tactic_name':['Lateral Movement'],
      'attack.technique_id':['T1021.002'],
      'attack.technique_name':['SMB/Windows Admin Shares'],
      'attack.observed_state':['detected-active'],
      'security_control.status':['detected'],
      'security_control.action':['detect'],
      'security_control.observed':[true],
    },
  });
  assert.equal(event.campaign.technique_id, 'T1021.002');
  assert.equal(event.campaign.tactic_id, 'TA0008');
  assert.equal(event.campaign.observed_state, 'detected-active');
  assert.deepEqual(event.security_control, { status:'detected', action:'detect', observed:true });
});

test('public alert reads correlation evidence from nested non-Elastic raw records', () => {
  const alert = publicAlert({
    id:'splunk:mitre-1', source_system:'splunk', raw:{
      attack:{
        campaign_id:'BMB-SPLUNK-CHAIN-1', stage:'discovery', tactic_id:'TA0007',
        tactic_name:'Discovery', technique_id:'T1046',
        technique_name:'Network Service Discovery', observed_state:'detected-active',
      },
      correlation:{ session_id:'session-1', sequence:4, path_position:4, path_length:8 },
      security_control:{ status:'detected', action:'detect', observed:true },
    },
  });
  assert.equal(alert.technical_context.correlation.campaign_id, 'BMB-SPLUNK-CHAIN-1');
  assert.equal(alert.technical_context.correlation.technique_id, 'T1046');
  assert.equal(alert.technical_context.correlation.path_position, 4);
  assert.equal(alert.technical_context.security_control.status, 'detected');
});
