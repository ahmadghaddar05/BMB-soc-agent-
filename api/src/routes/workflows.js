'use strict';

const { Router } = require('express');
const { requireRoles } = require('../middleware/auth');
const db = require('../db');

const router = Router();
const INVESTIGATION_STATUSES = new Set(['open', 'closed']);
const CASE_STATUSES = new Set(['open', 'closed', 'false_positive']);

function positiveInteger(value, name) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? null : `${name} must be a positive integer`;
}

function pageOptions(query, maxLimit = 100) {
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 50);
  if (!Number.isInteger(page) || page < 1) return { error: 'page must be a positive integer' };
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    return { error: `limit must be an integer between 1 and ${maxLimit}` };
  }
  return { page, limit, offset: (page - 1) * limit };
}

function text(value, name, { required = false, max = 500 } = {}) {
  if (value == null || value === '') return required ? `${name} is required` : null;
  if (typeof value !== 'string') return `${name} must be a string`;
  const length = value.trim().length;
  if (required && length === 0) return `${name} is required`;
  return length <= max ? null : `${name} must be at most ${max} characters`;
}

function actor(req) {
  return req.user?.username || 'unknown';
}

function auditValues(req, eventType, targetType, targetId, metadata = {}) {
  return [actor(req), eventType, targetType, String(targetId), req.id || null, metadata];
}

router.get('/investigations', async (req, res) => {
  try {
    const paging = pageOptions(req.query);
    if (paging.error) return res.status(400).json({ error: paging.error });
    const { status } = req.query;
    if (status && !INVESTIGATION_STATUSES.has(status)) {
      return res.status(400).json({ error: 'status has an unsupported value' });
    }
    const params = [];
    const where = status ? `WHERE i.status=$${params.push(status)}` : '';
    const [items, count] = await Promise.all([
      db.query(
        `SELECT i.*,
                COALESCE((SELECT array_agg(ia.alert_id ORDER BY ia.added_at)
                          FROM investigation_alerts ia WHERE ia.investigation_id=i.id), '{}') AS alert_ids,
                (SELECT COUNT(*)::int FROM investigation_notes n WHERE n.investigation_id=i.id) AS note_count
         FROM investigations i ${where}
         ORDER BY i.updated_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, paging.limit, paging.offset]
      ),
      db.query(`SELECT COUNT(*)::int AS n FROM investigations i ${where}`, params),
    ]);
    res.json({ investigations: items.rows, total: count.rows[0]?.n || 0, page: paging.page, limit: paging.limit });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/investigations', requireRoles('soc_analyst', 'administrator'), async (req, res) => {
  try {
    const { title, search_query = '', alert_ids } = req.body || {};
    const error = text(title, 'title', { required: true, max: 200 }) ||
      text(search_query, 'search_query', { max: 500 });
    if (error) return res.status(400).json({ error });
    if (!Array.isArray(alert_ids) || alert_ids.length < 1 || alert_ids.length > 100 ||
        alert_ids.some(id => typeof id !== 'string' || !id || id.length > 500)) {
      return res.status(400).json({ error: 'alert_ids must contain between 1 and 100 valid alert IDs' });
    }
    const uniqueIds = [...new Set(alert_ids)];
    const who = actor(req);
    const result = await db.query(
      `WITH supplied AS (
         SELECT DISTINCT unnest($3::text[]) AS alert_id
       ), valid AS (
         SELECT supplied.alert_id FROM supplied JOIN alerts ON alerts.id=supplied.alert_id
       ), created AS (
         INSERT INTO investigations(title,search_query,owner,created_by)
         SELECT $1,$2,$4,$4
         WHERE (SELECT COUNT(*) FROM supplied)=(SELECT COUNT(*) FROM valid)
         RETURNING *
       ), linked AS (
         INSERT INTO investigation_alerts(investigation_id,alert_id,added_by)
         SELECT created.id,valid.alert_id,$4 FROM created CROSS JOIN valid
         RETURNING alert_id
       ), audited AS (
         INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
         SELECT $4,'investigation.created','investigation',created.id::text,'success',$5,
                jsonb_build_object('evidence_count',(SELECT COUNT(*) FROM linked))
         FROM created
       )
       SELECT created.*, COALESCE((SELECT array_agg(alert_id) FROM linked), '{}') AS alert_ids,
              0::int AS note_count
       FROM created`,
      [title.trim(), search_query.trim(), uniqueIds, who, req.id || null]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'One or more alert IDs do not exist' });
    res.status(201).json({ ...result.rows[0], notes: [] });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/investigations/:id', async (req, res) => {
  try {
    const [item, notes] = await Promise.all([
      db.query(
        `SELECT i.*,
                COALESCE(array_agg(ia.alert_id ORDER BY ia.added_at)
                  FILTER (WHERE ia.alert_id IS NOT NULL), '{}') AS alert_ids
         FROM investigations i
         LEFT JOIN investigation_alerts ia ON ia.investigation_id=i.id
         WHERE i.id=$1 GROUP BY i.id`, [req.params.id]
      ),
      db.query(
        `SELECT id,body,author,created_at FROM investigation_notes
         WHERE investigation_id=$1 ORDER BY created_at DESC,id DESC`, [req.params.id]
      ),
    ]);
    if (!item.rows.length) return res.status(404).json({ error: 'Investigation not found' });
    res.json({ ...item.rows[0], notes: notes.rows });
  } catch (error) {
    const status = error.code === '22P02' ? 400 : 500;
    res.status(status).json({ error: status === 400 ? 'investigation id is invalid' : error.message });
  }
});

router.patch('/investigations/:id', requireRoles('soc_analyst', 'administrator'), async (req, res) => {
  try {
    const body = req.body || {};
    const allowed = ['title', 'status', 'owner'];
    const supplied = allowed.filter(key => Object.prototype.hasOwnProperty.call(body, key));
    if (!supplied.length) return res.status(400).json({ error: 'title, status, or owner is required' });
    const error = text(body.title, 'title', { required: body.title != null, max: 200 }) ||
      text(body.owner, 'owner', { max: 120 });
    if (error) return res.status(400).json({ error });
    if (body.status != null && !INVESTIGATION_STATUSES.has(body.status)) {
      return res.status(400).json({ error: 'status has an unsupported value' });
    }
    const values = [];
    const assignments = supplied.map(key => {
      let value = body[key];
      if (typeof value === 'string') value = value.trim();
      if (key === 'owner' && value === '') value = null;
      values.push(value);
      return `${key}=$${values.length}`;
    });
    values.push(req.params.id);
    const targetPlaceholder = values.length;
    values.push(...auditValues(req, 'investigation.updated', 'investigation', req.params.id, { fields: supplied }));
    const result = await db.query(
      `WITH changed AS (
         UPDATE investigations SET ${assignments.join(',')}
         WHERE id=$${targetPlaceholder} RETURNING *
       ), audited AS (
         INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
         SELECT $${targetPlaceholder + 1},$${targetPlaceholder + 2},$${targetPlaceholder + 3},
                $${targetPlaceholder + 4},'success',$${targetPlaceholder + 5},$${targetPlaceholder + 6}
         FROM changed
       ) SELECT * FROM changed`, values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Investigation not found' });
    res.json(result.rows[0]);
  } catch (error) {
    const status = error.code === '22P02' ? 400 : 500;
    res.status(status).json({ error: status === 400 ? 'investigation id is invalid' : error.message });
  }
});

router.delete('/investigations/:id', requireRoles('soc_analyst', 'administrator'), async (req, res) => {
  try {
    const values = auditValues(req, 'investigation.deleted', 'investigation', req.params.id);
    const result = await db.query(
      `WITH removed AS (
         DELETE FROM investigations WHERE id=$4 RETURNING id,title
       ), audited AS (
         INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
         SELECT $1,$2,$3,removed.id::text,'success',$5,
                $6::jsonb || jsonb_build_object('title',removed.title)
         FROM removed
       ) SELECT * FROM removed`, values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Investigation not found' });
    res.json({ ok: true, id: result.rows[0].id });
  } catch (error) {
    const status = error.code === '22P02' ? 400 : 500;
    res.status(status).json({ error: status === 400 ? 'investigation id is invalid' : error.message });
  }
});

router.post('/investigations/:id/notes', requireRoles('soc_analyst', 'administrator'), async (req, res) => {
  try {
    const error = text(req.body?.body, 'body', { required: true, max: 4000 });
    if (error) return res.status(400).json({ error });
    const values = [req.params.id, req.body.body.trim(), actor(req), req.id || null];
    const result = await db.query(
      `WITH added AS (
         INSERT INTO investigation_notes(investigation_id,body,author)
         SELECT id,$2,$3 FROM investigations WHERE id=$1 RETURNING *
       ), touched AS (
         UPDATE investigations SET updated_at=NOW() WHERE id=$1 AND EXISTS (SELECT 1 FROM added)
       ), audited AS (
         INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
         SELECT $3,'investigation.note_added','investigation',$1,'success',$4,
                jsonb_build_object('note_id',added.id) FROM added
       ) SELECT * FROM added`, values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Investigation not found' });
    res.status(201).json(result.rows[0]);
  } catch (error) {
    const status = error.code === '22P02' ? 400 : 500;
    res.status(status).json({ error: status === 400 ? 'investigation id is invalid' : error.message });
  }
});

router.get('/cases', async (req, res) => {
  try {
    const paging = pageOptions(req.query);
    if (paging.error) return res.status(400).json({ error: paging.error });
    const { status } = req.query;
    if (status && !CASE_STATUSES.has(status)) return res.status(400).json({ error: 'status has an unsupported value' });
    const params = [];
    const where = status ? `WHERE i.status=$${params.push(status)}` : '';
    const [items, count] = await Promise.all([
      db.query(
        `SELECT i.*, COUNT(n.id)::int AS note_count
         FROM incidents i LEFT JOIN case_notes n ON n.incident_id=i.id
         ${where} GROUP BY i.id
         ORDER BY CASE i.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                  i.last_seen DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, paging.limit, paging.offset]
      ),
      db.query(`SELECT COUNT(*)::int AS n FROM incidents i ${where}`, params),
    ]);
    res.json({ cases: items.rows, total: count.rows[0]?.n || 0, page: paging.page, limit: paging.limit });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/cases/:id', async (req, res) => {
  try {
    const idError = positiveInteger(req.params.id, 'case id');
    if (idError) return res.status(400).json({ error: idError });
    const [item, notes] = await Promise.all([
      db.query('SELECT * FROM incidents WHERE id=$1', [req.params.id]),
      db.query('SELECT id,body,author,created_at FROM case_notes WHERE incident_id=$1 ORDER BY created_at DESC,id DESC', [req.params.id]),
    ]);
    if (!item.rows.length) return res.status(404).json({ error: 'Case not found' });
    res.json({ ...item.rows[0], notes: notes.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.patch('/cases/:id', requireRoles('soc_analyst', 'administrator'), async (req, res) => {
  try {
    const idError = positiveInteger(req.params.id, 'case id');
    if (idError) return res.status(400).json({ error: idError });
    const body = req.body || {};
    const supplied = ['owner', 'status'].filter(key => Object.prototype.hasOwnProperty.call(body, key));
    if (!supplied.length) return res.status(400).json({ error: 'owner or status is required' });
    const ownerError = text(body.owner, 'owner', { max: 120 });
    if (ownerError) return res.status(400).json({ error: ownerError });
    if (body.status != null && !CASE_STATUSES.has(body.status)) {
      return res.status(400).json({ error: 'status has an unsupported value' });
    }
    const values = [];
    const assignments = supplied.map(key => {
      let value = typeof body[key] === 'string' ? body[key].trim() : body[key];
      if (key === 'owner' && value === '') value = null;
      values.push(value);
      return `${key}=$${values.length}`;
    });
    values.push(req.params.id);
    const idIndex = values.length;
    values.push(...auditValues(req, 'case.updated', 'case', req.params.id, { fields: supplied }));
    const result = await db.query(
      `WITH changed AS (
         UPDATE incidents SET ${assignments.join(',')},updated_at=NOW()
         WHERE id=$${idIndex} RETURNING *
       ), audited AS (
         INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
         SELECT $${idIndex + 1},$${idIndex + 2},$${idIndex + 3},$${idIndex + 4},
                'success',$${idIndex + 5},$${idIndex + 6} FROM changed
       ) SELECT * FROM changed`, values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Case not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/cases/:id/notes', requireRoles('soc_analyst', 'administrator'), async (req, res) => {
  try {
    const idError = positiveInteger(req.params.id, 'case id');
    if (idError) return res.status(400).json({ error: idError });
    const error = text(req.body?.body, 'body', { required: true, max: 4000 });
    if (error) return res.status(400).json({ error });
    const result = await db.query(
      `WITH added AS (
         INSERT INTO case_notes(incident_id,body,author)
         SELECT id,$2,$3 FROM incidents WHERE id=$1 RETURNING *
       ), touched AS (
         UPDATE incidents SET updated_at=NOW() WHERE id=$1 AND EXISTS (SELECT 1 FROM added)
       ), audited AS (
         INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,request_id,metadata)
         SELECT $3,'case.note_added','case',$1::text,'success',$4,
                jsonb_build_object('note_id',added.id) FROM added
       ) SELECT * FROM added`,
      [req.params.id, req.body.body.trim(), actor(req), req.id || null]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Case not found' });
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
