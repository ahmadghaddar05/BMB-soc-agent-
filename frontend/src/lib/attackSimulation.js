import { validateScenario } from './securityVisualization';

const RAW_SCENARIOS = [
  {
    id:'dmz-web-server-compromise',
    name:'DMZ Web Server Compromise',
    description:'External attacker exploits a web server and attempts an internal pivot.',
    icon:'server',
    killChainStages:[
      { id:'dmz-initial-access', tacticName:'Initial Access', techniqueId:'T1190', state:'upcoming' },
      { id:'dmz-execution', tacticName:'Execution', techniqueId:'T1059.004', state:'upcoming' },
      { id:'dmz-discovery', tacticName:'Discovery', techniqueId:'T1046', state:'upcoming' },
      { id:'dmz-lateral-movement', tacticName:'Lateral Movement', techniqueId:'T1021.002', state:'upcoming' },
      { id:'dmz-impact', tacticName:'Impact', techniqueId:'T1486', state:'upcoming' },
    ],
    scriptedEvents:[
      { id:'dmz-01', timestampOffset:0, message:'Simulated request targeted WebSrv01 input validation.', relatedStageId:'dmz-initial-access', eventType:'access', severity:'high' },
      { id:'dmz-02', timestampOffset:3000, message:'The request opened a constrained command shell on WebSrv01.', relatedStageId:'dmz-execution', eventType:'execution', severity:'critical' },
      { id:'dmz-03', timestampOffset:6500, message:'WebSrv01 began enumerating reachable internal services.', relatedStageId:'dmz-discovery', eventType:'discovery', severity:'high' },
      { id:'dmz-04', timestampOffset:10000, message:'AI correlation linked outbound SMB traffic to the initial exploit.', relatedStageId:'dmz-lateral-movement', eventType:'correlation', severity:'critical', confidence:84, recommendationsVisible:1 },
      { id:'dmz-05', timestampOffset:13500, message:'A pivot attempt toward CustomerDB was identified before authentication.', relatedStageId:'dmz-lateral-movement', eventType:'lateral-movement', severity:'critical', confidence:92, recommendationsVisible:2 },
      { id:'dmz-06', timestampOffset:18000, message:'The simulated network boundary contained the pivot attempt.', relatedStageId:'dmz-lateral-movement', eventType:'containment', severity:'low', confidence:96, recommendationsVisible:3, outcome:'blocked' },
    ],
    recommendedActions:[
      'Isolate WebSrv01 from the internal VLAN',
      'Rotate service credentials exposed to the web tier',
      'Review inbound requests matching the exploit pattern',
    ],
    outcome:{ systemsAffected:1, dataLoss:0 },
  },
  {
    id:'credential-phishing-lateral-movement',
    name:'Credential Phishing → Lateral Movement',
    description:'Compromised user credentials are used to move across internal systems.',
    icon:'key',
    killChainStages:[
      { id:'phish-initial-access', tacticName:'Initial Access', techniqueId:'T1566.002', state:'upcoming' },
      { id:'phish-credential-access', tacticName:'Credential Access', techniqueId:'T1056.002', state:'upcoming' },
      { id:'phish-discovery', tacticName:'Discovery', techniqueId:'T1087', state:'upcoming' },
      { id:'phish-lateral-movement', tacticName:'Lateral Movement', techniqueId:'T1021.001', state:'upcoming' },
      { id:'phish-collection', tacticName:'Collection', techniqueId:'T1114', state:'upcoming' },
    ],
    scriptedEvents:[
      { id:'phish-01', timestampOffset:0, message:'A simulated phishing link captured a test user credential.', relatedStageId:'phish-initial-access', eventType:'access', severity:'medium' },
      { id:'phish-02', timestampOffset:3500, message:'The credential was replayed against the remote access service.', relatedStageId:'phish-credential-access', eventType:'credential', severity:'high' },
      { id:'phish-03', timestampOffset:7000, message:'The test account enumerated privileged directory groups.', relatedStageId:'phish-discovery', eventType:'discovery', severity:'high' },
      { id:'phish-04', timestampOffset:11000, message:'AI correlation connected the new session to the earlier phishing signal.', relatedStageId:'phish-lateral-movement', eventType:'correlation', severity:'critical', confidence:86, recommendationsVisible:1 },
      { id:'phish-05', timestampOffset:15000, message:'A simulated remote desktop pivot targeted FinanceWS02.', relatedStageId:'phish-lateral-movement', eventType:'lateral-movement', severity:'critical', confidence:93, recommendationsVisible:2 },
      { id:'phish-06', timestampOffset:20000, message:'The simulated identity control revoked the session before collection.', relatedStageId:'phish-lateral-movement', eventType:'containment', severity:'low', confidence:97, recommendationsVisible:3, outcome:'blocked' },
    ],
    recommendedActions:[
      'Revoke the suspected user sessions',
      'Force a password reset for the affected identity',
      'Review remote access from the originating address',
    ],
    outcome:{ systemsAffected:2, dataLoss:0 },
  },
  {
    id:'insider-data-exfiltration',
    name:'Insider Data Exfiltration',
    description:'An authenticated user attempts an unusual bulk database export.',
    icon:'database',
    killChainStages:[
      { id:'insider-discovery', tacticName:'Discovery', techniqueId:'T1087.002', state:'upcoming' },
      { id:'insider-collection', tacticName:'Collection', techniqueId:'T1005', state:'upcoming' },
      { id:'insider-staging', tacticName:'Staging', techniqueId:'T1074.001', state:'upcoming' },
      { id:'insider-exfiltration', tacticName:'Exfiltration', techniqueId:'T1041', state:'upcoming' },
      { id:'insider-impact', tacticName:'Impact', techniqueId:'T1530', state:'upcoming' },
    ],
    scriptedEvents:[
      { id:'insider-01', timestampOffset:0, message:'A test analyst account queried restricted database schemas.', relatedStageId:'insider-discovery', eventType:'discovery', severity:'medium' },
      { id:'insider-02', timestampOffset:3000, message:'The account started a simulated high-volume record export.', relatedStageId:'insider-collection', eventType:'data-access', severity:'high' },
      { id:'insider-03', timestampOffset:6500, message:'Exported records were staged in an unusual temporary directory.', relatedStageId:'insider-staging', eventType:'collection', severity:'high' },
      { id:'insider-04', timestampOffset:10000, message:'AI correlation linked the staging activity to a new external connection.', relatedStageId:'insider-exfiltration', eventType:'correlation', severity:'critical', confidence:88, recommendationsVisible:1 },
      { id:'insider-05', timestampOffset:13500, message:'The simulated transfer crossed the configured data-loss threshold.', relatedStageId:'insider-exfiltration', eventType:'data-access', severity:'critical', confidence:94, recommendationsVisible:2 },
      { id:'insider-06', timestampOffset:17500, message:'The simulation blocked the transfer and preserved the source evidence.', relatedStageId:'insider-exfiltration', eventType:'containment', severity:'low', confidence:98, recommendationsVisible:3, outcome:'blocked' },
    ],
    recommendedActions:[
      'Suspend the test account pending analyst review',
      'Preserve the export query and endpoint evidence',
      'Validate the user’s approved data-access scope',
    ],
    outcome:{ systemsAffected:1, dataLoss:0 },
  },
];

function freezeScenario(scenario) {
  validateScenario(scenario);
  return Object.freeze({
    ...scenario,
    killChainStages:Object.freeze(scenario.killChainStages.map(stage => Object.freeze({ ...stage }))),
    scriptedEvents:Object.freeze(scenario.scriptedEvents.map(event => Object.freeze({ ...event }))),
    recommendedActions:Object.freeze([...scenario.recommendedActions]),
    outcome:Object.freeze({ ...scenario.outcome }),
  });
}

export const ATTACK_SCENARIOS = Object.freeze(RAW_SCENARIOS.map(freezeScenario));

export function attackScenarioById(id) {
  return ATTACK_SCENARIOS.find(scenario => scenario.id === id) || null;
}

export function simulationDuration(scenario) {
  validateScenario(scenario);
  return Math.max(...scenario.scriptedEvents.map(event => event.timestampOffset));
}

export function deriveMitreProgress(scenario, events = [], status = 'idle') {
  validateScenario(scenario);
  const stageIndex = new Map(scenario.killChainStages.map((stage, index) => [stage.id, index]));
  const observedEvents = Array.isArray(events)
    ? events.filter(event => stageIndex.has(event?.relatedStageId))
    : [];
  const latestEvent = observedEvents.at(-1) || null;
  const blockedEvent = status === 'completed'
    ? [...observedEvents].reverse().find(event => event.outcome === 'blocked') || null
    : null;
  const activeStageId = blockedEvent?.relatedStageId
    || latestEvent?.relatedStageId
    || (status === 'running' ? scenario.killChainStages[0].id : null);
  const activeIndex = activeStageId == null ? -1 : stageIndex.get(activeStageId);
  const blockedIndex = blockedEvent == null ? -1 : stageIndex.get(blockedEvent.relatedStageId);

  return Object.freeze(scenario.killChainStages.map((stage, index) => {
    let state = 'upcoming';
    let cut = false;
    if (blockedIndex >= 0) {
      if (index < blockedIndex) state = 'completed';
      else if (index === blockedIndex) state = 'blocked';
      else cut = true;
    } else if (activeIndex >= 0) {
      if (index < activeIndex) state = 'completed';
      else if (index === activeIndex) state = status === 'completed' ? 'completed' : 'in-progress';
    }
    return Object.freeze({ ...stage, state, cut });
  }));
}

export function deriveSimulationResponse(scenario, events = [], status = 'idle') {
  validateScenario(scenario);
  const stageIds = new Set(scenario.killChainStages.map(stage => stage.id));
  const observedEvents = Array.isArray(events)
    ? events.filter(event => stageIds.has(event?.relatedStageId))
    : [];
  const latestConfidenceEvent = [...observedEvents].reverse()
    .find(event => Number.isFinite(Number(event.confidence)));
  const confidence = latestConfidenceEvent == null
    ? null
    : Math.min(100, Math.max(0, Math.round(Number(latestConfidenceEvent.confidence))));
  const recommendationCount = observedEvents.reduce((maximum, event) => (
    Math.max(maximum, Number.isFinite(Number(event.recommendationsVisible))
      ? Number(event.recommendationsVisible)
      : 0)
  ), 0);
  const complete = status === 'completed' && observedEvents.at(-1)?.outcome === 'blocked';
  const durationSeconds = simulationDuration(scenario) / 1000;
  const durationLabel = Number.isInteger(durationSeconds) ? String(durationSeconds) : durationSeconds.toFixed(1);
  const systemsAffected = Number(scenario.outcome.systemsAffected) || 0;
  const dataLoss = Number(scenario.outcome.dataLoss) || 0;
  const verdict = complete
    ? 'Attack contained'
    : confidence == null
      ? 'Analyzing scenario'
      : confidence >= 90 ? 'Containment recommended' : 'Probable malicious activity';

  return Object.freeze({
    confidence,
    verdict,
    actions:Object.freeze(scenario.recommendedActions.slice(0, recommendationCount)),
    complete,
    summary:complete
      ? `Contained in ${durationLabel}s · ${systemsAffected} ${systemsAffected === 1 ? 'system' : 'systems'} affected · ${dataLoss} data loss`
      : null,
  });
}
