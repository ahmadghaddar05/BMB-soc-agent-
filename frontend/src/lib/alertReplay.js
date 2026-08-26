import { activityTitle, alertReference, severityOf } from './executive';

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
    return Array.isArray(parsed) ? parsed.filter(item => item != null && String(item).trim()) : [];
  } catch {
    return String(value).split(',').map(item => item.trim()).filter(Boolean);
  }
}

function at(source, path) {
  if (!source || typeof source !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(source, path)) return source[path];
  return path.split('.').reduce((value, key) => value?.[key], source);
}

function scalar(value) {
  if (Array.isArray(value)) return scalar(value[0]);
  if (value == null || value === '') return null;
  return String(value);
}

function first(...values) {
  for (const value of values) {
    const normalized = scalar(value);
    if (normalized) return normalized;
  }
  return null;
}

function humanize(value) {
  return String(value || '')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function confidencePercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(Math.min(100, Math.max(0, number <= 1 ? number * 100 : number)));
}

function latestStage(journey, name) {
  return [...(journey?.stages || [])].reverse().find(stage => stage.stage === name) || null;
}

function stageOutput(stage) {
  return object(stage?.output_summary);
}

function stageLimitations(stage) {
  return list(stage?.limitations).map(String);
}

function targetType(value, alert) {
  const text = `${value || ''} ${alert?.target_db || ''} ${alert?.event_dataset || ''}`.toLowerCase();
  if (/database|postgres|oracle|mssql|mysql|(^|\W)db(\W|$)/.test(text)) return 'database';
  if (/workstation|desktop|laptop|endpoint|(^|\W)ws(\W|$)/.test(text)) return 'workstation';
  return 'server';
}

function eventType(alert) {
  const text = `${alert?.event_action || ''} ${alert?.rule_desc || ''} ${alert?.alert_reason || ''}`.toLowerCase();
  if (/credential|login|logon|password|authentication/.test(text)) return 'credential';
  if (/lateral|remote desktop|rdp|smb|pivot/.test(text)) return 'lateral-movement';
  if (/database|export|download|collection|exfil/.test(text)) return 'data-access';
  return 'access';
}

function tacticName(value) {
  const normalized = humanize(value || '');
  return normalized || null;
}

function buildMitreStages(alert, verdict) {
  const tactics = [...new Set([
    ...list(alert?.mitre_tactics),
    verdict?.attack_stage,
  ].filter(Boolean).map(tacticName).filter(Boolean))];
  const techniques = list(alert?.mitre_techniques).map(value => String(value).toUpperCase());
  return tactics.map((name, index) => ({
    id:`observed-mitre-${index}`,
    tacticName:name,
    techniqueId:techniques[index] || (tactics.length === 1 ? techniques[0] : null),
    state:'upcoming',
  }));
}

function positionNodes(nodes) {
  const startX = 24;
  const endX = 816;
  const width = Math.max(1, nodes.length - 1);
  return nodes.map((node, index) => ({
    ...node,
    position:{ x:Math.round(startX + ((endX - startX) * index) / width), y:184 },
  }));
}

function recordedStatus(stage) {
  if (!stage) return 'Not recorded';
  if (stage.status === 'skipped') return 'Not linked';
  if (stage.status === 'failed') return 'Failed';
  return 'Recorded';
}

function incidentReference(incident) {
  if (!incident?.id) return null;
  return `INC-${String(incident.id).padStart(5, '0')}`;
}

function displayScalar(value) {
  if (value == null || value === '') return null;
  if (Array.isArray(value)) return value.map(displayScalar).filter(Boolean).join(', ') || null;
  if (typeof value === 'object') return null;
  return String(value);
}

function summaryEntries(value, prefix = '', result = []) {
  if (result.length >= 8) return result;
  const source = object(value);
  Object.entries(source).forEach(([key, item]) => {
    if (result.length >= 8) return;
    const label = prefix ? `${prefix} ${humanize(key)}` : humanize(key);
    const displayed = displayScalar(item);
    if (displayed) result.push({ id:`fact-${result.length}`, label, value:displayed });
    else if (item && typeof item === 'object' && !Array.isArray(item)) summaryEntries(item, label, result);
  });
  return result;
}

function evidenceFact(id, label, value, type) {
  const displayed = displayScalar(value);
  return displayed ? { id, label, value:displayed, type } : null;
}

/**
 * Builds a read-only replay exclusively from persisted alert and journey data.
 * Collection, normalization, and enrichment stages are intentionally omitted.
 */
export function buildAlertReplay(alert, journey = {}) {
  if (!alert?.id) throw new Error('A stored alert is required to build a replay.');

  const raw = object(alert.raw);
  const fullLog = object(alert.full_log);
  const evidence = Object.keys(raw).length ? raw : fullLog;
  const verdict = object(alert.verdict);
  const triage = latestStage(journey, 'triaged');
  const correlation = latestStage(journey, 'correlated');
  const decision = latestStage(journey, 'incident_decision');
  const incident = journey?.current_state?.incident || null;
  const triageOutput = stageOutput(triage);
  const correlationOutput = stageOutput(correlation);
  const decisionOutput = stageOutput(decision);

  const sourceIp = first(alert.src_ip, at(evidence, 'source.ip'), at(evidence, 'client.ip'));
  const identity = first(alert.username, at(evidence, 'user.name'), at(evidence, 'user.email'));
  const process = first(
    alert.process,
    at(evidence, 'process.name'),
    at(evidence, 'process.executable'),
    at(evidence, 'process.command_line')
  );
  const parentProcess = first(at(evidence, 'process.parent.name'), at(evidence, 'process.parent.executable'));
  const fileHash = first(
    alert.file_hash,
    at(evidence, 'file.hash.sha256'),
    at(evidence, 'file.hash.sha1'),
    at(evidence, 'file.hash.md5'),
    at(evidence, 'process.hash.sha256'),
    at(evidence, 'process.hash.md5')
  );
  const destinationIp = first(alert.dst_ip, at(evidence, 'destination.ip'), at(evidence, 'server.ip'));
  const target = first(
    alert.target_db,
    alert.hostname,
    alert.agent_name,
    at(evidence, 'host.name'),
    at(evidence, 'host.hostname'),
    destinationIp
  );
  const action = first(alert.event_action, at(evidence, 'event.action'), alert.alert_reason, alert.rule_desc, 'Observed security action');
  const sourceValue = sourceIp || identity;
  const actionValue = process || action;
  const model = first(triage?.model, verdict.model, verdict.model_identity);
  const triageReady = Boolean(verdict.verdict || (triage && triage.status === 'completed'));
  const incidentId = incidentReference(incident);
  const observedEvidence = [
    evidenceFact('detection', 'Detection', activityTitle(alert), 'detection'),
    evidenceFact('dataset', 'Telemetry source', alert.event_dataset || alert.source_system, 'dataset'),
    evidenceFact('source-ip', 'Source address', sourceIp, 'network'),
    evidenceFact('identity', 'Identity', identity, 'identity'),
    evidenceFact('process', 'Process', process, 'process'),
    evidenceFact('parent-process', 'Parent process', parentProcess, 'process'),
    evidenceFact('file-hash', 'File hash', fileHash, 'file'),
    evidenceFact('target', 'Affected target', target, 'target'),
    evidenceFact('destination-ip', 'Destination address', destinationIp, 'network'),
    evidenceFact('action', 'Observed action', action, 'action'),
  ].filter(Boolean);
  const triageInputs = summaryEntries(triage?.input_summary);
  const triageOutputs = summaryEntries(triage?.output_summary);
  const correlationInputs = summaryEntries(correlation?.input_summary);
  const correlationOutputs = summaryEntries(correlation?.output_summary);
  const decisionInputs = summaryEntries(decision?.input_summary);
  const decisionOutputs = summaryEntries(decision?.output_summary);

  const observedNodes = [];
  if (sourceValue) observedNodes.push({
    id:'source', label:sourceIp ? 'Source' : 'Identity', sublabel:sourceValue,
    type:sourceIp ? 'external' : 'user', state:'idle', lane:'observed',
  });
  observedNodes.push({
    id:'action', label:humanize(action), sublabel:process || alert.event_dataset || 'Observed alert evidence',
    type:process ? 'process' : 'action', state:'idle', lane:'observed',
  });
  if (target && target !== sourceValue) observedNodes.push({
    id:'target', label:alert.target_db ? 'Target database' : 'Affected asset',
    sublabel:destinationIp && destinationIp !== target ? `${target} · ${destinationIp}` : target,
    type:targetType(target, alert), state:'idle', lane:'observed',
  });

  const nodes = positionNodes([
    ...observedNodes,
    {
      id:'ai', label:'AI assessment', sublabel:triageReady ? (model || 'Recorded model decision') : 'Assessment pending',
      type:'ai', state:'idle', lane:'decision',
    },
    {
      id:'correlation', label:'Correlation', sublabel:recordedStatus(correlation),
      type:'correlation', state:'idle', lane:'decision',
    },
    {
      id:'decision', label:'Incident decision',
      sublabel:incidentId ? `${incidentId} · ${humanize(incident.status || 'recorded')}` : recordedStatus(decision),
      type:'incident', state:'idle', lane:'decision',
    },
  ]);

  const aiIndex = nodes.findIndex(node => node.id === 'ai');
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id:`replay-edge-${index}`,
    sourceNodeId:node.id,
    targetNodeId:nodes[index + 1].id,
    state:'idle',
    kind:index < aiIndex - 1 ? 'attack' : 'analysis',
  }));
  const edgeInto = nodeId => edges.find(edge => edge.targetNodeId === nodeId)?.id || null;
  const severity = severityOf(alert);
  const timestamps = alert.timestamp || alert.first_seen || new Date().toISOString();
  const mitreStages = buildMitreStages(alert, verdict);
  const scriptedEvents = [];
  let offset = 0;

  scriptedEvents.push({
    id:`${alert.id}:observed`, timestampOffset:offset, timestamp:timestamps,
    title:'Security action reconstructed',
    message:`${humanize(action)}${target ? ` affected ${target}` : ' was recorded by the alert source'}.`,
    detail:[sourceValue, process, target].filter(Boolean).join(' -> ') || activityTitle(alert),
    phase:'observed', category:'observed', eventType:eventType(alert), severity,
    affectedNodeId:'action', affectedEdgeId:edgeInto('action'),
    nodeState:severity === 'critical' ? 'compromised' : 'targeted',
    relatedStageId:mitreStages[0]?.id || null,
    evidence:observedEvidence.slice(0, 6).map(item => `${item.label}: ${item.value}`),
  });
  offset += 1_600;

  if (triageReady) {
    const findings = list(verdict.key_findings).map(String);
    const fallbackEvidence = [sourceIp, identity, process, parentProcess, target, destinationIp]
      .filter(Boolean).map(String);
    const evidenceInputs = [...new Set(findings.length ? findings : fallbackEvidence)].slice(0, 5);
    const limitations = [...new Set([...list(verdict.limitations), ...stageLimitations(triage)])].map(String);
    const confidence = confidencePercent(triage?.confidence ?? verdict.confidence);
    scriptedEvents.push({
      id:`${alert.id}:evidence`, timestampOffset:offset, timestamp:triage?.started_at || triage?.created_at || timestamps,
      title:'Evidence prepared for model review',
      message:`${triageInputs.length || observedEvidence.length} recorded inputs were available to the selected model.`,
      detail:model || 'Recorded AI assessment', phase:'evidence', category:'ai', eventType:'correlation', severity,
      affectedNodeId:'ai', affectedEdgeId:edgeInto('ai'), nodeState:'analyzing',
      evidence:(triageInputs.length ? triageInputs.map(item => `${item.label}: ${item.value}`) : evidenceInputs),
      confidence, model, provider:triage?.provider || null, limitations,
    });
    offset += 1_600;
    scriptedEvents.push({
      id:`${alert.id}:inference`, timestampOffset:offset, timestamp:triage?.finished_at || timestamps,
      title:'Model evaluated evidence and gaps',
      message:triage?.reason || verdict.narrative || 'The stored model rationale was recorded.',
      detail:model || 'Recorded model inference', phase:'inference', category:'ai', eventType:'correlation', severity,
      affectedNodeId:'ai', affectedEdgeId:null, nodeState:'analyzing',
      evidence:evidenceInputs, confidence, model, provider:triage?.provider || null, limitations,
    });
    offset += 1_800;
    scriptedEvents.push({
      id:`${alert.id}:verdict`, timestampOffset:offset, timestamp:triage?.finished_at || timestamps,
      title:`Verdict: ${humanize(triageOutput.verdict || verdict.verdict || 'Recorded')}`,
      message:triage?.reason || verdict.narrative || 'The AI verdict was persisted.',
      detail:confidence == null ? 'Confidence not supplied' : `${confidence}% confidence`,
      phase:'verdict', category:'ai', eventType:'correlation', severity:triageOutput.severity || verdict.severity || severity,
      affectedNodeId:'ai', affectedEdgeId:null, nodeState:'decided', evidence:evidenceInputs,
      confidence, model, limitations,
    });
    offset += 1_800;
  }

  if (triageReady) {
    scriptedEvents.push({
      id:`${alert.id}:correlation`, timestampOffset:offset,
      timestamp:correlation?.finished_at || correlation?.created_at || timestamps,
      title:correlation ? 'Correlation decision recorded' : 'Correlation evidence unavailable',
      message:correlation?.reason || 'No append-only correlation decision is stored for this alert.',
      detail:correlation ? humanize(correlationOutput.decision || correlation.status) : 'Not recorded',
      phase:'correlation', category:'system', eventType:'correlation', severity,
      affectedNodeId:'correlation', affectedEdgeId:edgeInto('correlation'),
      nodeState:correlation ? 'decided' : 'unavailable',
      evidence:Object.entries(object(correlation?.input_summary)).slice(0, 4).map(([key, value]) => `${humanize(key)}: ${String(value)}`),
    });
    offset += 1_800;
    scriptedEvents.push({
      id:`${alert.id}:decision`, timestampOffset:offset,
      timestamp:decision?.finished_at || decision?.created_at || incident?.updated_at || timestamps,
      title:incidentId ? `${incidentId} linked` : decision ? 'Incident decision recorded' : 'Incident decision unavailable',
      message:decision?.reason || (incidentId
        ? `This alert is stored as evidence for ${incidentId}.`
        : 'No append-only incident decision is stored for this alert.'),
      detail:incidentId || humanize(decisionOutput.decision || decision?.status || 'Not recorded'),
      phase:'incident', category:'system', eventType:'correlation', severity:incident?.severity || severity,
      affectedNodeId:'decision', affectedEdgeId:edgeInto('decision'),
      nodeState:decision || incidentId ? 'decided' : 'unavailable',
      evidence:incidentId ? [incident.title, humanize(incident.status)].filter(Boolean) : [],
      outcome:'complete',
    });
  }

  const reviews = Array.isArray(journey?.analyst_reviews) ? journey.analyst_reviews : [];
  const verdictName = triageOutput.verdict || verdict.verdict || null;
  const confidence = confidencePercent(triage?.confidence ?? verdict.confidence);

  return Object.freeze({
    id:String(alert.id),
    reference:alertReference(alert),
    title:activityTitle(alert),
    severity,
    timestamp:timestamps,
    triageReady,
    observed:Object.freeze({
      source:sourceValue || null,
      action:humanize(action),
      target:target || destinationIp || null,
      process:process || null,
      facts:Object.freeze(observedEvidence.map(item => Object.freeze(item))),
    }),
    nodes:Object.freeze(nodes.map(node => Object.freeze(node))),
    edges:Object.freeze(edges.map(edge => Object.freeze(edge))),
    scriptedEvents:Object.freeze(scriptedEvents.map(event => Object.freeze(event))),
    mitreStages:Object.freeze(mitreStages.map(stage => Object.freeze(stage))),
    ai:Object.freeze({
      verdict:verdictName ? humanize(verdictName) : 'Awaiting AI assessment',
      confidence,
      model:model || null,
      provider:triage?.provider || null,
      rationale:triage?.reason || verdict.narrative || null,
      inputFacts:Object.freeze((triageInputs.length ? triageInputs : observedEvidence).map(item => Object.freeze({ ...item }))),
      outputFacts:Object.freeze(triageOutputs.map(item => Object.freeze({ ...item }))),
      findings:Object.freeze(list(verdict.key_findings).map(String)),
      limitations:Object.freeze([...new Set([...list(verdict.limitations), ...stageLimitations(triage)])].map(String)),
      recommendations:Object.freeze(list(verdict.recommended_actions).map(String)),
      citations:Object.freeze(list(verdict.citations).map(item => typeof item === 'object' ? { ...item } : item)),
      correlation:Object.freeze({
        recorded:Boolean(correlation), status:humanize(correlationOutput.decision) || recordedStatus(correlation), reason:correlation?.reason || null,
        inputs:Object.freeze(correlationInputs.map(item => Object.freeze({ ...item }))),
        outputs:Object.freeze(correlationOutputs.map(item => Object.freeze({ ...item }))),
      }),
      incidentDecision:Object.freeze({
        recorded:Boolean(decision || incident), status:incidentId || humanize(decisionOutput.decision) || recordedStatus(decision), reason:decision?.reason || null,
        inputs:Object.freeze(decisionInputs.map(item => Object.freeze({ ...item }))),
        outputs:Object.freeze(decisionOutputs.map(item => Object.freeze({ ...item }))),
        incident:incident ? Object.freeze({
          reference:incidentId, title:incident.title || null, severity:incident.severity || null,
          status:incident.status || null,
        }) : null,
      }),
      reviews:Object.freeze(reviews.map(review => ({ ...review }))),
    }),
  });
}

export function deriveReplayTopology(replay, visibleEvents = [], activeEventId = null) {
  const states = new Map(replay.nodes.map(node => [node.id, node.state]));
  const traversedEdges = new Set();
  visibleEvents.forEach(event => {
    if (event.affectedNodeId && event.nodeState) states.set(event.affectedNodeId, event.nodeState);
    if (event.affectedEdgeId) traversedEdges.add(event.affectedEdgeId);
  });
  const current = visibleEvents.find(event => event.id === activeEventId) || null;
  return {
    nodes:replay.nodes.map(node => ({ ...node, state:states.get(node.id) || 'idle' })),
    edges:replay.edges.map(edge => ({
      ...edge,
      state:current?.affectedEdgeId === edge.id
        ? 'active-traversal'
        : traversedEdges.has(edge.id) ? 'traversed' : 'idle',
    })),
  };
}

export function deriveReplayMitreProgress(replay, visibleEvents = []) {
  if (!replay.mitreStages.length) return [];
  const currentStageId = [...visibleEvents].reverse().find(event => event.relatedStageId)?.relatedStageId || null;
  const currentIndex = replay.mitreStages.findIndex(stage => stage.id === currentStageId);
  const attackComplete = visibleEvents.some(event => event.category === 'ai' || event.category === 'system');
  return replay.mitreStages.map((stage, index) => ({
    ...stage,
    state:attackComplete || index < currentIndex ? 'completed'
      : index === currentIndex ? 'in-progress' : 'upcoming',
  }));
}
