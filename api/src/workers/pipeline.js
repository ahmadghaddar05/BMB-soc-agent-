'use strict';
const db = require('../db');
const { fetchAlerts: fetchWazuhAlerts } = require('../services/wazuh');
const {
  fetchAlerts: fetchElasticAlerts,
  searchAlertsCursor,
} = require('../services/elastic');
const { triageAlert, investigateAlert, triageHybrid } = require('../services/llm');
const { alertSignature } = require('../services/signature');
const { correlatePending, promoteSingletons } = require('./correlation');

function getEnrichmentUrl() {
  return (process.env.ENRICHMENT_URL || 'http://enrichment:3001').replace(/\/$/, '');
}

function safeError(err) {
  // Guarantee we always get a string error message regardless of what was thrown
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

// ── Enrich one alert ──────────────────────────────────────────────────────
async function enrichAlert(alert) {
  const res = await fetch(`${getEnrichmentUrl()}/enrich`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      src_ip:    alert.src_ip,
      username:  alert.username,
      hostname:  alert.hostname,
      dst_ip:    alert.dst_ip,
      timestamp: alert.timestamp,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Enrichment HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const body = await res.json();
  return body.context;
}

// ── Ingest, dedup by id ───────────────────────────────────────────────────
async function ingestAlerts(alerts, runId) {
  let stored = 0, duplicates = 0;
  for (const a of alerts) {
    try {
      const sourceSystem =
        a.source_system ||
        (String(a.id).startsWith('mock-') ? 'mock' : 'wazuh');

      const r = await db.query(
        `INSERT INTO alerts
           (id, timestamp, rule_id, rule_level, rule_desc, rule_groups,
            decoder, agent_id, agent_name, full_log,
            src_ip, dst_ip, username, hostname, target_db, process,
            mitre_techniques, mitre_tactics, raw,
            source_system, source_index, elastic_alert_uuid,
            risk_score, source_severity, workflow_status, alert_reason,
            event_dataset, event_category, event_action,
            group_key, occurrence_count, first_seen, last_seen,
            enrichment_status, triage_status, fetch_run_id, fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                 $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
                 $31,$32,$33,'pending','pending',$34,NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          a.id, a.timestamp, a.rule_id, a.rule_level, a.rule_desc,
          a.rule_groups || [], a.decoder, a.agent_id, a.agent_name,
          a.full_log,
          a.src_ip, a.dst_ip, a.username, a.hostname, a.target_db,
          a.process,
          a.mitre_techniques || [], a.mitre_tactics || [],
          JSON.stringify(a.raw || {}),
          sourceSystem,
          a.source_index || null,
          a.elastic_alert_uuid || null,
          a.risk_score ?? null,
          a.source_severity || null,
          a.workflow_status || null,
          a.alert_reason || null,
          a.event_dataset || null,
          a.event_category || [],
          a.event_action || null,
          a.group_key || null,
          Number.isInteger(a.occurrence_count)
            ? a.occurrence_count
            : 1,
          a.first_seen || a.timestamp,
          a.last_seen || a.timestamp,
          runId,
        ]
      );
      if (r.rowCount > 0) stored++; else duplicates++;
    } catch (err) {
      console.error(`[ingest] failed to insert ${a.id}:`, safeError(err));
    }
  }
  return { stored, duplicates };
}

// ── Enrich pending alerts ─────────────────────────────────────────────────
async function enrichPending(limit = 100) {
  const { rows } = await db.query(
    `SELECT id, src_ip, username, hostname, dst_ip, timestamp
     FROM alerts WHERE enrichment_status='pending'
     ORDER BY timestamp DESC LIMIT $1`, [limit]
  );
  if (!rows.length) return { enriched: 0, failed: 0 };

  let enriched = 0, failed = 0;
  for (const row of rows) {
    try {
      const ctx = await enrichAlert(row);
      // Store as JSONB -- pass object directly, pg handles serialization
      await db.query(
        `UPDATE alerts
         SET enrichment=$1, enrichment_status='enriched', enriched_at=NOW()
         WHERE id=$2`,
        [ctx, row.id]          // pg will serialize the object to JSONB
      );
      enriched++;
    } catch (err) {
      const msg = safeError(err);
      console.error(`[enrich] failed for ${row.id}:`, msg);
      await db.query(
        `UPDATE alerts
         SET enrichment_status='enrichment_failed', enrichment_error=$1
         WHERE id=$2`,
        [msg.slice(0, 500), row.id]
      );
      failed++;
    }
  }
  return { enriched, failed };
}

// ── Triage enriched alerts ────────────────────────────────────────────────
async function triagePending(settings, limit = 50) {
  const { rows } = await db.query(
    `SELECT * FROM alerts
     WHERE triage_status='pending'
       AND enrichment_status IN ('enriched','enrichment_failed')
     ORDER BY rule_level DESC, timestamp DESC
     LIMIT $1`,
    [limit]
  );
  if (!rows.length) return { triaged: 0, failed: 0, llm_calls: 0, cache_hits: 0 };

  const mode = settings.triage_mode || 'hybrid';
  const agentic = mode === 'agentic';
  const hybrid = mode === 'hybrid';
  const useCache = (settings.caching_enabled || 'true') === 'true';
  const cacheTtlHours = Math.min(720, Math.max(1,
    parseInt(settings.triage_cache_ttl_hours || 168, 10) || 168));
  const tokenBudget = Math.min(500000, Math.max(10000,
    parseInt(settings.triage_token_budget || 60000, 10) || 60000));

  // ── Noise reduction: group near-identical alerts by signature ───────────
  // Alerts with the same rule + same key entities are triaged ONCE; the verdict
  // is then applied to every member of the cluster. This is the main lever for
  // cutting LLM calls on repetitive alert storms.
  const clusters = new Map();
  for (const row of rows) {
    const sig = alertSignature(row);
    if (!clusters.has(sig)) clusters.set(sig, []);
    clusters.get(sig).push(row);
  }

  let triaged = 0, failed = 0, llm_calls = 0, cache_hits = 0;
  let llm_tokens = 0, prompt_tokens = 0, completion_tokens = 0;
  let agentic_escalations = 0, budget_exhausted = false;

  for (const [sig, members] of clusters) {
    const rep = members[0];
    try {
      let verdict, source;

      // 1. Cache: have we already triaged this exact signature?
      if (useCache) {
        const c = await db.query(
          `SELECT verdict FROM triage_cache
           WHERE signature=$1
             AND updated_at >= NOW() - ($2 || ' hours')::interval`,
          [sig, String(cacheTtlHours)]
        );
        if (c.rows.length) {
          verdict = c.rows[0].verdict;
          source  = 'cache';
          cache_hits++;
          await db.query(
            'UPDATE triage_cache SET hits=hits+1, updated_at=NOW() WHERE signature=$1', [sig]);
        }
      }

      // 2. Miss → call the LLM (agentic investigation or single-shot triage)
      if (!verdict) {
        const expectedNextTokens = llm_calls
          ? Math.max(1500, Math.ceil(llm_tokens / llm_calls))
          : (agentic ? 12000 : (hybrid ? 5000 : 3500));
        if (llm_tokens + expectedNextTokens > tokenBudget) {
          budget_exhausted = true;
          console.warn(
            `[triage] token budget guard reached (${llm_tokens}/${tokenBudget}, ` +
            `next estimate ${expectedNextTokens}); leaving remaining alerts pending`
          );
          break;
        }

        verdict = agentic
          ? await investigateAlert(rep, settings)
          : hybrid
            ? await triageHybrid(rep, rep.enrichment || null, settings)
            : await triageAlert(rep, rep.enrichment || null, settings);
        source = agentic ? 'agentic' : (hybrid ? verdict.triage_path : 'llm');
        llm_calls++;
        llm_tokens += parseInt(verdict.total_tokens || 0, 10) || 0;
        prompt_tokens += parseInt(verdict.prompt_tokens || 0, 10) || 0;
        completion_tokens += parseInt(verdict.completion_tokens || 0, 10) || 0;
        if (verdict.agentic_escalated) agentic_escalations++;

        if (useCache) {
          await db.query(
            `INSERT INTO triage_cache (signature, rule_id, verdict)
             VALUES ($1,$2,$3)
             ON CONFLICT (signature) DO UPDATE
               SET verdict=EXCLUDED.verdict, updated_at=NOW()`,
            [sig, rep.rule_id, verdict]
          );
        }
      }

      // 3. Apply the verdict to every alert in the cluster
      for (const row of members) {
        const v = { ...verdict, signature: sig, triage_source: source, cluster_size: members.length };

        let autoClosed = false, autoReason = null;
        if (settings.autoclose_enabled === 'true') {
          const eligible = (settings.autoclose_verdicts || '').split(',').map(s => s.trim());
          const sevOrder = { informational:0, low:1, medium:2, high:3, critical:4 };
          const ceiling  = settings.autoclose_max_severity || 'medium';
          const minConf  = parseFloat(settings.autoclose_confidence || 0.85);
          if (
            eligible.includes(v.verdict) &&
            (v.confidence || 0) >= minConf &&
            (sevOrder[v.severity] || 0) <= (sevOrder[ceiling] || 2)
          ) {
            autoClosed = true;
            autoReason = `${v.verdict} @ conf ${(v.confidence||0).toFixed(2)}, sev ${v.severity}`;
          }
        }

        await db.query(
          `UPDATE alerts
           SET verdict=$1, triage_status='triaged', triaged_at=NOW(),
               auto_closed=$2, auto_close_reason=$3, signature=$4
           WHERE id=$5`,
          [v, autoClosed, autoReason, sig, row.id]
        );
        triaged++;
      }
    } catch (err) {
      const msg = safeError(err);
      console.error(`[triage] cluster ${sig} failed:`, msg);
      for (const row of members) {
        await db.query(
          `UPDATE alerts SET triage_status='triage_failed', triage_error=$1, signature=$2 WHERE id=$3`,
          [msg.slice(0, 500), sig, row.id]
        );
        failed++;
      }
    }
  }

  console.log(
    `[triage] alerts=${triaged} clusters=${clusters.size} llm_calls=${llm_calls} ` +
    `cache_hits=${cache_hits} tokens=${llm_tokens}/${tokenBudget} mode=${mode}`
  );
  return {
    triaged, failed, llm_calls, cache_hits, clusters: clusters.size,
    llm_tokens, prompt_tokens, completion_tokens, agentic_escalations,
    token_budget: tokenBudget, budget_exhausted,
  };
}

// ── Full run cycle ────────────────────────────────────────────────────────
async function runCycle(trigger = 'scheduler') {
  const settings = await db.getAllSettings();
  const source   = settings.alert_source || 'mock';

  const minutes = source === 'elastic'
    ? parseInt(settings.elastic_lookback_minutes || 1)
    : parseInt(settings.lookback_minutes || 15);

  const minLevel =
    parseInt(settings.min_level || 7);

  const minRiskScore =
    parseInt(settings.elastic_min_risk_score || 48);

  const limit = source === 'elastic'
    ? parseInt(settings.elastic_limit || 20)
    : parseInt(settings.limit || 200);

  const mode =
    settings.triage_mode || 'pipeline';

  const runId = await db.startFetchRun(trigger, mode);
  console.log(`[cycle] run #${runId} started (trigger=${trigger})`);

  const stats = {
    fetched:0, stored:0, duplicates:0,
    enriched:0, enrichment_failed:0,
    triaged:0, triage_failed:0, incidents_created:0,
    llm_calls:0, llm_tokens:0, cache_hits:0, agentic_escalations:0,
    correlation_calls:0, correlation_tokens:0,
  };

  try {
    // 1. Fetch from the selected source
    let alerts;
    let elasticCursorResult = null;

    if (source === 'elastic') {
      const statuses = (
        settings.elastic_alert_statuses ||
        'open,acknowledged'
      )
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);

      const excludeRules = (
        settings.elastic_exclude_rules || ''
      )
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);

      const cursorEnabled =
        (settings.elastic_cursor_enabled || 'false') === 'true';

      /*
       * Automatic Elastic collection must always use the persistent
       * cursor. Refuse to fall back to the latest-window search,
       * because that could skip alerts during high-volume periods.
       *
       * Manual runs may still use the non-cursor mode for testing.
       */
      if (
        trigger === 'scheduler' &&
        !cursorEnabled
      ) {
        throw new Error(
          'Automatic Elastic collection requires ' +
          'elastic_cursor_enabled=true; refusing unsafe fallback'
        );
      }

      const commonElasticOptions = {
        minRiskScore,
        statuses,
        severities: ['high', 'critical'],
        excludeRules,
        groupWindowMinutes: parseInt(
          settings.elastic_group_window_minutes || 5,
          10
        ),
      };

      if (cursorEnabled) {
        let cursor;

        try {
          cursor = JSON.parse(
            settings.elastic_cursor_json || ''
          );
        } catch {
          throw new Error(
            'elastic_cursor_json is not valid JSON'
          );
        }

        elasticCursorResult =
          await searchAlertsCursor({
            ...commonElasticOptions,
            cursor,

            pageSize: parseInt(
              settings.elastic_cursor_page_size || 20,
              10
            ),

            maxPages: parseInt(
              settings.elastic_cursor_max_pages || 5,
              10
            ),

            delaySeconds: parseInt(
              settings.elastic_cursor_delay_seconds || 15,
              10
            ),
          });

        alerts = elasticCursorResult.alerts;

        console.log(
          `[cycle] cursor pages=${elasticCursorResult.pages} ` +
          `window_matches=${elasticCursorResult.total} ` +
          `upper_bound=${elasticCursorResult.upperBound}`
        );
      } else {
        alerts = await fetchElasticAlerts({
          ...commonElasticOptions,
          minutes,
          limit,
        });
      }
    } else {
      alerts = await fetchWazuhAlerts({
        minutes,
        minLevel,
        limit,
      });
    }

    stats.fetched = alerts.length;

    console.log(
      `[cycle] source=${source} fetched=${alerts.length}`
    );

    // 2. Ingest (dedup)
    if (alerts.length) {
      const r = await ingestAlerts(
        alerts,
        runId
      );

      stats.stored = r.stored;
      stats.duplicates = r.duplicates;

      console.log(
        `[cycle] stored=${r.stored} ` +
        `duplicates=${r.duplicates}`
      );

      /*
       * Cursor safety:
       * advance only if every fetched alert was either inserted
       * successfully or already existed as a duplicate.
       */
      if (elasticCursorResult) {
        const processed =
          r.stored + r.duplicates;

        if (processed !== alerts.length) {
          throw new Error(
            `Cursor not advanced: fetched=${alerts.length}, ` +
            `processed=${processed}`
          );
        }

        const previousCursor =
          elasticCursorResult.previousCursor;

        const nextCursor =
          elasticCursorResult.nextCursor;

        if (
          JSON.stringify(nextCursor) !==
          JSON.stringify(previousCursor)
        ) {
          await db.setSetting(
            'elastic_cursor_json',
            JSON.stringify(nextCursor)
          );

          console.log(
            '[cycle] Elastic cursor advanced to ' +
            JSON.stringify(nextCursor)
          );
        }
      }
    }

    // 3. Enrich pending alerts, including any previous backlog.
    const enrichmentBatchSize = Math.min(
      Math.max(
        parseInt(
          settings.enrichment_batch_size || 100,
          10
        ) || 100,
        1
      ),
      1000
    );

    const er = await enrichPending(
      enrichmentBatchSize
    );

    stats.enriched = er.enriched;
    stats.enrichment_failed = er.failed;

    console.log(
      `[cycle] enrichment_batch_size=${enrichmentBatchSize} ` +
      `enriched=${er.enriched} enrich_failed=${er.failed}`
    );

    // 4. Optional AI triage
    const triageEnabled =
      (settings.triage_enabled || 'false') === 'true';

    if (triageEnabled) {
      const tr = await triagePending(settings, 50);
      stats.triaged = tr.triaged;
      stats.triage_failed = tr.failed;
      stats.llm_calls = tr.llm_calls || 0;
      stats.llm_tokens = tr.llm_tokens || 0;
      stats.cache_hits = tr.cache_hits || 0;
      stats.agentic_escalations = tr.agentic_escalations || 0;
      stats.token_budget_exhausted = !!tr.budget_exhausted;

      console.log(
        `[cycle] triaged=${tr.triaged} triage_failed=${tr.failed} ` +
        `llm_calls=${tr.llm_calls || 0} tokens=${tr.llm_tokens || 0}`
      );

      // 5. Optional AI correlation
      if ((settings.correlation_enabled || 'true') === 'true') {
        const cr = await correlatePending(settings, runId);

        stats.incidents_created = cr.incidents_created;
        stats.correlation_calls = cr.llm_calls || 0;
        stats.correlation_tokens = cr.llm_tokens || 0;
        stats.llm_calls += cr.llm_calls || 0;
        stats.llm_tokens += cr.llm_tokens || 0;

        console.log(
          `[cycle] correlated: created=${cr.incidents_created} ` +
          `updated=${cr.incidents_updated} considered=${cr.considered} ` +
          `llm_calls=${cr.llm_calls || 0} tokens=${cr.llm_tokens || 0}`
        );

        if (
          (settings.incident_promote_enabled || 'true') === 'true'
        ) {
          const pr = await promoteSingletons(settings, runId);
          stats.incidents_created += pr.promoted;
        }
      }
    } else {
      console.log(
        '[cycle] AI triage and correlation disabled; ' +
        'alerts remain pending'
      );
    }

    await db.finishFetchRun(runId, stats, 'ok');
    console.log(`[cycle] run #${runId} finished OK`);
    return { runId, stats };
  } catch (err) {
    const msg = safeError(err);
    console.error(`[cycle] run #${runId} FAILED:`, msg);
    await db.finishFetchRun(runId, stats, 'error', msg);
    throw new Error(msg);
  }
}

module.exports = { runCycle, enrichPending, triagePending, correlatePending };
