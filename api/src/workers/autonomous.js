'use strict';

const crypto = require('crypto');
const db = require('../db');
const { createActionService } = require('../services/actions');

const POLICY_VERSION = 'phase9-v1';
const ACTOR = 'system:autonomous-agent';
const QUALIFYING_VERDICTS = new Set(['true_positive', 'needs_investigation']);

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
}

function boundedConfidence(value, fallback = 0.7) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : fallback;
}

function compact(value, max = 4000) {
  const text = String(value || '').trim();
  return text.length <= max ? text : `${text.slice(0, max - 14)}\n[truncated]`;
}

function operationKey(type, sourceType, sourceId, version = 'initial') {
  const raw = `${POLICY_VERSION}:${type}:${sourceType}:${sourceId}:${version}`;
  if (raw.length <= 200) return raw;
  return `${POLICY_VERSION}:${type}:${crypto.createHash('sha256').update(raw).digest('hex')}`;
}

function actionSummary(result) {
  const request = result.action_request || {};
  return {
    action_request_id: request.id || null,
    action_status: request.status || null,
    target_type: request.target_type || result.result?.target_type || null,
    target_id: request.target_id || result.result?.target_id || null,
    idempotent_replay: Boolean(result.idempotent_replay),
  };
}

function simulatedResponseProposal(incident) {
  const entities = incident?.common_entities || {};
  const first = values => Array.isArray(values)
    ? values.map(value => String(value || '').trim()).find(Boolean)
    : null;
  const host = first(entities.hosts);
  if (host) return { response_type:'endpoint_isolate', target_id:host };
  const identity = first(entities.users);
  if (identity) return { response_type:'identity_suspend', target_id:identity };
  const ip = first(entities.ips);
  if (ip) return { response_type:'ip_block', target_id:ip };
  return null;
}

async function startOperation(database, details) {
  const inserted = await database.query(
    `INSERT INTO autonomous_operations(
       run_id,operation_key,operation_type,source_type,source_id,status,reason
     ) VALUES($1,$2,$3,$4,$5,'running',$6)
     ON CONFLICT (operation_key) DO NOTHING RETURNING *`,
    [details.runId, details.key, details.type, details.sourceType, details.sourceId, details.reason]
  );
  if (inserted.rows.length) return { row: inserted.rows[0], replay: false };

  const existing = await database.query(
    'SELECT * FROM autonomous_operations WHERE operation_key=$1', [details.key]
  );
  const row = existing.rows[0];
  if (!row) throw new Error('Autonomous operation idempotency state disappeared');
  if (row.status === 'completed' || row.status === 'skipped') return { row, replay: true };

  const retried = await database.query(
    `UPDATE autonomous_operations SET run_id=$2,status='running',attempts=attempts+1,
       reason=$3,error_code=NULL,error=NULL,started_at=NOW(),finished_at=NULL,updated_at=NOW()
     WHERE operation_key=$1 RETURNING *`,
    [details.key, details.runId, details.reason]
  );
  return { row: retried.rows[0], replay: false };
}

async function executeOperation(database, details, execute) {
  const state = await startOperation(database, details);
  if (state.replay) return state.row.result || {};
  try {
    const result = await execute();
    await database.query(
      `UPDATE autonomous_operations SET status='completed',target_type=$2,target_id=$3,
         result=$4,finished_at=NOW(),updated_at=NOW() WHERE id=$1`,
      [state.row.id, result.target_type || null, result.target_id || null, result]
    );
    return result;
  } catch (error) {
    await database.query(
      `UPDATE autonomous_operations SET status='failed',error_code=$2,error=$3,
         finished_at=NOW(),updated_at=NOW() WHERE id=$1`,
      [state.row.id, error.code || 'AUTONOMOUS_OPERATION_FAILED', compact(error.message || error, 1000)]
    );
    throw error;
  }
}

function incidentNote(incident) {
  const actions = Array.isArray(incident.recommended_actions) ? incident.recommended_actions : [];
  return compact([
    'Autonomous SOC correlation update (validated stored evidence only).',
    `Case: ${incident.title || `Case ${incident.id}`}`,
    `Severity: ${incident.severity || 'unknown'}; confidence: ${Math.round(Number(incident.confidence || 0) * 100)}%.`,
    `Evidence alerts: ${(incident.alert_ids || []).join(', ') || 'none'}.`,
    incident.narrative ? `Assessment: ${incident.narrative}` : null,
    actions.length ? `Recommended analyst checks: ${actions.join('; ')}` : null,
    'No containment, closure, or false-positive decision was executed.',
  ].filter(Boolean).join('\n'));
}

function alertNote(alert) {
  const verdict = alert.verdict || {};
  const actions = Array.isArray(verdict.recommended_actions) ? verdict.recommended_actions : [];
  return compact([
    'Autonomous SOC triage finding (validated stored evidence only).',
    `Alert: ${alert.id} — ${alert.rule_desc || 'Security alert'}.`,
    `Severity: ${alert.source_severity || 'unknown'}; verdict: ${verdict.verdict}; confidence: ${Math.round(Number(verdict.confidence || 0) * 100)}%.`,
    alert.hostname ? `Host: ${alert.hostname}.` : null,
    alert.username ? `Identity: ${alert.username}.` : null,
    alert.src_ip ? `Source IP: ${alert.src_ip}.` : null,
    verdict.summary ? `Assessment: ${verdict.summary}` : null,
    actions.length ? `Recommended analyst checks: ${actions.join('; ')}` : null,
    'No containment, closure, or false-positive decision was executed.',
  ].filter(Boolean).join('\n'));
}

async function loadCandidates(database, settings) {
  const hours = boundedInt(settings.autonomous_lookback_hours, 24, 1, 168);
  const limit = boundedInt(settings.autonomous_max_items, 20, 1, 100);
  const confidence = boundedConfidence(settings.autonomous_min_confidence, 0.7);
  const poolLimit = Math.min(300, limit * 3);
  const incidents = await database.query(
    `SELECT id,title,severity,confidence,alert_ids,narrative,recommended_actions,
       common_entities,owner,correlation_run_id,updated_at
     FROM incidents
     WHERE status='open' AND severity IN ('high','critical') AND confidence >= $1
       AND COALESCE(last_seen,updated_at)>=NOW()-($2 || ' hours')::interval
     ORDER BY CASE severity WHEN 'critical' THEN 2 ELSE 1 END DESC,
       confidence DESC,updated_at DESC LIMIT $3`,
    [confidence, String(hours), poolLimit]
  );
  const alerts = await database.query(
    `SELECT id,rule_desc,source_severity,rule_level,hostname,username,src_ip,dst_ip,
       process,verdict,triage_run_id,signature,triaged_at
     FROM alerts a
     WHERE triage_status='triaged' AND auto_closed=false
       AND COALESCE(source_severity,CASE WHEN rule_level>=12 THEN 'critical' WHEN rule_level>=9 THEN 'high' END)
           IN ('high','critical')
       AND verdict->>'verdict'=ANY($1::text[])
       AND CASE
         WHEN COALESCE(verdict->>'confidence','') ~ '^(0([.][0-9]+)?|1([.]0+)?)$'
           THEN (verdict->>'confidence')::double precision
         ELSE 0
       END >= $2
       AND COALESCE(triaged_at,timestamp)>=NOW()-($3 || ' hours')::interval
       AND NOT EXISTS (SELECT 1 FROM incidents i WHERE i.status='open' AND a.id=ANY(i.alert_ids))
     ORDER BY rule_level DESC,COALESCE(triaged_at,timestamp) DESC LIMIT $4`,
    [[...QUALIFYING_VERDICTS], confidence, String(hours), poolLimit]
  );
  const assignmentEnabled = String(settings.autonomous_assignment_enabled || 'true') === 'true';
  const responseProposalsEnabled = String(settings.simulated_response_proposals_enabled || 'false') === 'true';
  const incidentKeys = new Map(incidents.rows.map(incident => {
    const version = incident.correlation_run_id || new Date(incident.updated_at).toISOString();
    const keys = [
      operationKey('create-investigation', 'case', incident.id),
      operationKey('investigation-note', 'case', incident.id, version),
      operationKey('case-note', 'case', incident.id, version),
    ];
    if (assignmentEnabled && incident.severity === 'critical' && !incident.owner) {
      keys.push(operationKey('request-assignment', 'case', incident.id));
    }
    if (responseProposalsEnabled && incident.severity === 'critical' && simulatedResponseProposal(incident)) {
      keys.push(operationKey('request-simulated-response', 'case', incident.id, version));
    }
    return [String(incident.id), keys];
  }));
  const alertKeys = new Map(alerts.rows.map(alert => {
    const version = alert.triage_run_id || alert.signature || 'triaged';
    return [String(alert.id), [
      operationKey('create-investigation', 'alert', alert.id),
      operationKey('investigation-note', 'alert', alert.id, version),
    ]];
  }));
  const keys = [...incidentKeys.values(), ...alertKeys.values()].flat();
  const completed = keys.length
    ? await database.query(
      `SELECT operation_key FROM autonomous_operations
       WHERE status='completed' AND operation_key=ANY($1::text[])`, [keys]
    )
    : { rows: [] };
  const completedKeys = new Set(completed.rows.map(row => row.operation_key));
  return {
    incidents: incidents.rows.filter(item =>
      incidentKeys.get(String(item.id)).some(key => !completedKeys.has(key))
    ).slice(0, limit),
    alerts: alerts.rows.filter(item =>
      alertKeys.get(String(item.id)).some(key => !completedKeys.has(key))
    ).slice(0, limit),
  };
}

async function runAutonomousAgent(settings = {}, fetchRunId = null, {
  database = db, actionService = createActionService(database), trigger = 'scheduler', actor = ACTOR,
} = {}) {
  const started = await database.query(
    `INSERT INTO autonomous_runs(fetch_run_id,trigger,status,policy_version)
     VALUES($1,$2,'running',$3) RETURNING *`,
    [fetchRunId, trigger, POLICY_VERSION]
  );
  const run = started.rows[0];
  const requestId = crypto.randomUUID();
  try {
    const { incidents, alerts } = await loadCandidates(database, settings);
    const assignmentEnabled = String(settings.autonomous_assignment_enabled || 'true') === 'true';
    const responseProposalsEnabled = String(settings.simulated_response_proposals_enabled || 'false') === 'true';
    const defaultOwner = compact(settings.autonomous_default_owner || 'SOC Analyst', 120);

    for (const incident of incidents) {
      try {
        const version = incident.correlation_run_id || new Date(incident.updated_at).toISOString();
        const createKey = operationKey('create-investigation', 'case', incident.id);
        const created = await executeOperation(database, {
          runId: run.id, key: createKey, type: 'create_investigation', sourceType: 'case',
          sourceId: String(incident.id), reason: 'High-confidence correlated case qualifies for autonomous investigation.',
        }, async () => actionSummary(await actionService.submit({
          actionType: 'investigation.create', targetId: null,
          parameters: {
            title: compact(`Autonomous investigation — ${incident.title || `Case ${incident.id}`}`, 200),
            search_query: `case:${incident.id}`,
            alert_ids: (incident.alert_ids || []).slice(0, 100),
          },
          reason: 'Create an internal investigation from validated high-confidence correlation evidence.',
          actor, requestId, idempotencyKey: createKey,
        })));
        const investigationId = created.target_id;
        if (!investigationId) throw new Error('Autonomous investigation action returned no target ID');

        const noteKey = operationKey('investigation-note', 'case', incident.id, version);
        await executeOperation(database, {
          runId: run.id, key: noteKey, type: 'add_investigation_note', sourceType: 'case',
          sourceId: String(incident.id), reason: 'Attach the latest grounded correlation finding to the investigation.',
        }, async () => actionSummary(await actionService.submit({
          actionType: 'investigation.add_note', targetId: investigationId,
          parameters: { body: incidentNote(incident) },
          reason: 'Preserve the validated correlation finding in the investigation timeline.',
          actor, requestId, idempotencyKey: noteKey,
        })));

        const caseNoteKey = operationKey('case-note', 'case', incident.id, version);
        await executeOperation(database, {
          runId: run.id, key: caseNoteKey, type: 'add_case_note', sourceType: 'case',
          sourceId: String(incident.id), reason: 'Record autonomous correlation findings on the case.',
        }, async () => actionSummary(await actionService.submit({
          actionType: 'case.add_note', targetId: String(incident.id),
          parameters: { body: incidentNote(incident) },
          reason: 'Preserve validated AI correlation evidence without changing case disposition.',
          actor, requestId, idempotencyKey: caseNoteKey,
        })));

        if (assignmentEnabled && incident.severity === 'critical' && !incident.owner) {
          const assignmentKey = operationKey('request-assignment', 'case', incident.id);
          await executeOperation(database, {
            runId: run.id, key: assignmentKey, type: 'request_case_assignment', sourceType: 'case',
            sourceId: String(incident.id), reason: 'Critical unowned case requires analyst approval for assignment.',
          }, async () => actionSummary(await actionService.submit({
            actionType: 'case.update', targetId: String(incident.id),
            parameters: { owner: defaultOwner },
            reason: 'Propose human ownership for a critical correlated case; approval is required before execution.',
            actor, requestId, idempotencyKey: assignmentKey,
          })));
        }

        const response = simulatedResponseProposal(incident);
        if (responseProposalsEnabled && incident.severity === 'critical' && response) {
          const responseKey = operationKey('request-simulated-response', 'case', incident.id, version);
          await executeOperation(database, {
            runId: run.id, key: responseKey, type: 'request_simulated_response', sourceType: 'case',
            sourceId: String(incident.id), reason: 'Critical correlated evidence qualifies for a reversible response simulation proposal.',
          }, async () => actionSummary(await actionService.submit({
            actionType: 'response.simulate', targetId: response.target_id,
            parameters: {
              response_type: response.response_type,
              evidence_alert_ids: (incident.alert_ids || []).slice(0, 100),
            },
            reason: 'Propose a BMB-only response simulation for analyst review. Approval is required and no external system will be changed.',
            actor, requestId, idempotencyKey: responseKey,
          })));
        }
      } catch (error) {
        console.error(`[autonomous] case ${incident.id} failed:`, error.message || error);
      }
    }

    for (const alert of alerts) {
      try {
        const version = alert.triage_run_id || alert.signature || 'triaged';
        const createKey = operationKey('create-investigation', 'alert', alert.id);
        const created = await executeOperation(database, {
          runId: run.id, key: createKey, type: 'create_investigation', sourceType: 'alert',
          sourceId: alert.id, reason: 'High-confidence standalone alert qualifies for autonomous investigation.',
        }, async () => actionSummary(await actionService.submit({
          actionType: 'investigation.create', targetId: null,
          parameters: {
            title: compact(`Autonomous investigation — ${alert.rule_desc || alert.id}`, 200),
            search_query: `alert:${alert.id}`,
            alert_ids: [alert.id],
          },
          reason: 'Create an internal investigation from a validated high-confidence triage verdict.',
          actor, requestId, idempotencyKey: createKey,
        })));
        if (!created.target_id) throw new Error('Autonomous investigation action returned no target ID');
        const noteKey = operationKey('investigation-note', 'alert', alert.id, version);
        await executeOperation(database, {
          runId: run.id, key: noteKey, type: 'add_investigation_note', sourceType: 'alert',
          sourceId: alert.id, reason: 'Attach the grounded triage finding to the investigation.',
        }, async () => actionSummary(await actionService.submit({
          actionType: 'investigation.add_note', targetId: created.target_id,
          parameters: { body: alertNote(alert) },
          reason: 'Preserve the validated triage finding in the investigation timeline.',
          actor, requestId, idempotencyKey: noteKey,
        })));
      } catch (error) {
        console.error(`[autonomous] alert ${alert.id} failed:`, error.message || error);
      }
    }

    const counted = await database.query(
      `SELECT status,operation_type,COUNT(*)::int AS n FROM autonomous_operations
       WHERE run_id=$1 GROUP BY status,operation_type`, [run.id]
    );
    const metrics = {
      candidates: incidents.length + alerts.length,
      cases_considered: incidents.length,
      alerts_considered: alerts.length,
      investigations_created: 0,
      investigation_notes_added: 0,
      case_notes_added: 0,
      approvals_requested: 0,
      simulated_responses_proposed: 0,
      failures: 0,
    };
    for (const row of counted.rows) {
      if (row.status === 'failed') metrics.failures += row.n;
      if (row.status !== 'completed') continue;
      if (row.operation_type === 'create_investigation') metrics.investigations_created += row.n;
      if (row.operation_type === 'add_investigation_note') metrics.investigation_notes_added += row.n;
      if (row.operation_type === 'add_case_note') metrics.case_notes_added += row.n;
      if (row.operation_type === 'request_case_assignment') metrics.approvals_requested += row.n;
      if (row.operation_type === 'request_simulated_response') {
        metrics.simulated_responses_proposed += row.n;
        metrics.approvals_requested += row.n;
      }
    }
    const status = metrics.failures ? 'partial' : 'completed';
    await database.query(
      `UPDATE autonomous_runs SET status=$2,metrics=$3,finished_at=NOW() WHERE id=$1`,
      [run.id, status, metrics]
    );
    return { run_id: run.id, status, policy_version: POLICY_VERSION, metrics };
  } catch (error) {
    await database.query(
      `UPDATE autonomous_runs SET status='failed',error=$2,finished_at=NOW() WHERE id=$1`,
      [run.id, compact(error.message || error, 1000)]
    );
    throw error;
  }
}

module.exports = {
  ACTOR, POLICY_VERSION, QUALIFYING_VERDICTS, alertNote, boundedConfidence,
  incidentNote, loadCandidates, operationKey, runAutonomousAgent, simulatedResponseProposal,
};
