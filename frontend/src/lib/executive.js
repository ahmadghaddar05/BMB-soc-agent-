const GENERIC_DETECTION_NAMES = new Set([
  'critical security event detected',
  'high security event detected',
  'security event detected',
  'security alert',
  'critical alert',
  'event detected',
  'detection rule',
]);

const ACTION_LABELS = [
  [/credential[-_ ]?(dump|dumping)|lsass|sekurlsa/i, 'Credential dumping attempt'],
  [/power[-_ ]?shell/i, 'Suspicious PowerShell execution'],
  [/scheduled[-_ ]?task|schtasks|task[-_ ]?(create|creation)/i, 'Scheduled task persistence created'],
  [/successful[-_ ]?login.*(brute|fail)|login[-_ ]?success[-_ ]?after/i, 'Successful login following brute-force activity'],
  [/brute[-_ ]?force|password[-_ ]?spray|repeated[-_ ]?login[-_ ]?fail/i, 'Brute-force authentication attempt'],
  [/directory[-_ ]?replication|dcsync|replicating[-_ ]?directory/i, 'Unauthorized directory replication'],
  [/database.*(large[-_ ]?export|export)|large[-_ ]?database[-_ ]?export/i, 'Large database export'],
  [/web.*(large[-_ ]?export|export)|large[-_ ]?web[-_ ]?export/i, 'Large web data export'],
  [/malicious[-_ ]?(email|attachment)|invoice.*(macro|xlsm)/i, 'Malicious email attachment detected'],
  [/unauthori[sz]ed[-_ ]?game|game[-_ ]?(launch|application)/i, 'Unauthorized game application launched'],
  [/prohibited[-_ ]?(site|website)|adult[-_ ]?(site|content)|porn/i, 'Prohibited website accessed'],
  [/sensitive[-_ ]?file.*access/i, 'Sensitive file access detected'],
  [/data[-_ ]?exfil|large[-_ ]?export/i, 'Potential data exfiltration activity'],
];

export function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function severityOf(item = {}) {
  if (item.source_severity) return String(item.source_severity).toLowerCase();
  const level = asNumber(item.rule_level);
  return level >= 12 ? 'critical' : level >= 9 ? 'high' : level >= 6 ? 'medium' : 'low';
}

export function humanize(value) {
  return String(value || '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

export function displayReference(prefix, value) {
  if (value == null || value === '') return `${prefix}-UNASSIGNED`;
  return `${prefix}-${stableHash(value).slice(0, 8)}`;
}

export function alertReference(item) {
  const value = typeof item === 'object' && item !== null
    ? item.id || item.representative_alert_id || item.elastic_alert_uuid || item.group_key
    : item;
  return displayReference('ALT', value);
}

export function investigationReference(value) {
  const id = typeof value === 'object' && value !== null ? value.id : value;
  return displayReference('INV', id);
}

export function caseReference(value) {
  const id = typeof value === 'object' && value !== null ? value.id : value;
  return displayReference('CASE', id);
}

export function actionReference(value) {
  const id = typeof value === 'object' && value !== null ? value.id : value;
  return displayReference('REQ', id);
}

export function friendlyEvidenceText(value) {
  return String(value || '').replace(/elastic:[A-Za-z0-9_:.\-]+/g, match => alertReference(match));
}

function isGenericTitle(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized || GENERIC_DETECTION_NAMES.has(normalized) || /^critical security (event|activity)/.test(normalized);
}

function mappedActionLabel(item) {
  const candidates = [
    item.event_action,
    item.alert_reason,
    item.rule_desc,
    item.process,
    ...(Array.isArray(item.event_category) ? item.event_category : []),
  ].filter(Boolean).join(' ');
  return ACTION_LABELS.find(([pattern]) => pattern.test(candidates))?.[1] || null;
}

export function activityTitle(item = {}) {
  const ruleName = String(item.rule_desc || '').trim();
  if (!isGenericTitle(ruleName)) return ruleName;

  const mapped = mappedActionLabel(item);
  if (mapped) return mapped;

  const reason = String(item.alert_reason || '').trim();
  if (reason && !isGenericTitle(reason)) return reason;

  if (item.event_action) return `${humanize(item.event_action)} detected`;
  if (item.process) return `Suspicious ${humanize(item.process)} activity`;

  const dataset = String(item.event_dataset || '').toLowerCase();
  if (dataset.includes('endpoint') || dataset.includes('edr')) return 'Endpoint security behavior detected';
  if (dataset.includes('email')) return 'Suspicious email activity detected';
  if (dataset.includes('database')) return 'Database security activity detected';
  if (dataset.includes('web')) return 'Web application security activity detected';
  if (dataset.includes('ad') || dataset.includes('identity')) return 'Identity security activity detected';
  return 'Security behavior detected';
}

export function businessAssetLabel(value) {
  const item = typeof value === 'object' && value !== null ? value : { asset_key: value };
  const explicit = item.business_name || item.display_name;
  if (explicit && !/^\d{1,3}(\.\d{1,3}){3}$/.test(String(explicit))) return String(explicit);

  const raw = String(
    item.name || item.asset_key || item.hostname || item.agent_name || item.target_db || item.event_dataset || ''
  ).trim();
  if (!raw || /^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) return 'Unmapped infrastructure';

  const lowered = raw.toLowerCase();
  if (/customer.*(db|database)|crm.*(db|database)/.test(lowered)) return 'Customer Database';
  if (/\b(dc\d*|domain[-_ ]?controller|active[-_ ]?directory)\b/.test(lowered)) return 'Identity & Authentication Service';
  if (/mail|email|exchange/.test(lowered)) return 'Corporate Email';
  if (/\b(db|database|postgres|mysql|sql)/.test(lowered)) return 'Core Database Service';
  if (/web|portal|frontend|application/.test(lowered)) return 'Business Web Application';
  if (/\b(fin|finance|payroll)/.test(lowered)) return 'Finance Operations';
  if (/\b(hr|human[-_ ]?resources)/.test(lowered)) return 'Workforce Systems';
  if (/\b(dev|engineering)/.test(lowered)) return 'Engineering Workstation';
  return humanize(raw);
}

export function businessAssetType(value) {
  const item = typeof value === 'object' && value !== null ? value : { asset_key: value };
  if (item.asset_type || item.type) return humanize(item.asset_type || item.type);
  const raw = String(item.asset_key || item.hostname || item.target_db || item.event_dataset || '').toLowerCase();
  if (/dc|directory|identity|auth/.test(raw)) return 'Identity service';
  if (/db|database|sql|postgres/.test(raw)) return 'Data service';
  if (/mail|email|exchange/.test(raw)) return 'Communications service';
  if (/web|portal|application/.test(raw)) return 'Customer-facing service';
  if (/endpoint|workstation|desktop|laptop/.test(raw)) return 'Employee endpoint';
  return 'Business infrastructure';
}

export function affectedEntity(item = {}) {
  return item.business_name || item.username || item.hostname || item.agent_name || item.target_db
    || (item.event_dataset ? humanize(item.event_dataset) : 'Unmapped infrastructure');
}

export function impactTone(severity) {
  return ({ critical:'critical', high:'high', medium:'medium', low:'low' })[String(severity || '').toLowerCase()] || 'medium';
}

export function operationWin(operation = {}) {
  const type = String(operation.operation_type || 'workflow').toLowerCase();
  const source = operation.source_type === 'case' ? `Case ${operation.source_id}` : `Alert ${operation.source_id}`;
  const mapping = {
    create_investigation: ['Grounded investigation created', `The agent opened an evidence-backed investigation from ${source}.`],
    add_investigation_note: ['Investigation evidence updated', `The agent added a grounded finding to ${source}.`],
    add_case_note: ['Correlation findings preserved', `The agent recorded the latest evidence summary on ${source}.`],
    request_case_assignment: ['Case ownership workflow prepared', `The agent submitted an internal ownership request for ${source}.`],
    request_simulated_response: ['Response simulation prepared', `A simulation-only response was submitted for review. No external system changed.`],
  };
  const [title, summary] = mapping[type] || ['Automation workflow completed', `The agent completed an internal workflow for ${source}.`];
  return { title, summary, source };
}

export function pipelineState(agent = {}, collector = {}) {
  if (agent.enabled === false) return { stage:'disabled', message:'AI-assisted workflows are disabled by policy', active:false };
  if (agent.enabled == null) return { stage:'unknown', message:'Checking AI-assisted workflow status', active:false };
  const latestRun = agent.latest_run || {};
  const latestCollection = collector.latest_run || {};
  const runningOperation = (agent.recent_operations || []).find(item => item.status === 'running');
  const cycleRunning = Boolean(collector.collector?.cycle_active || collector.collector?.scheduler_running && latestCollection.status === 'running');

  if (runningOperation) {
    const labels = {
      create_investigation: 'Creating a grounded investigation',
      add_investigation_note: 'Adding evidence to an investigation',
      add_case_note: 'Updating a correlated case timeline',
      request_case_assignment: 'Preparing an ownership approval request',
      request_simulated_response: 'Preparing a response simulation for approval',
    };
    return { stage:'workflow', message:labels[runningOperation.operation_type] || 'Completing an internal SOC workflow', active:true };
  }
  if (cycleRunning) return { stage:'collect', message:'Collecting new detections from Elastic', active:true };
  if (latestRun.status === 'running') return { stage:'workflow', message:'Reviewing qualified evidence for internal workflow updates', active:true };
  if (asNumber(agent.pending_approvals) > 0) return { stage:'approval', message:`Waiting for analyst review on ${agent.pending_approvals} approval request${asNumber(agent.pending_approvals) === 1 ? '' : 's'}`, active:false };
  return { stage:'monitor', message:'Monitoring continuously — no AI-assisted work is currently queued', active:false };
}

export function technicalLink(selection = {}, detail = {}) {
  if (selection.type === 'risk-summary') return '/incidents?status=open';
  if (selection.type === 'metric') {
    if (detail.evidence_type === 'assets') return '/assets';
    if (detail.evidence_type === 'automation') return '/reports';
    return '/incidents?status=open';
  }
  const operation = selection.type === 'automation' ? { ...(selection.seed || {}), ...(detail || {}) } : null;
  if (selection.type === 'incident' || operation?.source_type === 'case') {
    const id = selection.type === 'incident' ? selection.id : operation.source_id;
    return `/incidents?incident=${encodeURIComponent(id)}`;
  }
  const id = operation?.source_id || detail.id || selection.seed?.representative_alert_id || selection.seed?.source_id || selection.id;
  const minutes = selection.type === 'asset' && [7,30,90].includes(Number(detail.window_days))
    ? Number(detail.window_days) * 1440
    : 'all';
  return `/alerts?time_range=${minutes}&search=${encodeURIComponent(id || '')}`;
}
