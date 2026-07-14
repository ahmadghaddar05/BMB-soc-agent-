'use strict';
const db = require('../db');

// Read-only database tools for the SOC assistant chatbot. The model supplies
// only structured arguments; every query here is parameterized. There is no
// path for model-authored SQL.

const CHAT_TOOLS = [
  { type:'function', function:{
      name:'search_alerts',
      description:'Search triaged/enriched alerts with optional filters. Returns compact rows (id, time, severity, verdict, entities).',
      parameters:{ type:'object', properties:{
        severity:{type:'string', enum:['critical','high','medium','low','informational']},
        verdict:{type:'string', enum:['true_positive','false_positive','needs_investigation','benign_anomaly']},
        username:{type:'string'}, src_ip:{type:'string'}, hostname:{type:'string'},
        hours:{type:'integer', description:'restrict to alerts within the last N hours'},
        limit:{type:'integer', description:'max rows (default 20, cap 50)'} } } } },
  { type:'function', function:{
      name:'get_alert',
      description:'Fetch one alert by id with its full enrichment and triage verdict (incl. investigation trace if present).',
      parameters:{ type:'object', properties:{ id:{type:'string'} }, required:['id'] } } },
  { type:'function', function:{
      name:'top_critical_alerts',
      description:'The most important open alerts to investigate right now, ranked by severity then rule level. Excludes auto-closed and false positives.',
      parameters:{ type:'object', properties:{ limit:{type:'integer'} } } } },
  { type:'function', function:{
      name:'list_incidents',
      description:'List correlated incidents, optionally by status/severity, newest first.',
      parameters:{ type:'object', properties:{
        status:{type:'string', enum:['open','closed','false_positive']},
        severity:{type:'string'}, limit:{type:'integer'} } } } },
  { type:'function', function:{
      name:'get_incident',
      description:'Fetch one incident by id with its narrative, attack stages, and member alerts.',
      parameters:{ type:'object', properties:{ id:{type:'integer'} }, required:['id'] } } },
  { type:'function', function:{
      name:'pivot_indicator',
      description:'Sweep all alerts and incidents touching an indicator (IP, username, or hostname).',
      parameters:{ type:'object', properties:{ indicator:{type:'string'} }, required:['indicator'] } } },
  { type:'function', function:{
      name:'get_stats',
      description:'Pipeline + alert counts: totals by triage state, severity split, open incidents.',
      parameters:{ type:'object', properties:{} } } },
];

async function search_alerts(a = {}) {
  const conds = [`triage_status='triaged'`]; const params = []; let i = 1;
  if (a.severity) { conds.push(`verdict->>'severity'=$${i++}`); params.push(a.severity); }
  if (a.verdict)  { conds.push(`verdict->>'verdict'=$${i++}`);  params.push(a.verdict); }
  if (a.username) { conds.push(`username ILIKE $${i++}`);       params.push(`%${a.username}%`); }
  if (a.src_ip)   { conds.push(`src_ip=$${i++}`);               params.push(a.src_ip); }
  if (a.hostname) { conds.push(`hostname ILIKE $${i++}`);       params.push(`%${a.hostname}%`); }
  if (a.hours)    { conds.push(`timestamp >= NOW() - ($${i++} || ' hours')::interval`); params.push(String(parseInt(a.hours))); }
  const limit = Math.min(parseInt(a.limit) || 20, 50);
  const { rows } = await db.query(
    `SELECT id, timestamp, rule_level, rule_desc, src_ip, username, hostname,
            verdict->>'severity' AS severity, verdict->>'verdict' AS verdict,
            verdict->>'attack_stage' AS attack_stage
     FROM alerts WHERE ${conds.join(' AND ')}
     ORDER BY timestamp DESC LIMIT ${limit}`, params);
  return { count: rows.length, alerts: rows };
}

async function get_alert(a = {}) {
  const { rows } = await db.query('SELECT * FROM alerts WHERE id=$1', [a.id]);
  return rows[0] || { error: 'alert not found' };
}

async function top_critical_alerts(a = {}) {
  const limit = Math.min(parseInt(a.limit) || 10, 30);
  const { rows } = await db.query(
    `SELECT id, timestamp, rule_level, rule_desc, src_ip, username, hostname,
            verdict->>'severity' AS severity, verdict->>'verdict' AS verdict,
            verdict->>'narrative' AS narrative
     FROM alerts
     WHERE triage_status='triaged' AND auto_closed=false
       AND verdict->>'verdict' IN ('true_positive','needs_investigation')
     ORDER BY CASE verdict->>'severity'
                WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
              rule_level DESC, timestamp DESC
     LIMIT ${limit}`);
  return { count: rows.length, alerts: rows };
}

async function list_incidents(a = {}) {
  const conds = ['1=1']; const params = []; let i = 1;
  if (a.status)   { conds.push(`status=$${i++}`);   params.push(a.status); }
  if (a.severity) { conds.push(`severity=$${i++}`); params.push(a.severity); }
  const limit = Math.min(parseInt(a.limit) || 15, 50);
  const { rows } = await db.query(
    `SELECT id, title, severity, confidence, attack_stages, status,
            array_length(alert_ids,1) AS alert_count, first_seen, last_seen
     FROM incidents WHERE ${conds.join(' AND ')}
     ORDER BY last_seen DESC LIMIT ${limit}`, params);
  return { count: rows.length, incidents: rows };
}

async function get_incident(a = {}) {
  const r = await db.query('SELECT * FROM incidents WHERE id=$1', [parseInt(a.id)]);
  if (!r.rows.length) return { error: 'incident not found' };
  const inc = r.rows[0];
  const al = await db.query(
    `SELECT id, rule_desc, rule_level, verdict->>'severity' AS severity, username, hostname, src_ip
     FROM alerts WHERE id = ANY($1)`, [inc.alert_ids]);
  return { ...inc, alerts: al.rows };
}

async function pivot_indicator(a = {}) {
  const ind = a.indicator;
  const alerts = await db.query(
    `SELECT id, timestamp, rule_level, rule_desc, src_ip, username, hostname,
            verdict->>'severity' AS severity
     FROM alerts WHERE src_ip=$1 OR username=$1 OR hostname LIKE $2
     ORDER BY timestamp DESC LIMIT 50`, [ind, `%${ind}%`]);
  const incidents = await db.query(
    `SELECT id, title, severity, status FROM incidents
     WHERE $1 = ANY(alert_ids) OR common_entities::text ILIKE $2`, [ind, `%${ind}%`]);
  return { indicator: ind, alert_count: alerts.rows.length, incident_count: incidents.rows.length,
           alerts: alerts.rows, incidents: incidents.rows };
}

async function get_stats() {
  const stats = await db.getAlertStats();
  const sev = await db.query(
    `SELECT verdict->>'severity' AS severity, COUNT(*) AS n
     FROM alerts WHERE triage_status='triaged' GROUP BY severity`);
  const inc = await db.query(`SELECT status, COUNT(*) AS n FROM incidents GROUP BY status`);
  return { alerts: stats, severity_split: sev.rows, incidents: inc.rows };
}

const HANDLERS = { search_alerts, get_alert, top_critical_alerts, list_incidents, get_incident, pivot_indicator, get_stats };

async function dispatch(name, args = {}) {
  const fn = HANDLERS[name];
  if (!fn) return { error: `unknown tool: ${name}` };
  try { return await fn(args); }
  catch (e) { return { error: e.message || String(e) }; }
}

module.exports = { CHAT_TOOLS, dispatch };
