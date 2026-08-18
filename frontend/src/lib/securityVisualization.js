export const NETWORK_NODE_TYPES = Object.freeze([
  'firewall', 'server', 'database', 'workstation', 'external',
]);

export const NETWORK_NODE_STATES = Object.freeze([
  'idle', 'monitoring', 'targeted', 'compromised', 'contained',
]);

export const NETWORK_EDGE_STATES = Object.freeze([
  'idle', 'active-traversal', 'traversed',
]);

export const ATTACK_EVENT_TYPES = Object.freeze([
  'access', 'credential', 'lateral-movement', 'data-access', 'containment',
]);

export const MITRE_STAGE_STATES = Object.freeze([
  'upcoming', 'in-progress', 'completed', 'blocked',
]);

export const EVENT_STREAM_STATES = Object.freeze([
  'idle', 'live', 'running', 'completed', 'stopped',
]);

/**
 * @typedef {'firewall'|'server'|'database'|'workstation'|'external'} NetworkNodeType
 * @typedef {'idle'|'monitoring'|'targeted'|'compromised'|'contained'} NetworkNodeState
 * @typedef {'idle'|'active-traversal'|'traversed'} NetworkEdgeState
 * @typedef {'access'|'credential'|'lateral-movement'|'data-access'|'containment'} AttackEventType
 * @typedef {'upcoming'|'in-progress'|'completed'|'blocked'} MitreStageState
 *
 * @typedef {Object} NetworkNode
 * @property {string} id
 * @property {string} label
 * @property {string} sublabel
 * @property {NetworkNodeType} type
 * @property {NetworkNodeState} state
 * @property {{x:number, y:number}} position
 *
 * @typedef {Object} NetworkEdge
 * @property {string} id
 * @property {string} sourceNodeId
 * @property {string} targetNodeId
 * @property {NetworkEdgeState} state
 *
 * @typedef {Object} AttackEvent
 * @property {string} id
 * @property {string} timestamp
 * @property {string} message
 * @property {AttackEventType} eventType
 * @property {'critical'|'high'|'medium'|'low'} severity
 * @property {string} affectedNodeId
 * @property {string|null} affectedEdgeId
 *
 * @typedef {Object} MitreStage
 * @property {string} id
 * @property {string} tacticName
 * @property {string|null} techniqueId
 * @property {MitreStageState} state
 *
 * @typedef {Object} SimEvent
 * @property {string} id
 * @property {number} timestampOffset
 * @property {string} message
 * @property {string} relatedStageId
 * @property {string} eventType
 *
 * @typedef {Object} Scenario
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} icon
 * @property {MitreStage[]} killChainStages
 * @property {SimEvent[]} scriptedEvents
 */

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function requiredText(value, field) {
  invariant(typeof value === 'string' && value.trim(), `${field} must be a non-empty string`);
}

function member(value, allowed, field) {
  invariant(allowed.includes(value), `${field} must be one of: ${allowed.join(', ')}`);
}

function uniqueIds(items, field) {
  const ids = new Set();
  items.forEach((item, index) => {
    requiredText(item?.id, `${field}[${index}].id`);
    invariant(!ids.has(item.id), `${field} contains duplicate id ${item.id}`);
    ids.add(item.id);
  });
  return ids;
}

export function validateNetworkNode(node) {
  requiredText(node?.id, 'NetworkNode.id');
  requiredText(node?.label, 'NetworkNode.label');
  invariant(typeof node?.sublabel === 'string', 'NetworkNode.sublabel must be a string');
  member(node?.type, NETWORK_NODE_TYPES, 'NetworkNode.type');
  member(node?.state, NETWORK_NODE_STATES, 'NetworkNode.state');
  invariant(Number.isFinite(node?.position?.x) && Number.isFinite(node?.position?.y), 'NetworkNode.position must contain finite x and y values');
  return node;
}

export function validateNetworkTopology({ nodes, edges }) {
  invariant(Array.isArray(nodes), 'Network topology nodes must be an array');
  invariant(Array.isArray(edges), 'Network topology edges must be an array');
  const nodeIds = uniqueIds(nodes, 'nodes');
  const edgeIds = uniqueIds(edges, 'edges');
  nodes.forEach(validateNetworkNode);
  edges.forEach(edge => {
    member(edge?.state, NETWORK_EDGE_STATES, 'NetworkEdge.state');
    requiredText(edge?.sourceNodeId, 'NetworkEdge.sourceNodeId');
    requiredText(edge?.targetNodeId, 'NetworkEdge.targetNodeId');
    invariant(nodeIds.has(edge.sourceNodeId), `NetworkEdge ${edge.id} references unknown source node ${edge.sourceNodeId}`);
    invariant(nodeIds.has(edge.targetNodeId), `NetworkEdge ${edge.id} references unknown target node ${edge.targetNodeId}`);
  });
  return { nodes, edges, nodeIds, edgeIds };
}

export function validateAttackEvent(event, topology = null) {
  requiredText(event?.id, 'AttackEvent.id');
  requiredText(event?.timestamp, 'AttackEvent.timestamp');
  invariant(Number.isFinite(Date.parse(event.timestamp)), 'AttackEvent.timestamp must be an ISO-compatible timestamp');
  requiredText(event?.message, 'AttackEvent.message');
  member(event?.eventType, ATTACK_EVENT_TYPES, 'AttackEvent.eventType');
  member(event?.severity, ['critical', 'high', 'medium', 'low'], 'AttackEvent.severity');
  requiredText(event?.affectedNodeId, 'AttackEvent.affectedNodeId');
  invariant(event.affectedEdgeId == null || (typeof event.affectedEdgeId === 'string' && event.affectedEdgeId.trim()), 'AttackEvent.affectedEdgeId must be null or a non-empty string');
  if (topology) {
    const validated = validateNetworkTopology(topology);
    invariant(validated.nodeIds.has(event.affectedNodeId), `AttackEvent ${event.id} references unknown node ${event.affectedNodeId}`);
    invariant(event.affectedEdgeId == null || validated.edgeIds.has(event.affectedEdgeId), `AttackEvent ${event.id} references unknown edge ${event.affectedEdgeId}`);
  }
  return event;
}

export function validateScenario(scenario) {
  requiredText(scenario?.id, 'Scenario.id');
  requiredText(scenario?.name, 'Scenario.name');
  requiredText(scenario?.description, 'Scenario.description');
  requiredText(scenario?.icon, 'Scenario.icon');
  invariant(Array.isArray(scenario?.killChainStages) && scenario.killChainStages.length > 0, 'Scenario.killChainStages must contain at least one stage');
  invariant(Array.isArray(scenario?.scriptedEvents) && scenario.scriptedEvents.length > 0, 'Scenario.scriptedEvents must contain at least one event');

  const stageIds = uniqueIds(scenario.killChainStages, 'killChainStages');
  uniqueIds(scenario.scriptedEvents, 'scriptedEvents');
  scenario.killChainStages.forEach(stage => {
    requiredText(stage.tacticName, 'MitreStage.tacticName');
    invariant(stage.techniqueId == null || typeof stage.techniqueId === 'string', 'MitreStage.techniqueId must be null or a string');
    member(stage.state, MITRE_STAGE_STATES, 'MitreStage.state');
  });
  scenario.scriptedEvents.forEach(event => {
    invariant(Number.isFinite(event.timestampOffset) && event.timestampOffset >= 0, 'SimEvent.timestampOffset must be a non-negative number');
    requiredText(event.message, 'SimEvent.message');
    requiredText(event.relatedStageId, 'SimEvent.relatedStageId');
    requiredText(event.eventType, 'SimEvent.eventType');
    invariant(stageIds.has(event.relatedStageId), `SimEvent ${event.id} references unknown MITRE stage ${event.relatedStageId}`);
  });
  return scenario;
}

export function orderScriptedEvents(events) {
  invariant(Array.isArray(events), 'Scripted events must be an array');
  uniqueIds(events, 'scriptedEvents');
  events.forEach(event => invariant(
    Number.isFinite(event?.timestampOffset) && event.timestampOffset >= 0,
    'Every scripted event must have a non-negative timestampOffset'
  ));
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => left.event.timestampOffset - right.event.timestampOffset || left.index - right.index)
    .map(({ event }) => event);
}

function observedNode(kind, value) {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return null;
  const lower = normalizedValue.toLowerCase();
  let type = kind === 'source' ? 'external' : kind === 'database' ? 'database' : 'server';
  if (kind === 'asset') {
    if (/(^|[-_.])(fw|firewall|gateway|waf)([-_.\d]|$)/.test(lower)) type = 'firewall';
    else if (/(^|[-_.])(db|sql|postgres|oracle|database)([-_.\d]|$)/.test(lower)) type = 'database';
    else if (/(^|[-_.])(ws|workstation|desktop|laptop|client)([-_.\d]|$)/.test(lower)) type = 'workstation';
  }
  const label = type === 'external' ? 'External source'
    : type === 'firewall' ? 'Security gateway'
      : type === 'database' ? 'Database'
        : type === 'workstation' ? 'Workstation' : 'Server';
  return { id:`${kind}:${lower}`, label, sublabel:normalizedValue, type, state:'idle' };
}

function topologyLayer(type) {
  return type === 'external' ? 0 : type === 'firewall' ? 1 : type === 'database' ? 3 : 2;
}

function positionObservedNodes(nodes, width = 960, height = 520) {
  const layers = [...new Set(nodes.map(node => topologyLayer(node.type)))].sort((left, right) => left - right);
  const groups = new Map(layers.map(layer => [layer, []]));
  nodes.forEach(node => groups.get(topologyLayer(node.type)).push(node));
  const left = 48;
  const right = width - 168;
  return layers.flatMap((layer, layerIndex) => {
    const group = groups.get(layer);
    const x = layers.length === 1 ? (width - 120) / 2 : left + ((right - left) * layerIndex) / (layers.length - 1);
    const available = height - 104;
    return group.map((node, index) => ({
      ...node,
      position:{
        x:Math.round(x),
        y:Math.round(40 + (group.length === 1 ? available / 2 - 36 : (available * index) / (group.length - 1))),
      },
    }));
  });
}

/**
 * Builds a bounded map exclusively from equality relationships present in stored alert fields.
 * It never invents a firewall, route, asset, or connection that was not represented in evidence.
 */
export function buildObservedTopology(alerts, { maxNodes = 6 } = {}) {
  invariant(Array.isArray(alerts), 'Observed alerts must be an array');
  invariant(Number.isInteger(maxNodes) && maxNodes > 0, 'maxNodes must be a positive integer');
  const candidates = new Map();
  const relations = new Map();

  function addNode(node) {
    if (!node) return null;
    const existing = candidates.get(node.id) || { ...node, observations:0 };
    existing.observations += 1;
    candidates.set(node.id, existing);
    return node.id;
  }

  function addRelation(sourceNodeId, targetNodeId) {
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return;
    const id = `edge:${sourceNodeId}->${targetNodeId}`;
    const existing = relations.get(id) || { id, sourceNodeId, targetNodeId, state:'idle', observations:0 };
    existing.observations += 1;
    relations.set(id, existing);
  }

  alerts.forEach(alert => {
    const sourceId = addNode(observedNode('source', alert?.src_ip));
    const assetId = addNode(observedNode('asset', alert?.hostname || alert?.agent_name || alert?.dst_ip));
    const databaseId = addNode(observedNode('database', alert?.target_db));
    addRelation(sourceId, assetId || databaseId);
    addRelation(assetId, databaseId);
  });

  const rankedRelations = [...relations.values()].sort((left, right) => right.observations - left.observations || left.id.localeCompare(right.id));
  const selectedIds = new Set();
  rankedRelations.forEach(edge => {
    [edge.sourceNodeId, edge.targetNodeId].forEach(id => {
      if (selectedIds.size < maxNodes) selectedIds.add(id);
    });
  });
  [...candidates.values()]
    .sort((left, right) => right.observations - left.observations || left.id.localeCompare(right.id))
    .forEach(node => { if (selectedIds.size < maxNodes) selectedIds.add(node.id); });

  const selectedNodes = [...selectedIds].map(id => candidates.get(id)).filter(Boolean);
  const nodes = positionObservedNodes(selectedNodes).map(({ observations, ...node }) => ({ ...node, evidenceCount:observations }));
  const edges = rankedRelations
    .filter(edge => selectedIds.has(edge.sourceNodeId) && selectedIds.has(edge.targetNodeId))
    .map(edge => ({ ...edge }));
  const topology = { nodes, edges };
  validateNetworkTopology(topology);
  return { ...topology, evidenceCount:alerts.length };
}

function topologyNodeId(kind, value) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  return normalizedValue ? `${kind}:${normalizedValue}` : null;
}

function attackType(alert, title) {
  const evidence = [title, alert?.event_action, alert?.event_dataset, alert?.process, alert?.alert_reason]
    .filter(Boolean).join(' ');
  if (/contain|isolat|quarantin|block(ed|ing)?|prevented/i.test(evidence)) return 'containment';
  if (/credential|password|login|auth|mimikatz|lsass/i.test(evidence)) return 'credential';
  if (/lateral|psexec|remote service|\bsmb\b|winrm|pivot/i.test(evidence)) return 'lateral-movement';
  if (/database|file|export|exfil|data access|download/i.test(evidence)) return 'data-access';
  return 'access';
}

/** Maps one stored alert to the exact node/edge identifiers generated by buildObservedTopology. */
export function mapAlertToAttackEvent(alert, topology, { title, severity } = {}) {
  if (!alert || !topology?.nodes?.length) return null;
  const nodeIds = new Set(topology.nodes.map(node => node.id));
  const sourceId = topologyNodeId('source', alert.src_ip);
  const assetId = topologyNodeId('asset', alert.hostname || alert.agent_name || alert.dst_ip);
  const databaseId = topologyNodeId('database', alert.target_db);
  const affectedNodeId = [databaseId, assetId, sourceId].find(id => id && nodeIds.has(id));
  if (!affectedNodeId) return null;
  const relatedEdge = topology.edges.find(edge => edge.targetNodeId === affectedNodeId)
    || topology.edges.find(edge => edge.sourceNodeId === affectedNodeId)
    || null;
  const alertId = alert.id || alert.representative_alert_id || alert.elastic_alert_uuid || alert.group_key;
  if (!alertId) return null;
  const observedAt = new Date(alert.timestamp || alert.last_seen || alert.first_seen || Date.now());
  const timestamp = Number.isFinite(observedAt.getTime()) ? observedAt.toISOString() : new Date().toISOString();
  const affectedNode = topology.nodes.find(node => node.id === affectedNodeId);
  const detection = String(title || alert.rule_desc || alert.alert_reason || alert.event_action || 'Security activity').trim();
  const sourceText = alert.src_ip && sourceId !== affectedNodeId ? ` from ${alert.src_ip}` : '';
  return validateAttackEvent({
    id:`attack:${alertId}`,
    timestamp,
    message:`${detection} was observed on ${affectedNode.sublabel}${sourceText}`,
    eventType:attackType(alert, detection),
    severity:['critical', 'high', 'medium', 'low'].includes(severity) ? severity : 'low',
    affectedNodeId,
    affectedEdgeId:relatedEdge?.id || null,
    alertId:String(alertId),
  }, topology);
}

/** Applies one event snapshot to both node and edge state without mutating the evidence topology. */
export function applyAttackEventsToTopology(topology, events = [], { activeEventId } = {}) {
  validateNetworkTopology(topology);
  invariant(Array.isArray(events), 'Attack events must be an array');
  const nodeStates = new Map(topology.nodes.map(node => [node.id, node.state || 'idle']));
  const traversedEdges = new Set();
  events.forEach(event => {
    validateAttackEvent(event, topology);
    const nodeState = event.eventType === 'containment' ? 'contained'
      : event.severity === 'critical' ? 'compromised' : 'targeted';
    nodeStates.set(event.affectedNodeId, nodeState);
    if (event.affectedEdgeId) traversedEdges.add(event.affectedEdgeId);
  });
  const current = events.at(-1) || null;
  const active = activeEventId === undefined ? current : events.find(event => event.id === activeEventId) || null;
  return {
    ...topology,
    nodes:topology.nodes.map(node => ({ ...node, state:nodeStates.get(node.id) || 'idle' })),
    edges:topology.edges.map(edge => ({
      ...edge,
      state:active?.affectedEdgeId === edge.id && active.eventType !== 'containment'
        ? 'active-traversal'
        : traversedEdges.has(edge.id) ? 'traversed' : 'idle',
    })),
  };
}
