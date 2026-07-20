'use strict';

const { Router } = require('express');
const { requireRoles } = require('../middleware/auth');
const db = require('../db');
const { ActionError, createActionService } = require('../services/actions');

const router = Router();
const actions = createActionService(db);
const RESPONSE_TYPES = new Set(['endpoint_isolate','identity_suspend','ip_block']);
const STATES = new Set(['active','reverted']);

function handle(error, res) {
  if (error instanceof ActionError) {
    return res.status(error.status).json({ error: { code:error.code, message:error.message } });
  }
  if (error?.code === '22P02') return res.status(400).json({ error:'response id is invalid' });
  return res.status(500).json({ error:error.message });
}

router.get('/responses', async (req, res) => {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 50);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ error:'page and limit are invalid' });
    }
    if (req.query.state && !STATES.has(req.query.state)) return res.status(400).json({ error:'state is unsupported' });
    if (req.query.response_type && !RESPONSE_TYPES.has(req.query.response_type)) {
      return res.status(400).json({ error:'response_type is unsupported' });
    }
    const clauses = [];
    const params = [];
    if (req.query.state) clauses.push(`s.state=$${params.push(req.query.state)}`);
    if (req.query.response_type) clauses.push(`s.response_type=$${params.push(req.query.response_type)}`);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [items, count] = await Promise.all([
      db.query(`SELECT s.*,ar.reason,ar.requested_by,
        COALESCE((SELECT COUNT(*)::int FROM simulated_response_events e WHERE e.response_id=s.id),0) AS event_count
        FROM simulated_response_states s JOIN action_requests ar ON ar.id=s.action_request_id
        ${where} ORDER BY s.updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params,limit,(page - 1) * limit]),
      db.query(`SELECT COUNT(*)::int AS n FROM simulated_response_states s ${where}`, params),
    ]);
    res.json({ responses:items.rows, total:count.rows[0]?.n || 0, page, limit });
  } catch (error) { handle(error,res); }
});

router.get('/responses/:id', async (req, res) => {
  try {
    const result = await db.query(`SELECT s.*,ar.reason,ar.requested_by,ar.preview,
      COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.created_at) FILTER (WHERE e.id IS NOT NULL),'[]') AS events
      FROM simulated_response_states s
      JOIN action_requests ar ON ar.id=s.action_request_id
      LEFT JOIN simulated_response_events e ON e.response_id=s.id
      WHERE s.id=$1 GROUP BY s.id,ar.id`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error:'Simulated response not found' });
    res.json(result.rows[0]);
  } catch (error) { handle(error,res); }
});

router.post('/responses/simulate', requireRoles('soc_analyst', 'administrator'), async (req, res) => {
  try {
    const body = req.body || {};
    const result = await actions.submit({
      actionType:'response.simulate', targetId:body.target_id,
      parameters:{ response_type:body.response_type, evidence_alert_ids:body.evidence_alert_ids },
      reason:body.reason, actor:req.user?.username || 'unknown', requestId:req.id || null,
      idempotencyKey:body.idempotency_key || null,
    });
    res.status(202).json(result);
  } catch (error) { handle(error,res); }
});

router.post('/responses/:id/rollback', requireRoles('soc_analyst', 'administrator'), async (req, res) => {
  try {
    const result = await actions.submit({
      actionType:'response.rollback', targetId:req.params.id, parameters:{},
      reason:req.body?.reason, actor:req.user?.username || 'unknown', requestId:req.id || null,
      idempotencyKey:req.body?.idempotency_key || null,
    });
    res.status(202).json(result);
  } catch (error) { handle(error,res); }
});

module.exports = router;
