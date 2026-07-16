'use strict';

const crypto = require('crypto');
const db = require('../db');
const { correlateHermes } = require('../services/hermes/correlation');
const { HermesError } = require('../services/hermes/errors');

const SEV_ORDER = { informational: 0, low: 1, medium: 2, high: 3, critical: 4 };

function maxSeverity(a, b) {
  return (SEV_ORDER[a] || 0) >= (SEV_ORDER[b] || 0) ? (a || 'medium') : (b || 'medium');
}

function incidentKey(ids) {
  return crypto.createHash('sha256')
    .update(`hermes-correlation-v1|${[...ids].map(String).sort().join('|')}`)
    .digest('hex')
    .slice(0, 32);
}

async function upsertIncident(inc, firstSeen, lastSeen, fetchRunId, correlationRunId, identityAlertIds = inc.alert_ids) {
  const existing = await db.query(
    `SELECT * FROM incidents
     WHERE status='open' AND alert_ids && $1::text[]
     ORDER BY id ASC`,
    [inc.alert_ids]
  );

  if (existing.rows.length > 1) {
    throw new HermesError(
      'CORRELATION_AMBIGUOUS_OVERLAP',
      'The proposed group overlaps multiple open incidents and requires analyst reconciliation',
      { status: 409, details: existing.rows.map(row => row.id).slice(0, 8) }
    );
  }

  if (existing.rows.length === 1) {
    const current = existing.rows[0];
    const mergedIds = [...new Set([...(current.alert_ids || []), ...inc.alert_ids])];
    const mergedStages = [...new Set([...(current.attack_stages || []), ...inc.attack_stages])];
    const membershipChanged = mergedIds.length !== (current.alert_ids || []).length;
    await db.query(
      `UPDATE incidents
       SET alert_ids=$1,attack_stages=$2,severity=$3,confidence=$4,
           title=$5,narrative=$6,recommended_actions=$7,common_entities=$8,
           last_seen=GREATEST(COALESCE(last_seen,$9),$9),
           first_seen=LEAST(COALESCE(first_seen,$10),$10),
           incident_type='correlation',correlation_run_id=$11,updated_at=NOW()
       WHERE id=$12`,
      [
        mergedIds, mergedStages, maxSeverity(current.severity, inc.severity),
        membershipChanged ? inc.confidence : current.confidence,
        membershipChanged ? inc.title : current.title,
        membershipChanged ? inc.narrative : current.narrative,
        membershipChanged ? inc.recommended_actions : current.recommended_actions,
        membershipChanged ? inc.common_entities : current.common_entities,
        lastSeen, firstSeen, correlationRunId, current.id,
      ]
    );
    return { status: membershipChanged ? 'updated' : 'unchanged', id: current.id };
  }

  const key = incidentKey(identityAlertIds.length ? identityAlertIds : inc.alert_ids);
  const historical = await db.query('SELECT id,status FROM incidents WHERE incident_key=$1', [key]);
  if (historical.rows.length && historical.rows[0].status !== 'open') {
    return { status: 'preserved', id: historical.rows[0].id };
  }

  const result = await db.query(
    `INSERT INTO incidents(
       incident_key,title,severity,confidence,attack_stages,common_entities,
       alert_ids,narrative,recommended_actions,first_seen,last_seen,status,
       fetch_run_id,incident_type,correlation_run_id
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open',$12,'correlation',$13)
     ON CONFLICT (incident_key) DO UPDATE SET
       severity=CASE WHEN incidents.status='open' THEN EXCLUDED.severity ELSE incidents.severity END,
       last_seen=CASE WHEN incidents.status='open' THEN GREATEST(incidents.last_seen,EXCLUDED.last_seen) ELSE incidents.last_seen END,
       correlation_run_id=CASE WHEN incidents.status='open' THEN EXCLUDED.correlation_run_id ELSE incidents.correlation_run_id END,
       updated_at=CASE WHEN incidents.status='open' THEN NOW() ELSE incidents.updated_at END
     RETURNING id,(xmax=0) AS inserted,status`,
    [
      key, inc.title, inc.severity, inc.confidence, inc.attack_stages,
      inc.common_entities, inc.alert_ids, inc.narrative, inc.recommended_actions,
      firstSeen, lastSeen, fetchRunId || null, correlationRunId,
    ]
  );
  return { status: result.rows[0].inserted ? 'created' : 'unchanged', id: result.rows[0].id };
}

function boundedInt(value, fallback, min, max) {
  const number = parseInt(value, 10);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback));
}

function meaningful(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized && !['unknown', 'n/a', 'na', 'none', 'null', '-'].includes(normalized)
    ? normalized : null;
}

function relationScore(a, b) {
  let score = 0;
  for (const key of ['username', 'hostname', 'process', 'target_db']) {
    const left = meaningful(a[key]);
    const right = meaningful(b[key]);
    if (left && left === right) score += key === 'process' ? 1 : 2;
  }
  const leftIps = new Set([meaningful(a.src_ip), meaningful(a.dst_ip)].filter(Boolean));
  if ([meaningful(b.src_ip), meaningful(b.dst_ip)].filter(Boolean).some(ip => leftIps.has(ip))) score += 2;
  return score;
}

function withinHours(a, b, hours) {
  const left = new Date(a.timestamp).getTime();
  const right = new Date(b.timestamp).getTime();
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= hours * 3600000;
}

async function correlatePending(settings = {}, fetchRunId = null, {
  actor = 'system:scheduler', requestId = crypto.randomUUID(), signal,
  correlate = correlateHermes,
} = {}) {
  const hours = boundedInt(settings.correlation_lookback_hours, 24, 1, 168);
  const cap = boundedInt(settings.correlation_max_alerts, 40, 2, 80);
  const newCap = boundedInt(settings.correlation_new_alerts_per_cycle, 20, 1, 50);
  const initialCap = boundedInt(settings.correlation_initial_alerts, 20, 2, 40);
  const contextPoolCap = boundedInt(settings.correlation_context_pool, 100, 10, 300);
  const entityWindowHours = boundedInt(settings.correlation_entity_window_hours, 6, 1, 48);
  const tokenBudget = boundedInt(settings.correlation_token_budget, 20000, 6000, 100000);
  const budgetCandidateCap = Math.max(2, Math.floor((tokenBudget - 3000) / 220));
  const effectiveCap = Math.min(cap, budgetCandidateCap);

  let cursor = null;
  try {
    const parsed = JSON.parse(settings.correlation_cursor_json || 'null');
    if (Array.isArray(parsed) && parsed.length === 2 && Number.isFinite(new Date(parsed[0]).getTime())) {
      cursor = [new Date(parsed[0]).toISOString(), String(parsed[1] || '')];
    }
  } catch { cursor = null; }
  if (!cursor && settings.correlation_cursor_at) {
    const legacy = new Date(settings.correlation_cursor_at);
    if (Number.isFinite(legacy.getTime())) cursor = [legacy.toISOString(), ''];
  }

  const columns = `
    id,timestamp,triaged_at,rule_id,rule_level,rule_desc,source_severity,
    src_ip,dst_ip,username,hostname,target_db,process,mitre_tactics,verdict
  `;
  const fresh = cursor
    ? await db.query(
      `SELECT ${columns} FROM alerts
       WHERE triage_status='triaged' AND auto_closed=false
         AND (COALESCE(triaged_at,timestamp),id)>($1::timestamptz,$2::text)
       ORDER BY COALESCE(triaged_at,timestamp) ASC,id ASC LIMIT $3`,
      [cursor[0], cursor[1], Math.min(newCap, Math.max(1, effectiveCap - 1))]
    )
    : await db.query(
      `SELECT ${columns} FROM alerts
       WHERE triage_status='triaged' AND auto_closed=false
         AND timestamp>=NOW()-($1 || ' hours')::interval
       ORDER BY COALESCE(triaged_at,timestamp) ASC,id ASC LIMIT $2`,
      [String(hours), Math.min(initialCap, effectiveCap)]
    );

  const newRows = fresh.rows;
  if (!newRows.length) {
    return {
      incidents_created: 0, incidents_updated: 0, incidents_unchanged: 0,
      considered: 0, new_alerts: 0, llm_calls: 0, llm_tokens: 0,
      skipped_reason: 'no_new_triaged_alerts',
    };
  }

  const newIds = newRows.map(row => String(row.id));
  const pool = await db.query(
    `SELECT ${columns} FROM alerts
     WHERE triage_status='triaged' AND auto_closed=false
       AND timestamp>=NOW()-($1 || ' hours')::interval
       AND NOT (id=ANY($2::text[]))
     ORDER BY rule_level DESC,timestamp DESC LIMIT $3`,
    [String(hours), newIds, contextPoolCap]
  );
  const relatedContext = pool.rows.filter(candidate => newRows.some(freshAlert =>
    relationScore(freshAlert, candidate) > 0 && withinHours(freshAlert, candidate, entityWindowHours)
  ));
  const candidates = [...newRows, ...relatedContext]
    .filter((row, index, all) => all.findIndex(item => item.id === row.id) === index)
    .slice(0, effectiveCap);
  // The configured candidate/token cap may be lower than the fresh-query cap.
  // Advance only through fresh alerts actually supplied to Hermes so no alert
  // can be skipped by a small runtime limit.
  const candidateIds = new Set(candidates.map(row => String(row.id)));
  const includedFresh = newRows.filter(row => candidateIds.has(String(row.id)));
  const lastFresh = includedFresh.at(-1);
  const nextCursor = [
    new Date(lastFresh.triaged_at || lastFresh.timestamp).toISOString(), String(lastFresh.id),
  ];
  const includedFreshIds = includedFresh.map(row => String(row.id));

  const hasPlausiblePair = candidates.some((left, leftIndex) => candidates.some((right, rightIndex) =>
    rightIndex > leftIndex && relationScore(left, right) > 0 && withinHours(left, right, entityWindowHours)
  ));
  if (!hasPlausiblePair) {
    await db.setSetting('correlation_cursor_json', JSON.stringify(nextCursor));
    return {
      incidents_created: 0, incidents_updated: 0, incidents_unchanged: 0,
      considered: candidates.length, new_alerts: includedFresh.length,
      llm_calls: 0, llm_tokens: 0, skipped_reason: 'no_plausible_entity_links',
    };
  }

  const timestamps = Object.fromEntries(candidates.map(row => [String(row.id), row.timestamp]));
  const freshSet = new Set(includedFreshIds);
  const result = await correlate(candidates, includedFreshIds, settings, {
    actor, requestId, signal,
    persist: async (incidents, correlationRunId) => {
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      const incidentIds = [];
      const targetIds = new Set();
      // Resolve every existing target before writing. This prevents two model
      // groups from silently rewriting the same open incident in one run.
      for (const incident of incidents) {
        const targets = await db.query(
          `SELECT id FROM incidents
           WHERE status='open' AND alert_ids && $1::text[] ORDER BY id ASC`,
          [incident.alert_ids]
        );
        if (targets.rows.length > 1 || (targets.rows[0] && targetIds.has(String(targets.rows[0].id)))) {
          throw new HermesError(
            'CORRELATION_AMBIGUOUS_OVERLAP',
            'Correlation groups overlap ambiguous open incident state and require analyst reconciliation',
            { status: 409, details: targets.rows.map(row => row.id).slice(0, 8) }
          );
        }
        if (targets.rows[0]) targetIds.add(String(targets.rows[0].id));
      }
      for (const incident of incidents) {
        const times = incident.alert_ids.map(id => new Date(timestamps[String(id)]));
        const firstSeen = new Date(Math.min(...times)).toISOString();
        const lastSeen = new Date(Math.max(...times)).toISOString();
        const identityAlertIds = incident.alert_ids.filter(id => freshSet.has(String(id)));
        const persisted = await upsertIncident(
          incident, firstSeen, lastSeen, fetchRunId, correlationRunId, identityAlertIds
        );
        incidentIds.push(persisted.id);
        if (persisted.status === 'created') created += 1;
        else if (persisted.status === 'updated') updated += 1;
        else unchanged += 1;
      }
      return { created, updated, unchanged, incidentIds };
    },
  });

  await db.setSetting('correlation_cursor_json', JSON.stringify(nextCursor));
  console.log(
    `[correlate] new=${newRows.length} context=${relatedContext.length} ` +
    `considered=${candidates.length} created=${result.created} updated=${result.updated} tokens=${result.total_tokens}`
  );
  return {
    incidents_created: result.created, incidents_updated: result.updated,
    incidents_unchanged: result.unchanged, considered: candidates.length,
    new_alerts: includedFresh.length, llm_calls: 1, llm_tokens: result.total_tokens || 0,
    prompt_tokens: result.prompt_tokens || 0,
    completion_tokens: result.completion_tokens || 0,
    correlation_run_id: result.run_id, hermes_run_id: result.hermes_run_id,
    token_budget: tokenBudget,
  };
}

module.exports = {
  correlatePending, incidentKey, maxSeverity, meaningful,
  relationScore, upsertIncident, withinHours,
};
