'use strict';

const TACTICS = Object.freeze([
  { id:'TA0043', name:'Reconnaissance', key:'reconnaissance', order:1 },
  { id:'TA0001', name:'Initial Access', key:'initial_access', order:2 },
  { id:'TA0002', name:'Execution', key:'execution', order:3 },
  { id:'TA0003', name:'Persistence', key:'persistence', order:4 },
  { id:'TA0004', name:'Privilege Escalation', key:'privilege_escalation', order:5 },
  { id:'TA0006', name:'Credential Access', key:'credential_access', order:6 },
  { id:'TA0007', name:'Discovery', key:'discovery', order:7 },
  { id:'TA0008', name:'Lateral Movement', key:'lateral_movement', order:8 },
  { id:'TA0009', name:'Collection', key:'collection', order:9 },
  { id:'TA0010', name:'Exfiltration', key:'exfiltration', order:10 },
  { id:'TA0040', name:'Impact', key:'impact', order:11 },
]);

const TACTIC_BY_KEY = new Map(TACTICS.flatMap(tactic => [
  [tactic.key, tactic],
  [tactic.id.toLowerCase(), tactic],
]));

const TECHNIQUES = Object.freeze({
  T1595:{ name:'Active Scanning', tactic:'reconnaissance' },
  T1190:{ name:'Exploit Public-Facing Application', tactic:'initial_access' },
  T1566:{ name:'Phishing', tactic:'initial_access' },
  'T1566.001':{ name:'Spearphishing Attachment', tactic:'initial_access' },
  'T1566.002':{ name:'Spearphishing Link', tactic:'initial_access' },
  T1078:{ name:'Valid Accounts', tactic:'initial_access' },
  T1059:{ name:'Command and Scripting Interpreter', tactic:'execution' },
  'T1059.001':{ name:'PowerShell', tactic:'execution' },
  'T1059.004':{ name:'Unix Shell', tactic:'execution' },
  'T1059.005':{ name:'Visual Basic', tactic:'execution' },
  T1505:{ name:'Server Software Component', tactic:'persistence' },
  'T1505.003':{ name:'Web Shell', tactic:'persistence' },
  'T1547.001':{ name:'Registry Run Keys / Startup Folder', tactic:'persistence' },
  T1098:{ name:'Account Manipulation', tactic:'persistence' },
  'T1136.001':{ name:'Create Account: Local Account', tactic:'persistence' },
  T1068:{ name:'Exploitation for Privilege Escalation', tactic:'privilege_escalation' },
  'T1484.001':{ name:'Group Policy Modification', tactic:'privilege_escalation' },
  'T1003.001':{ name:'LSASS Memory', tactic:'credential_access' },
  'T1003.006':{ name:'DCSync', tactic:'credential_access' },
  'T1110.001':{ name:'Password Guessing', tactic:'credential_access' },
  'T1110.003':{ name:'Password Spraying', tactic:'credential_access' },
  'T1558.003':{ name:'Kerberoasting', tactic:'credential_access' },
  T1046:{ name:'Network Service Discovery', tactic:'discovery' },
  T1087:{ name:'Account Discovery', tactic:'discovery' },
  'T1021.001':{ name:'Remote Desktop Protocol', tactic:'lateral_movement' },
  'T1021.002':{ name:'SMB / Windows Admin Shares', tactic:'lateral_movement' },
  'T1074.001':{ name:'Local Data Staging', tactic:'collection' },
  T1114:{ name:'Email Collection', tactic:'collection' },
  T1025:{ name:'Data from Removable Media', tactic:'collection' },
  'T1560.001':{ name:'Archive via Utility', tactic:'collection' },
  T1041:{ name:'Exfiltration Over C2 Channel', tactic:'exfiltration' },
  'T1567.002':{ name:'Exfiltration to Cloud Storage', tactic:'exfiltration' },
  T1486:{ name:'Data Encrypted for Impact', tactic:'impact' },
  T1490:{ name:'Inhibit System Recovery', tactic:'impact' },
  T1531:{ name:'Account Access Removal', tactic:'impact' },
});

function object(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function list(value) {
  if (Array.isArray(value)) return value.filter(item => item != null && String(item).trim());
  if (value == null || value === '') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter(item => item != null && String(item).trim());
  } catch {
    return String(value).split(',').map(item => item.trim()).filter(Boolean);
  }
  return [];
}

function at(source, path) {
  if (!source || typeof source !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(source, path)) return source[path];
  return path.split('.').reduce((value, key) => value?.[key], source);
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function tactic(value) {
  return TACTIC_BY_KEY.get(normalizeKey(value)) || null;
}

function technique(value) {
  const id = String(value || '').trim().toUpperCase();
  if (!id) return null;
  const known = TECHNIQUES[id];
  return {
    id,
    name:known?.name || `ATT&CK technique ${id}`,
    tacticKey:known?.tactic || null,
  };
}

function rawEvidence(alert) {
  const raw = object(alert?.raw);
  return object(raw.fields && typeof raw.fields === 'object' ? raw.fields : raw);
}

function observedControlStatus(alert) {
  const raw = rawEvidence(alert);
  const value = at(raw, 'security_control.status') || at(raw, 'security.control.status') ||
    at(raw, 'attack.observed_state') || at(raw, 'event.outcome');
  const normalized = normalizeKey(Array.isArray(value) ? value[0] : value);
  return ['blocked', 'contained', 'prevented', 'denied', 'failure'].includes(normalized) ? 'blocked' : 'detected';
}

function verdictName(alert) {
  const verdict = object(alert?.verdict);
  return String(verdict.verdict || '').trim().toLowerCase() || null;
}

function alertState(alert) {
  if (observedControlStatus(alert) === 'blocked') return 'contained';
  if (verdictName(alert) === 'true_positive') return 'detected-confirmed';
  return 'detected-active';
}

function alertMappings(alert) {
  const tactics = list(alert?.mitre_tactics).map(tactic).filter(Boolean);
  const techniques = list(alert?.mitre_techniques).map(technique).filter(Boolean);
  const tacticKeys = [...new Set([
    ...tactics.map(item => item.key),
    ...techniques.map(item => item.tacticKey).filter(Boolean),
  ])];

  return tacticKeys.map(key => {
    const tacticRecord = TACTIC_BY_KEY.get(key);
    const matching = techniques.filter(item => item.tacticKey === key);
    const fallback = tactics.length === 1 && techniques.length === 1 ? techniques : [];
    return {
      tacticId:tacticRecord.id,
      tacticName:tacticRecord.name,
      tacticKey:key,
      techniques:(matching.length ? matching : fallback).map(item => ({ id:item.id, name:item.name })),
    };
  });
}

function confidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(1, Math.max(0, number > 1 ? number / 100 : number));
}

function publicAlert(alert, triageEvent = null) {
  const verdict = object(alert.verdict);
  return {
    id:String(alert.id),
    name:alert.rule_desc || alert.alert_reason || alert.event_action || 'Security detection',
    timestamp:alert.timestamp,
    severity:String(alert.source_severity || verdict.severity || 'low').toLowerCase(),
    aiVerdict:verdictName(alert),
    confidence:confidence(triageEvent?.confidence ?? verdict.confidence),
    state:alertState(alert),
    mappings:alertMappings(alert),
    source:alert.event_dataset || alert.source_system || alert.agent_name || 'Stored telemetry',
    entity:alert.hostname || alert.agent_name || alert.username || alert.src_ip || alert.target_db || null,
    hostname:alert.hostname || alert.agent_name || null,
    username:alert.username || null,
    srcIp:alert.src_ip || null,
    dstIp:alert.dst_ip || null,
    triageStatus:alert.triage_status || 'pending',
    decisionTrace:triageEvent ? {
      reason:triageEvent.reason || verdict.narrative || null,
      model:triageEvent.model || verdict.model || null,
      provider:triageEvent.provider || null,
      inputSummary:object(triageEvent.input_summary),
      outputSummary:object(triageEvent.output_summary),
      limitations:list(triageEvent.limitations).map(String),
      finishedAt:triageEvent.finished_at || triageEvent.created_at || null,
    } : {
      reason:verdict.narrative || null,
      model:verdict.model || null,
      provider:null,
      inputSummary:{},
      outputSummary:{ verdict:verdictName(alert), confidence:confidence(verdict.confidence) },
      limitations:list(verdict.limitations).map(String),
      finishedAt:alert.triaged_at || null,
    },
  };
}

function buildIncident(incident, alerts, triageEvents = []) {
  const triageByAlert = new Map(triageEvents.map(event => [String(event.alert_id || event.entity_id), event]));
  const mappedAlerts = alerts.map(alert => publicAlert(alert, triageByAlert.get(String(alert.id))));
  const touched = new Set(mappedAlerts.flatMap(alert => alert.mappings.map(mapping => mapping.tacticId)));
  return {
    id:Number(incident.id),
    reference:`INC-${String(incident.id).padStart(5, '0')}`,
    name:incident.title || 'Untitled security incident',
    severity:String(incident.severity || 'low').toLowerCase(),
    status:incident.status || 'open',
    owner:incident.owner || null,
    createdAt:incident.created_at,
    firstSeen:incident.first_seen,
    lastSeen:incident.last_seen,
    alertCount:mappedAlerts.length,
    stageCount:touched.size,
    alerts:mappedAlerts,
    recommendedActions:list(incident.recommended_actions).map(String),
  };
}

function coverage(rows, range) {
  const byTactic = new Map();
  for (const row of rows) {
    const record = tactic(row.tactic_key || row.tactic);
    if (!record) continue;
    const current = byTactic.get(record.id) || { totalAlertCount:0, incidentCount:0, detectionCount:0 };
    current.totalAlertCount += Number(row.total_alert_count || 0);
    current.incidentCount += Number(row.incident_count || 0);
    current.detectionCount += Number(row.detection_count || 0);
    byTactic.set(record.id, current);
  }
  const tactics = TACTICS.map(item => ({
    ...item,
    ...(byTactic.get(item.id) || { totalAlertCount:0, incidentCount:0, detectionCount:0 }),
  }));
  const covered = tactics.filter(item => item.totalAlertCount > 0);
  const gaps = tactics.filter(item => item.totalAlertCount === 0);
  const scope = range === 'all' ? 'all recorded history' : `the last ${range} days`;
  const gapNames = gaps.map(item => item.name);
  return {
    range,
    tactics,
    summary:gapNames.length
      ? `${covered.length} of ${tactics.length} tactics have recorded incident detection coverage. ${gapNames.join(', ')} ${gapNames.length === 1 ? 'shows' : 'show'} no recorded alerts in ${scope}.`
      : `All ${tactics.length} tactics have recorded incident detection coverage in ${scope}.`,
  };
}

module.exports = {
  TACTICS,
  alertMappings,
  alertState,
  buildIncident,
  coverage,
  normalizeKey,
  observedControlStatus,
};
