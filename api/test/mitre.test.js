'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mitre = require('../src/services/mitre');

test('maps generator ATT&CK techniques into the canonical tactic sequence', () => {
  const mappings = mitre.alertMappings({
    mitre_techniques:['T1190', 'T1059.001', 'T1046'],
    mitre_tactics:['Initial Access', 'Execution', 'Discovery'],
  });

  assert.deepEqual(mappings.map(item => item.tacticId), ['TA0001', 'TA0002', 'TA0007']);
  assert.equal(mappings[0].techniques[0].name, 'Exploit Public-Facing Application');
  assert.equal(mappings[1].techniques[0].id, 'T1059.001');
});

test('maps every generator-only ATT&CK stage and can recover mappings from stored raw evidence', () => {
  const mappings = mitre.alertMappings({
    mitre_techniques:[], mitre_tactics:[],
    raw:{ fields:{
      'attack.tactic_id':['TA0011'],
      'attack.technique_id':['T1071.001'],
    } },
  });
  assert.equal(mitre.TACTICS.length, 12);
  assert.equal(mappings[0].tacticId, 'TA0011');
  assert.equal(mappings[0].techniques[0].name, 'Web Protocols');
});

test('marks containment only when source evidence records a preventive outcome', () => {
  const aiOnly = {
    verdict:{ verdict:'true_positive', recommended_actions:['isolate endpoint'] },
    raw:{ event:{ outcome:'success' } },
  };
  const prevented = {
    verdict:{ verdict:'needs_investigation' },
    raw:{ security_control:{ status:'blocked' } },
  };

  assert.equal(mitre.alertState(aiOnly), 'detected-confirmed');
  assert.equal(mitre.alertState(prevented), 'contained');
});

test('builds the incident matrix and timeline from the same mapped alert records', () => {
  const incident = mitre.buildIncident({
    id:7,
    title:'Credential attack path',
    severity:'critical',
    status:'open',
    created_at:'2026-08-18T08:00:00Z',
    first_seen:'2026-08-18T08:00:00Z',
    last_seen:'2026-08-18T08:10:00Z',
  }, [
    {
      id:'alert-1', timestamp:'2026-08-18T08:00:00Z', rule_desc:'Password spray',
      source_severity:'high', mitre_techniques:['T1110.003'], mitre_tactics:['Credential Access'],
      verdict:{ verdict:'true_positive', confidence:.92 }, raw:{ event:{ outcome:'success' } },
    },
    {
      id:'alert-2', timestamp:'2026-08-18T08:10:00Z', rule_desc:'SMB movement blocked',
      source_severity:'critical', mitre_techniques:['T1021.002'], mitre_tactics:['Lateral Movement'],
      verdict:{ verdict:'true_positive', confidence:.96 }, raw:{ security_control:{ status:'prevented' } },
    },
  ], [{
    entity_id:'alert-1', confidence:.92, model:'llama-3.3-70b-instruct',
    reason:'Repeated failures followed by a successful privileged login.',
    input_summary:{ events:12 }, output_summary:{ verdict:'true_positive' }, limitations:[],
  }]);

  assert.equal(incident.reference, 'INC-00007');
  assert.equal(incident.alertCount, 2);
  assert.equal(incident.stageCount, 2);
  assert.equal(incident.alerts[0].state, 'detected-confirmed');
  assert.equal(incident.alerts[1].state, 'contained');
  assert.equal(incident.alerts[0].decisionTrace.model, 'llama-3.3-70b-instruct');
});

test('coverage always returns every curated tactic and names real gaps', () => {
  const result = mitre.coverage([
    { tactic_key:'credential_access', total_alert_count:14, incident_count:3, detection_count:2 },
    { tactic_key:'TA0008', total_alert_count:5, incident_count:2, detection_count:1 },
  ], '90');

  assert.equal(result.tactics.length, 12);
  assert.equal(result.tactics.find(item => item.id === 'TA0006').totalAlertCount, 14);
  assert.equal(result.tactics.find(item => item.id === 'TA0008').incidentCount, 2);
  assert.match(result.summary, /2 of 12 tactics/);
  assert.match(result.summary, /Reconnaissance/);
  assert.match(result.summary, /last 90 days/);
});

test('derives incident stage counts and coverage from technique-only evidence', () => {
  const rows = [{
    incident_id:7, alert_id:'alert-1', rule_id:'c2-rule',
    mitre_tactics:[], mitre_techniques:['T1071.001'], raw:{},
  }];
  assert.equal(mitre.stageCounts(rows).get('7'), 1);
  const result = mitre.coverageFromAlerts(rows, '90');
  assert.equal(result.tactics.find(item => item.id === 'TA0011').totalAlertCount, 1);
  assert.equal(result.tactics.find(item => item.id === 'TA0011').incidentCount, 1);
});
