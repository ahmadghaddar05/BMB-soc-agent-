'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  configuredSinceHours,
  missingMappings,
  normalizeStoredAlert,
} = require('../src/scripts/backfill-mitre-mappings');

test('MITRE backfill accepts a bounded recent-alert window', () => {
  const previous = process.env.MITRE_BACKFILL_SINCE_HOURS;
  process.env.MITRE_BACKFILL_SINCE_HOURS = '72';
  try {
    assert.equal(configuredSinceHours(), 72);
  } finally {
    if (previous == null) delete process.env.MITRE_BACKFILL_SINCE_HOURS;
    else process.env.MITRE_BACKFILL_SINCE_HOURS = previous;
  }
});

test('MITRE backfill recovers generator metadata from stored Elastic raw fields', () => {
  const row = {
    id:'elastic:generator-1',
    source_system:'elastic',
    source_index:'.alerts-security.alerts-default',
    mitre_techniques:[],
    mitre_tactics:[],
    raw:{ fields:{
      '@timestamp':['2026-08-19T08:00:00Z'],
      'kibana.alert.uuid':['generator-1'],
      'kibana.alert.rule.name':['Generated C2 detection'],
      'kibana.alert.severity':['high'],
      'attack.tactic_id':['TA0011'],
      'attack.technique_id':['T1071.001'],
    } },
  };
  const mapping = missingMappings(row, normalizeStoredAlert(row));
  assert.deepEqual(mapping.techniques, ['T1071.001']);
  assert.deepEqual(mapping.tactics, ['command_and_control']);
});

test('MITRE backfill does not replace an existing stored mapping', () => {
  const mapping = missingMappings({
    mitre_techniques:['T1021.002'], mitre_tactics:['lateral_movement'],
  }, {
    mitre_techniques:['T1071.001'], mitre_tactics:['command_and_control'],
  });
  assert.equal(mapping, null);
});
