'use strict';
const crypto = require('crypto');
const db = require('../db');
const { correlateAlerts } = require('../services/llm');

const SEV_ORDER = { informational: 0, low: 1, medium: 2, high: 3, critical: 4 };

function maxSeverity(a, b) {
  return (SEV_ORDER[a] || 0) >= (SEV_ORDER[b] || 0) ? (a || 'medium') : (b || 'medium');
}

// Deterministic key from the member alert set — lets us detect the same
// incident across runs even though the LLM is non-deterministic.
function incidentKey(ids) {
  return crypto.createHash('sha256')
    .update([...ids].sort().join('|'))
    .digest('hex')
    .slice(0, 32);
}

// Upsert one incident. If an OPEN incident already shares any alert id, merge
// into it (union the members) instead of creating a near-duplicate. We never
// silently reopen incidents an analyst has closed/marked false-positive — new
// related activity against a closed incident becomes a fresh incident.
async function upsertIncident(inc, firstSeen, lastSeen, runId, incidentType = 'correlation') {
  const existing = await db.query(
    `SELECT * FROM incidents
     WHERE status = 'open' AND alert_ids && $1::text[]
     ORDER BY id ASC LIMIT 1`,
    [inc.alert_ids]
  );

  if (existing.rows.length) {
    const cur        = existing.rows[0];
    const mergedIds  = [...new Set([...(cur.alert_ids || []), ...inc.alert_ids])];
    const mergedStgs = [...new Set([...(cur.attack_stages || []), ...inc.attack_stages])];
    const severity   = maxSeverity(cur.severity, inc.severity);
    // If a correlation incident now absorbs a previously-promoted single alert,
    // it graduates to a 'correlation' incident.
    const newType    = (cur.incident_type === 'correlation' || incidentType === 'correlation') ? 'correlation' : cur.incident_type;

    await db.query(
      `UPDATE incidents
       SET alert_ids=$1, attack_stages=$2, severity=$3, confidence=$4,
           title=$5, narrative=$6, recommended_actions=$7, common_entities=$8,
           last_seen=GREATEST(COALESCE(last_seen, $9), $9),
           first_seen=LEAST(COALESCE(first_seen, $10), $10),
           incident_key=$11, incident_type=$12, updated_at=NOW()
       WHERE id=$13`,
      [mergedIds, mergedStgs, severity, inc.confidence,
       inc.title, inc.narrative, inc.recommended_actions, inc.common_entities,
       lastSeen, firstSeen, incidentKey(mergedIds), newType, cur.id]
    );
    return 'updated';
  }

  // No open overlap → insert new. ON CONFLICT handles the case where this exact
  // member-set was seen before. (xmax = 0) is true only for a fresh INSERT.
  const r = await db.query(
    `INSERT INTO incidents
       (incident_key, title, severity, confidence, attack_stages,
        common_entities, alert_ids, narrative, recommended_actions,
        first_seen, last_seen, status, fetch_run_id, incident_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open',$12,$13)
     ON CONFLICT (incident_key) DO UPDATE SET
        title=EXCLUDED.title, severity=EXCLUDED.severity, confidence=EXCLUDED.confidence,
        attack_stages=EXCLUDED.attack_stages, common_entities=EXCLUDED.common_entities,
        narrative=EXCLUDED.narrative, recommended_actions=EXCLUDED.recommended_actions,
        last_seen=GREATEST(incidents.last_seen, EXCLUDED.last_seen), updated_at=NOW()
     RETURNING (xmax = 0) AS inserted`,
    [incidentKey(inc.alert_ids), inc.title, inc.severity, inc.confidence,
     inc.attack_stages, inc.common_entities, inc.alert_ids, inc.narrative,
     inc.recommended_actions, firstSeen, lastSeen, runId || null, incidentType]
  );
  return r.rows[0].inserted ? 'created' : 'updated';
}

// Pull all triaged alerts from the last N hours and ask the LLM to correlate.
function boundedInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : fallback));
}

function meaningful(value) {
  const v = String(value || '').trim().toLowerCase();
  return v && !['unknown','n/a','na','none','null','-'].includes(v) ? v : null;
}

function relationScore(a, b) {
  let score = 0;
  const direct = ['username','hostname','process','target_db'];
  for (const key of direct) {
    const av = meaningful(a[key]);
    const bv = meaningful(b[key]);
    if (av && av === bv) score += key === 'process' ? 1 : 2;
  }
  const aIps = new Set([meaningful(a.src_ip), meaningful(a.dst_ip)].filter(Boolean));
  const bIps = [meaningful(b.src_ip), meaningful(b.dst_ip)].filter(Boolean);
  if (bIps.some(ip => aIps.has(ip))) score += 2;
  return score;
}

function withinHours(a, b, hours) {
  const at = new Date(a.timestamp).getTime();
  const bt = new Date(b.timestamp).getTime();
  return Number.isFinite(at) && Number.isFinite(bt) &&
    Math.abs(at - bt) <= hours * 60 * 60 * 1000;
}

// Incremental correlation: process each newly triaged alert once, then add only
// recent alerts that share a meaningful entity. This avoids resending the same
// 24-hour batch to the LLM on every scheduler cycle.
async function correlatePending(settings = {}, runId = null) {
  const hours = boundedInt(settings.correlation_lookback_hours, 24, 1, 168);
  const cap = boundedInt(settings.correlation_max_alerts, 40, 2, 80);
  const newCap = boundedInt(settings.correlation_new_alerts_per_cycle, 20, 1, 50);
  const initialCap = boundedInt(settings.correlation_initial_alerts, 20, 2, 40);
  const contextPoolCap = boundedInt(settings.correlation_context_pool, 100, 10, 300);
  const entityWindowHours = boundedInt(settings.correlation_entity_window_hours, 6, 1, 48);
  const tokenBudget = boundedInt(settings.correlation_token_budget, 20000, 6000, 100000);

  let cursor = null;
  try {
    const parsed = JSON.parse(settings.correlation_cursor_json || 'null');
    if (Array.isArray(parsed) && parsed.length === 2 &&
        Number.isFinite(new Date(parsed[0]).getTime())) {
      cursor = [new Date(parsed[0]).toISOString(), String(parsed[1] || '')];
    }
  } catch {
    cursor = null;
  }
  // Backward-compatible migration from the earlier timestamp-only cursor.
  if (!cursor && settings.correlation_cursor_at) {
    const legacy = new Date(settings.correlation_cursor_at);
    if (Number.isFinite(legacy.getTime())) cursor = [legacy.toISOString(), ''];
  }
  const hasCursor = !!cursor;

  const columns = `
    id, timestamp, triaged_at, rule_id, rule_level, rule_desc,
    src_ip, dst_ip, username, hostname, target_db, process, verdict
  `;

  const fresh = hasCursor
    ? await db.query(
        `SELECT ${columns}
         FROM alerts
         WHERE triage_status='triaged' AND auto_closed=false
           AND (COALESCE(triaged_at, timestamp), id) > ($1::timestamptz, $2::text)
         ORDER BY COALESCE(triaged_at, timestamp) ASC, id ASC
         LIMIT $3`,
        [cursor[0], cursor[1], newCap]
      )
    : await db.query(
        `SELECT ${columns}
         FROM alerts
         WHERE triage_status='triaged' AND auto_closed=false
           AND timestamp >= NOW() - ($1 || ' hours')::interval
         ORDER BY COALESCE(triaged_at, timestamp) ASC, id ASC
         LIMIT $2`,
        [String(hours), initialCap]
      );

  const newRows = fresh.rows;
  if (!newRows.length) {
    return {
      incidents_created: 0, incidents_updated: 0, considered: 0,
      new_alerts: 0, llm_calls: 0, llm_tokens: 0, skipped_reason: 'no_new_triaged_alerts',
    };
  }

  const lastFresh = newRows[newRows.length - 1];
  const nextCursor = [
    new Date(lastFresh.triaged_at || lastFresh.timestamp).toISOString(),
    String(lastFresh.id),
  ];
  const newIds = newRows.map(row => row.id);

  const pool = await db.query(
    `SELECT ${columns}
     FROM alerts
     WHERE triage_status='triaged' AND auto_closed=false
       AND timestamp >= NOW() - ($1 || ' hours')::interval
       AND NOT (id = ANY($2::text[]))
     ORDER BY rule_level DESC, timestamp DESC
     LIMIT $3`,
    [String(hours), newIds, contextPoolCap]
  );

  const relatedContext = pool.rows.filter(candidate =>
    newRows.some(freshAlert =>
      relationScore(freshAlert, candidate) > 0 &&
      withinHours(freshAlert, candidate, entityWindowHours)
    )
  );

  // Reserve prompt/output headroom. In practice compact alerts are usually
  // below 220 tokens each; this keeps a single correlation request bounded.
  const budgetCandidateCap = Math.max(2, Math.floor((tokenBudget - 3000) / 220));
  const effectiveCap = Math.min(cap, budgetCandidateCap);
  const candidates = [...newRows, ...relatedContext]
    .filter((row, index, all) => all.findIndex(x => x.id === row.id) === index)
    .slice(0, effectiveCap);

  let hasPlausiblePair = false;
  for (let i = 0; i < candidates.length && !hasPlausiblePair; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (relationScore(candidates[i], candidates[j]) > 0 &&
          withinHours(candidates[i], candidates[j], entityWindowHours)) {
        hasPlausiblePair = true;
        break;
      }
    }
  }

  if (!hasPlausiblePair) {
    await db.setSetting('correlation_cursor_json', JSON.stringify(nextCursor));
    return {
      incidents_created: 0, incidents_updated: 0, considered: candidates.length,
      new_alerts: newRows.length, llm_calls: 0, llm_tokens: 0,
      skipped_reason: 'no_plausible_entity_links',
    };
  }

  const tsById = Object.fromEntries(candidates.map(r => [r.id, r.timestamp]));
  const { incidents, usage } = await correlateAlerts(candidates, settings);

  let created = 0, updated = 0;
  const failures = [];
  for (const inc of incidents) {
    const times = inc.alert_ids.map(id => tsById[id]).filter(Boolean).map(t => new Date(t));
    const firstSeen = times.length ? new Date(Math.min(...times)).toISOString() : new Date().toISOString();
    const lastSeen = times.length ? new Date(Math.max(...times)).toISOString() : firstSeen;
    try {
      const result = await upsertIncident(inc, firstSeen, lastSeen, runId);
      if (result === 'created') created++; else updated++;
    } catch (err) {
      failures.push(`${inc.title || 'incident'}: ${err.message || String(err)}`);
    }
  }

  // Cursor advances only after the model response and every database write
  // succeed. Retrying is safe because incident upserts are idempotent.
  if (failures.length) {
    throw new Error(`Correlation persistence failed; cursor retained: ${failures.join('; ').slice(0, 400)}`);
  }
  await db.setSetting('correlation_cursor_json', JSON.stringify(nextCursor));

  const llmTokens = parseInt(usage?.total_tokens || 0, 10) || 0;
  console.log(
    `[correlate] new=${newRows.length} context=${relatedContext.length} ` +
    `considered=${candidates.length} created=${created} updated=${updated} tokens=${llmTokens}`
  );
  return {
    incidents_created: created, incidents_updated: updated,
    considered: candidates.length, new_alerts: newRows.length,
    llm_calls: 1, llm_tokens: llmTokens, token_budget: tokenBudget,
  };
}

// Promote significant standalone alerts to single-alert incidents so the
// Incidents page works as a triage queue, not just a correlation output. Only
// alerts NOT already part of an open incident are promoted, gated by verdict
// and severity thresholds. These are tagged incident_type='triage'.
async function promoteSingletons(settings = {}, runId = null) {
  const verdicts = (settings.incident_promote_verdicts || 'true_positive,needs_investigation')
    .split(',').map(s => s.trim()).filter(Boolean);
  const minSev = settings.incident_promote_min_severity || 'high';
  const hours  = parseInt(settings.correlation_lookback_hours || 24);
  const order  = ['informational','low','medium','high','critical'];
  const allowedSev = order.slice(order.indexOf(minSev) >= 0 ? order.indexOf(minSev) : 3);

  const { rows } = await db.query(
    `SELECT id, timestamp, rule_desc, verdict, mitre_tactics
     FROM alerts
     WHERE triage_status='triaged' AND auto_closed=false
       AND verdict->>'verdict' = ANY($1)
       AND verdict->>'severity' = ANY($2)
       AND timestamp >= NOW() - ($3 || ' hours')::interval
       AND NOT EXISTS (
         SELECT 1 FROM incidents i WHERE i.status='open' AND alerts.id = ANY(i.alert_ids)
       )
     ORDER BY timestamp DESC LIMIT 200`,
    [verdicts, allowedSev, String(hours)]
  );

  let created = 0;
  for (const a of rows) {
    const v = a.verdict || {};
    const stages = [...new Set([...(a.mitre_tactics || []), v.attack_stage].filter(Boolean))];
    const inc = {
      alert_ids: [a.id],
      title: (a.rule_desc || 'Alert').slice(0, 200),
      severity: v.severity || 'medium',
      confidence: typeof v.confidence === 'number' ? v.confidence : 0.5,
      attack_stages: stages,
      common_entities: {},
      narrative: v.narrative || '',
      recommended_actions: Array.isArray(v.recommended_actions) ? v.recommended_actions : [],
    };
    try {
      const ts = new Date(a.timestamp).toISOString();
      const res = await upsertIncident(inc, ts, ts, runId, 'triage');
      if (res === 'created') created++;
    } catch (err) {
      console.error('[promote] failed for alert', a.id, ':', err.message || String(err));
    }
  }
  if (created) console.log(`[promote] created ${created} single-alert incident(s)`);
  return { promoted: created };
}

module.exports = { correlatePending, promoteSingletons, incidentKey };
