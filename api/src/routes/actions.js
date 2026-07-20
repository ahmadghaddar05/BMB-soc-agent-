'use strict';

const { Router } = require('express');
const db = require('../db');
const { ActionError, POLICY, POLICY_VERSION, createActionService } = require('../services/actions');
const { requireRoles } = require('../middleware/auth');

const router = Router();
const actions = createActionService(db);
const STATUSES = new Set(['pending', 'approved', 'denied', 'cancelled', 'executed', 'failed']);

function handle(error, res) {
  if (error instanceof ActionError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  if (error?.code === '22P02') return res.status(400).json({ error: 'action request id is invalid' });
  return res.status(500).json({ error: error.message });
}

router.get('/action-policy', (_req, res) => res.json({ version: POLICY_VERSION, actions: POLICY }));

router.get('/actions', async (req, res) => {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 50);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ error: 'page and limit are invalid' });
    }
    if (req.query.status && !STATUSES.has(req.query.status)) return res.status(400).json({ error: 'status is unsupported' });
    const params = [];
    const where = req.query.status ? `WHERE ar.status=$${params.push(req.query.status)}` : '';
    const [items, count] = await Promise.all([
      db.query(`SELECT ar.*,COALESCE(jsonb_agg(jsonb_build_object(
        'decision',aa.decision,'decided_by',aa.decided_by,'reason',aa.reason,'created_at',aa.created_at
      )) FILTER (WHERE aa.id IS NOT NULL),'[]') AS approvals
      FROM action_requests ar LEFT JOIN action_approvals aa ON aa.action_request_id=ar.id
      ${where} GROUP BY ar.id ORDER BY ar.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]),
      db.query(`SELECT COUNT(*)::int AS n FROM action_requests ar ${where}`, params),
    ]);
    res.json({ actions: items.rows, total: count.rows[0]?.n || 0, page, limit });
  } catch (error) { handle(error, res); }
});

router.get('/actions/:id', async (req, res) => {
  try {
    const result = await db.query(`SELECT ar.*,COALESCE(jsonb_agg(to_jsonb(aa) ORDER BY aa.created_at)
      FILTER (WHERE aa.id IS NOT NULL),'[]') AS approvals
      FROM action_requests ar LEFT JOIN action_approvals aa ON aa.action_request_id=ar.id
      WHERE ar.id=$1 GROUP BY ar.id`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Action request not found' });
    res.json(result.rows[0]);
  } catch (error) { handle(error, res); }
});

router.post('/actions', requireRoles('soc_analyst', 'administrator'), async (req, res) => {
  try {
    const body = req.body || {};
    const result = await actions.submit({
      actionType: body.action_type, targetId: body.target_id, parameters: body.parameters,
      reason: body.reason, idempotencyKey: body.idempotency_key || null,
      actor: req.user?.username || 'unknown', requestId: req.id || null,
    });
    res.status(result.action_request.status === 'executed' ? 200 : 202).json(result);
  } catch (error) { handle(error, res); }
});

router.post('/actions/:id/decision', requireRoles('soc_analyst', 'administrator'), async (req, res) => {
  try {
    const result = await actions.decide({
      id: req.params.id, decision: req.body?.decision, reason: req.body?.reason,
      actor: req.user?.username || 'unknown', requestId: req.id || null,
    });
    res.json(result);
  } catch (error) { handle(error, res); }
});

module.exports = router;
