'use strict';

const crypto = require('crypto');
const net = require('net');
const db = require('../db');

const POLICY_VERSION = 'phase9-v1';
const POLICY = Object.freeze({
  'investigation.create': { targetType: 'investigation', approvalRequired: false },
  'investigation.add_note': { targetType: 'investigation', approvalRequired: false },
  'case.add_note': { targetType: 'case', approvalRequired: false },
  'investigation.update': { targetType: 'investigation', approvalRequired: true },
  'case.update': { targetType: 'case', approvalRequired: true },
  'response.simulate': { targetType: 'simulated_response', approvalRequired: true },
  'response.rollback': { targetType: 'simulated_response', approvalRequired: true },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ActionError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
    this.status = status;
  }
}

function cleanText(value, name, { required = false, max = 500 } = {}) {
  if (value == null || value === '') {
    if (required) throw new ActionError('ACTION_INVALID', `${name} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new ActionError('ACTION_INVALID', `${name} must be a string`);
  const cleaned = value.trim();
  if (required && !cleaned) throw new ActionError('ACTION_INVALID', `${name} is required`);
  if (cleaned.length > max) throw new ActionError('ACTION_INVALID', `${name} must be at most ${max} characters`);
  return cleaned || null;
}

function normalize(actionType, targetId, parameters) {
  const policy = POLICY[actionType];
  if (!policy) throw new ActionError('ACTION_FORBIDDEN', 'This action is not allowed by the Phase 9 policy', 403);
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new ActionError('ACTION_INVALID', 'parameters must be an object');
  }
  const allowed = {
    'investigation.create': ['title', 'search_query', 'alert_ids'],
    'investigation.add_note': ['body'],
    'case.add_note': ['body'],
    'investigation.update': ['title', 'owner', 'status'],
    'case.update': ['owner', 'status'],
    'response.simulate': ['response_type', 'evidence_alert_ids'],
    'response.rollback': [],
  }[actionType];
  const unknown = Object.keys(parameters).filter(key => !allowed.includes(key));
  if (unknown.length) throw new ActionError('ACTION_INVALID', `Unsupported parameters: ${unknown.join(', ')}`);

  let id = targetId == null ? '' : String(targetId).trim();
  let output;
  if (actionType === 'investigation.create') {
    const title = cleanText(parameters.title, 'title', { required: true, max: 200 });
    const searchQuery = cleanText(parameters.search_query, 'search_query', { max: 500 }) || '';
    if (!Array.isArray(parameters.alert_ids) || parameters.alert_ids.length < 1 || parameters.alert_ids.length > 100 ||
        parameters.alert_ids.some(item => typeof item !== 'string' || !item.trim() || item.length > 500)) {
      throw new ActionError('ACTION_INVALID', 'alert_ids must contain between 1 and 100 valid alert IDs');
    }
    id = 'new';
    output = { title, search_query: searchQuery, alert_ids: [...new Set(parameters.alert_ids.map(item => item.trim()))] };
  } else if (actionType === 'response.simulate') {
    id = cleanText(id, 'target_id', { required: true, max: 253 });
    if (!['endpoint_isolate','identity_suspend','ip_block'].includes(parameters.response_type)) {
      throw new ActionError('ACTION_INVALID', 'response_type is unsupported');
    }
    if (parameters.response_type === 'ip_block' && net.isIP(id) === 0) {
      throw new ActionError('ACTION_INVALID', 'ip_block target_id must be a valid IP address');
    }
    if (!Array.isArray(parameters.evidence_alert_ids) || parameters.evidence_alert_ids.length < 1 ||
        parameters.evidence_alert_ids.length > 100 || parameters.evidence_alert_ids.some(item =>
          typeof item !== 'string' || !item.trim() || item.length > 500)) {
      throw new ActionError('ACTION_INVALID', 'evidence_alert_ids must contain between 1 and 100 valid alert IDs');
    }
    output = {
      response_type: parameters.response_type,
      evidence_alert_ids: [...new Set(parameters.evidence_alert_ids.map(item => item.trim()))],
    };
  } else if (actionType === 'response.rollback') {
    if (!UUID.test(id)) throw new ActionError('ACTION_INVALID', 'response target_id must be a UUID');
    output = {};
  } else if (actionType.endsWith('.add_note')) {
    if (!id) throw new ActionError('ACTION_INVALID', 'target_id is required');
    if (policy.targetType === 'investigation' && !UUID.test(id)) {
      throw new ActionError('ACTION_INVALID', 'investigation target_id must be a UUID');
    }
    if (policy.targetType === 'case' && (!Number.isInteger(Number(id)) || Number(id) < 1 || Number(id) > 2147483647)) {
      throw new ActionError('ACTION_INVALID', 'case target_id must be a positive integer');
    }
    output = { body: cleanText(parameters.body, 'body', { required: true, max: 4000 }) };
  } else {
    if (!id) throw new ActionError('ACTION_INVALID', 'target_id is required');
    if (policy.targetType === 'investigation' && !UUID.test(id)) {
      throw new ActionError('ACTION_INVALID', 'investigation target_id must be a UUID');
    }
    if (policy.targetType === 'case' && (!Number.isInteger(Number(id)) || Number(id) < 1 || Number(id) > 2147483647)) {
      throw new ActionError('ACTION_INVALID', 'case target_id must be a positive integer');
    }
    output = {};
    if (Object.hasOwn(parameters, 'title')) output.title = cleanText(parameters.title, 'title', { required: true, max: 200 });
    if (Object.hasOwn(parameters, 'owner')) output.owner = cleanText(parameters.owner, 'owner', { max: 120 });
    if (Object.hasOwn(parameters, 'status')) output.status = parameters.status;
    if (!Object.keys(output).length) throw new ActionError('ACTION_INVALID', 'At least one update field is required');
    if (actionType === 'investigation.update' && output.status != null && !['open', 'closed'].includes(output.status)) {
      throw new ActionError('ACTION_INVALID', 'investigation status is unsupported');
    }
    if (actionType === 'case.update' && output.status != null && !['open', 'closed', 'false_positive'].includes(output.status)) {
      throw new ActionError('ACTION_INVALID', 'case status is unsupported');
    }
  }
  return { policy, targetId: id, parameters: output };
}

function stableKey(prefix, value) {
  return `${prefix}:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

async function executeAllowed(client, request, actor) {
  const { action_type: type, target_id: id, parameters: p } = request;
  if (type === 'investigation.create') {
    const result = await client.query(
      `WITH supplied AS (SELECT DISTINCT unnest($3::text[]) AS alert_id),
       valid AS (SELECT supplied.alert_id FROM supplied JOIN alerts ON alerts.id=supplied.alert_id),
       created AS (
         INSERT INTO investigations(title,search_query,owner,created_by)
         SELECT $1,$2,$4,$4 WHERE (SELECT COUNT(*) FROM supplied)=(SELECT COUNT(*) FROM valid)
         RETURNING id,title,status,owner,created_by,created_at,updated_at
       ), linked AS (
         INSERT INTO investigation_alerts(investigation_id,alert_id,added_by)
         SELECT created.id,valid.alert_id,$4 FROM created CROSS JOIN valid RETURNING alert_id
       ) SELECT created.*,COALESCE((SELECT array_agg(alert_id) FROM linked),'{}') AS alert_ids FROM created`,
      [p.title, p.search_query, p.alert_ids, actor]
    );
    if (!result.rows.length) return null;
    return { target_type: 'investigation', target_id: String(result.rows[0].id), record: result.rows[0] };
  }
  if (type === 'investigation.add_note') {
    const result = await client.query(
      `WITH added AS (INSERT INTO investigation_notes(investigation_id,body,author)
       SELECT id,$2,$3 FROM investigations WHERE id=$1
       RETURNING id,investigation_id,author,created_at),
       touched AS (UPDATE investigations SET updated_at=NOW() WHERE id=$1 AND EXISTS (SELECT 1 FROM added))
       SELECT * FROM added`, [id, p.body, actor]
    );
    return result.rows.length ? { target_type: 'investigation', target_id: id, record: result.rows[0] } : null;
  }
  if (type === 'case.add_note') {
    const result = await client.query(
      `WITH added AS (INSERT INTO case_notes(incident_id,body,author)
       SELECT id,$2,$3 FROM incidents WHERE id=$1
       RETURNING id,incident_id,author,created_at),
       touched AS (UPDATE incidents SET updated_at=NOW() WHERE id=$1 AND EXISTS (SELECT 1 FROM added))
       SELECT * FROM added`, [id, p.body, actor]
    );
    return result.rows.length ? { target_type: 'case', target_id: id, record: result.rows[0] } : null;
  }
  if (type === 'response.simulate') {
    const inserted = await client.query(
      `INSERT INTO simulated_response_states(
         response_type,target_value,evidence_alert_ids,action_request_id,executed_by
       ) SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS (
         SELECT 1 FROM simulated_response_states
         WHERE response_type=$1 AND LOWER(target_value)=LOWER($2) AND state='active'
       ) RETURNING *`,
      [p.response_type, id, p.evidence_alert_ids, request.id, actor]
    );
    if (!inserted.rows.length) return null;
    const response = inserted.rows[0];
    await client.query(
      `INSERT INTO simulated_response_events(response_id,action_request_id,event_type,actor,details)
       VALUES($1,$2,'executed',$3,$4)`,
      [response.id, request.id, actor, { simulation: true, external_side_effects: false }]
    );
    const verification = {
      verified: true, mode: 'simulation_only', connector: 'bmb-simulated-response',
      expected_state: 'active', observed_state: 'active', external_side_effects: false,
    };
    const verified = await client.query(
      `UPDATE simulated_response_states SET verified_at=NOW(),verification=$2,updated_at=NOW()
       WHERE id=$1 AND state='active' RETURNING *`, [response.id, verification]
    );
    if (!verified.rows.length) return null;
    await client.query(
      `INSERT INTO simulated_response_events(response_id,action_request_id,event_type,actor,details)
       VALUES($1,$2,'verified',$3,$4)`, [response.id, request.id, actor, verification]
    );
    return {
      target_type: 'simulated_response', target_id: String(response.id),
      record: { ...verified.rows[0], simulation: true, external_side_effects: false },
    };
  }
  if (type === 'response.rollback') {
    const reverted = await client.query(
      `UPDATE simulated_response_states SET state='reverted',rollback_action_request_id=$2,
         reverted_by=$3,reverted_at=NOW(),updated_at=NOW(),
         verification=$4,verified_at=NOW()
       WHERE id=$1 AND state='active' RETURNING *`,
      [id, request.id, actor, {
        verified: true, mode: 'simulation_only', expected_state: 'reverted',
        observed_state: 'reverted', external_side_effects: false,
      }]
    );
    if (!reverted.rows.length) return null;
    await client.query(
      `INSERT INTO simulated_response_events(response_id,action_request_id,event_type,actor,details)
       VALUES($1,$2,'reverted',$3,$4)`,
      [id, request.id, actor, { simulation: true, verified: true, external_side_effects: false }]
    );
    return {
      target_type: 'simulated_response', target_id: id,
      record: { ...reverted.rows[0], simulation: true, external_side_effects: false },
    };
  }
  const fields = Object.keys(p);
  const values = fields.map(key => p[key]);
  const assignments = fields.map((key, index) => `${key}=$${index + 1}`).join(',');
  values.push(id);
  const table = type === 'investigation.update' ? 'investigations' : 'incidents';
  const result = await client.query(
    `UPDATE ${table} SET ${assignments},updated_at=NOW() WHERE id=$${values.length}
     RETURNING id,title,status,owner,updated_at`, values
  );
  if (!result.rows.length) return null;
  return { target_type: type.startsWith('investigation.') ? 'investigation' : 'case', target_id: id, record: result.rows[0] };
}

async function targetExists(client, type, id, parameters) {
  if (type === 'investigation.create') {
    const result = await client.query('SELECT COUNT(*)::int AS n FROM alerts WHERE id=ANY($1::text[])', [parameters.alert_ids]);
    return result.rows[0]?.n === parameters.alert_ids.length;
  }
  if (type === 'response.simulate') {
    const duplicate = await client.query(
      `SELECT 1 FROM action_requests WHERE action_type='response.simulate'
       AND target_id=$1 AND parameters->>'response_type'=$2 AND status IN ('pending','approved') LIMIT 1`,
      [id, parameters.response_type]
    );
    if (duplicate.rows.length) {
      throw new ActionError('RESPONSE_ALREADY_PENDING', 'A matching simulated response is already awaiting a decision', 409);
    }
    const active = await client.query(
      `SELECT 1 FROM simulated_response_states
       WHERE response_type=$1 AND LOWER(target_value)=LOWER($2) AND state='active' LIMIT 1`,
      [parameters.response_type, id]
    );
    if (active.rows.length) {
      throw new ActionError('RESPONSE_ALREADY_ACTIVE', 'A matching simulated response is already active', 409);
    }
    const condition = parameters.response_type === 'endpoint_isolate'
      ? '(LOWER(hostname)=LOWER($2) OR LOWER(agent_name)=LOWER($2))'
      : parameters.response_type === 'identity_suspend'
        ? 'LOWER(username)=LOWER($2)'
        : '(src_ip=$2 OR dst_ip=$2)';
    const evidence = await client.query(
      `WITH supplied AS (SELECT DISTINCT unnest($1::text[]) AS id),
       valid AS (SELECT a.id FROM alerts a JOIN supplied s ON s.id=a.id),
       matched AS (SELECT a.id FROM alerts a JOIN supplied s ON s.id=a.id WHERE ${condition})
       SELECT (SELECT COUNT(*)::int FROM supplied) AS supplied,
         (SELECT COUNT(*)::int FROM valid) AS valid,
         (SELECT COUNT(*)::int FROM matched) AS matched`,
      [parameters.evidence_alert_ids, id]
    );
    const counts = evidence.rows[0] || {};
    return counts.supplied === counts.valid && counts.matched > 0;
  }
  if (type === 'response.rollback') {
    const duplicate = await client.query(
      `SELECT 1 FROM action_requests WHERE action_type='response.rollback'
       AND target_id=$1 AND status IN ('pending','approved') LIMIT 1`, [id]
    );
    if (duplicate.rows.length) {
      throw new ActionError('RESPONSE_ROLLBACK_PENDING', 'A rollback for this simulated response is already awaiting a decision', 409);
    }
    const result = await client.query(
      `SELECT 1 FROM simulated_response_states WHERE id=$1 AND state='active'`, [id]
    );
    return result.rows.length > 0;
  }
  const table = type.startsWith('investigation.') ? 'investigations' : 'incidents';
  const result = await client.query(`SELECT 1 FROM ${table} WHERE id=$1`, [id]);
  return result.rows.length > 0;
}

async function actionPreview(client, type, id, parameters) {
  if (type === 'response.simulate') {
    const effects = {
      endpoint_isolate: 'Mark the evidenced endpoint isolated inside the BMB simulation ledger.',
      identity_suspend: 'Mark the evidenced identity suspended inside the BMB simulation ledger.',
      ip_block: 'Mark the evidenced IP blocked inside the BMB simulation ledger.',
    };
    return {
      mode: 'simulation_only', connector: 'bmb-simulated-response',
      response_type: parameters.response_type, target: id,
      evidence_alert_ids: parameters.evidence_alert_ids,
      intended_effect: effects[parameters.response_type],
      external_side_effects: false, reversible: true, approval_required: true,
    };
  }
  if (type === 'response.rollback') {
    const current = await client.query(
      `SELECT id,response_type,target_value,state FROM simulated_response_states WHERE id=$1`, [id]
    );
    return {
      mode: 'simulation_only', connector: 'bmb-simulated-response',
      response_id: id, current_state: current.rows[0]?.state || 'unknown',
      response_type: current.rows[0]?.response_type || null,
      target: current.rows[0]?.target_value || null,
      intended_effect: 'Revert the selected simulated response state.',
      external_side_effects: false, reversible: false, approval_required: true,
    };
  }
  return null;
}

function createActionService(database = db) {
  async function submit({ actionType, targetId, parameters, reason, actor = 'unknown', requestId = null, runId = null, idempotencyKey = null }) {
    const normalized = normalize(actionType, targetId, parameters);
    const why = cleanText(reason, 'reason', { required: true, max: 1000 });
    const key = idempotencyKey || `manual:${crypto.randomUUID()}`;
    if (typeof key !== 'string' || !key || key.length > 200) throw new ActionError('ACTION_INVALID', 'idempotency_key is invalid');
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT * FROM action_requests WHERE idempotency_key=$1', [key]);
      if (existing.rows.length) {
        await client.query('COMMIT');
        return { action_request: existing.rows[0], idempotent_replay: true };
      }
      if (!await targetExists(client, actionType, normalized.targetId, normalized.parameters)) {
        throw new ActionError('ACTION_TARGET_NOT_FOUND', 'The action target or supplied evidence does not exist', 404);
      }
      const preview = await actionPreview(client, actionType, normalized.targetId, normalized.parameters);
      const inserted = await client.query(
        `INSERT INTO action_requests(run_id,action_type,target_type,target_id,requested_by,status,
          parameters,reason,policy_version,approval_required,idempotency_key,preview)
         VALUES($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10,$11)
         ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING *`,
        [runId, actionType, normalized.policy.targetType, normalized.targetId, actor,
          normalized.parameters, why, POLICY_VERSION, normalized.policy.approvalRequired, key, preview]
      );
      if (!inserted.rows.length) {
        const raced = await client.query('SELECT * FROM action_requests WHERE idempotency_key=$1', [key]);
        if (!raced.rows.length) throw new ActionError('ACTION_IDEMPOTENCY_CONFLICT', 'The action request could not be resolved', 409);
        await client.query('COMMIT');
        return { action_request: raced.rows[0], idempotent_replay: true };
      }
      let action = inserted.rows[0];
      let result = null;
      if (!normalized.policy.approvalRequired) {
        result = await executeAllowed(client, action, actor);
        if (!result) throw new ActionError('ACTION_EXECUTION_FAILED', 'The action target was unavailable', 409);
        const updated = await client.query(
          `UPDATE action_requests SET status='executed',target_id=$2,executed_at=NOW(),executed_by=$3,result=$4
           WHERE id=$1 RETURNING *`, [action.id, result.target_id, actor, result]
        );
        action = updated.rows[0];
      }
      await client.query(
        `INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
         VALUES($1,$2,'action_request',$3,'success',$4,$5)`,
        [actor, normalized.policy.approvalRequired ? 'action.requested' : 'action.executed', action.id, requestId,
          { action_type: actionType, target_type: action.target_type, target_id: action.target_id, policy_version: POLICY_VERSION }]
      );
      await client.query('COMMIT');
      return { action_request: action, result, idempotent_replay: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async function decide({ id, decision, reason, actor = 'unknown', requestId = null }) {
    if (!['approved', 'denied'].includes(decision)) throw new ActionError('ACTION_INVALID', 'decision must be approved or denied');
    const why = cleanText(reason, 'reason', { required: true, max: 1000 });
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT * FROM action_requests WHERE id=$1 FOR UPDATE', [id]);
      if (!locked.rows.length) throw new ActionError('ACTION_NOT_FOUND', 'Action request not found', 404);
      let action = locked.rows[0];
      if (action.status !== 'pending') throw new ActionError('ACTION_ALREADY_DECIDED', 'Action request is no longer pending', 409);
      await client.query(
        'INSERT INTO action_approvals(action_request_id,decided_by,decision,reason) VALUES($1,$2,$3,$4)',
        [id, actor, decision, why]
      );
      let result = null;
      if (decision === 'denied') {
        action = (await client.query("UPDATE action_requests SET status='denied' WHERE id=$1 RETURNING *", [id])).rows[0];
      } else {
        await client.query("UPDATE action_requests SET status='approved',approved_at=NOW() WHERE id=$1", [id]);
        result = await executeAllowed(client, action, actor);
        if (result) {
          action = (await client.query(
            `UPDATE action_requests SET status='executed',executed_at=NOW(),executed_by=$2,result=$3
             WHERE id=$1 RETURNING *`, [id, actor, result]
          )).rows[0];
        } else {
          action = (await client.query(
            `UPDATE action_requests SET status='failed',executed_at=NOW(),executed_by=$2,error_code='ACTION_TARGET_NOT_FOUND'
             WHERE id=$1 RETURNING *`, [id, actor]
          )).rows[0];
        }
      }
      await client.query(
        `INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
         VALUES($1,'action.decided','action_request',$2,$3,$4,$5)`,
        [actor, id, decision === 'denied' ? 'denied' : result ? 'success' : 'failure', requestId,
          { decision, reason: why, final_status: action.status }]
      );
      await client.query('COMMIT');
      return { action_request: action, decision, result };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  return { submit, decide };
}

module.exports = { ActionError, POLICY, POLICY_VERSION, createActionService, normalize, stableKey };
