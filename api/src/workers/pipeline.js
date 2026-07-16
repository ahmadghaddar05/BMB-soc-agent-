'use strict';
const crypto = require('crypto');
const db = require('../db');
const { fetchAlerts: fetchWazuhAlerts } = require('../services/wazuh');
const {
  fetchAlerts: fetchElasticAlerts,
  searchAlertsCursor,
} = require('../services/elastic');
const { runtimeConfig } = require('../config');
const {
  OUTPUT_SCHEMA_VERSION,
  PROMPT_VERSION,
  triageCacheIdentity,
  triageHermes,
} = require('../services/hermes/triage');
const { alertSignature } = require('../services/signature');
const { correlatePending } = require('./correlation');
const { runAutonomousAgent } = require('./autonomous');

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

async function mapWithConcurrency(items, concurrency, worker) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runner() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    () => runner()
  ));
  return results;
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
  const outcomes = await mapWithConcurrency(alerts, 10, async a => {
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
      return r.rowCount > 0 ? 'stored' : 'duplicate';
    } catch (err) {
      console.error(`[ingest] failed to insert ${a.id}:`, safeError(err));
      return 'failed';
    }
  });
  return {
    stored: outcomes.filter(value => value === 'stored').length,
    duplicates: outcomes.filter(value => value === 'duplicate').length,
    failed: outcomes.filter(value => value === 'failed').length,
  };
}

// ── Enrich pending alerts ─────────────────────────────────────────────────
async function enrichPending(limit = 100) {
  const { rows } = await db.query(
    `SELECT id, src_ip, username, hostname, dst_ip, timestamp
     FROM alerts WHERE enrichment_status='pending'
     ORDER BY timestamp DESC LIMIT $1`, [limit]
  );
  if (!rows.length) return { enriched: 0, failed: 0 };

  const outcomes = await mapWithConcurrency(rows, 10, async row => {
    try {
      const ctx = await enrichAlert(row);
      // Store as JSONB -- pass object directly, pg handles serialization
      await db.query(
        `UPDATE alerts
         SET enrichment=$1, enrichment_status='enriched', enriched_at=NOW()
         WHERE id=$2`,
        [ctx, row.id]          // pg will serialize the object to JSONB
      );
      return 'enriched';
    } catch (err) {
      const msg = safeError(err);
      console.error(`[enrich] failed for ${row.id}:`, msg);
      await db.query(
        `UPDATE alerts
         SET enrichment_status='enrichment_failed', enrichment_error=$1
         WHERE id=$2`,
        [msg.slice(0, 500), row.id]
      );
      return 'failed';
    }
  });
  return {
    enriched: outcomes.filter(value => value === 'enriched').length,
    failed: outcomes.filter(value => value === 'failed').length,
  };
}

// ── Triage enriched alerts ────────────────────────────────────────────────
async function triagePending(settings, limit = 50, alertId = null, {
  actor = 'system:scheduler', bypassCache = false,
} = {}) {
  const scopedCondition = alertId ? 'AND id=$1' : '';
  const queryParams = alertId ? [alertId, limit] : [limit];
  const limitPlaceholder = alertId ? '$2' : '$1';
  const { rows } = await db.query(
    `SELECT * FROM alerts
     WHERE triage_status='pending'
       AND enrichment_status='enriched'
       ${scopedCondition}
     ORDER BY rule_level DESC, timestamp DESC
     LIMIT ${limitPlaceholder}`,
    queryParams
  );
  if (!rows.length) return { triaged: 0, failed: 0, llm_calls: 0, cache_hits: 0 };

  const mode = ['pipeline','agentic','hybrid'].includes(settings.triage_mode)
    ? settings.triage_mode : 'pipeline';
  const useCache = (settings.caching_enabled || 'true') === 'true';
  const cacheTtlHours = Math.min(720, Math.max(1,
    parseInt(settings.triage_cache_ttl_hours || 168, 10) || 168));
  const tokenBudget = Math.min(500000, Math.max(10000,
    parseInt(settings.triage_token_budget || 60000, 10) || 60000));

  // Each alert receives its own evidence-grounded result and run provenance.
  // Exact cache identity can reuse a prior result only for the same alert and evidence.
  let triaged = 0, failed = 0, llm_calls = 0, cache_hits = 0;
  let llm_tokens = 0, prompt_tokens = 0, completion_tokens = 0;
  let agentic_escalations = 0, budget_exhausted = false;
  const config = runtimeConfig();

  for (const row of rows) {
    const sig = alertSignature(row);
    const { cacheKey, enrichmentHash } = triageCacheIdentity(row, sig, config.hermesModel);
    try {
      let verdict, source, triageRunId = null;

      // 1. Cache: have we already triaged this exact signature?
      if (useCache && !bypassCache) {
        const c = await db.query(
          `SELECT verdict,agent_run_id FROM triage_cache
           WHERE signature=$1 AND alert_signature=$2
             AND enrichment_fingerprint=$3 AND prompt_version=$4
             AND output_schema_version=$5 AND model=$6
             AND expires_at>NOW() AND agent_run_id IS NOT NULL`,
          [cacheKey, sig, enrichmentHash, PROMPT_VERSION,
            OUTPUT_SCHEMA_VERSION, config.hermesModel]
        );
        if (c.rows.length) {
          verdict = c.rows[0].verdict;
          triageRunId = c.rows[0].agent_run_id;
          source  = 'cache';
          cache_hits++;
          await db.query(
            'UPDATE triage_cache SET hits=hits+1,updated_at=NOW() WHERE signature=$1',
            [cacheKey]
          );
        }
      }

      // 2. Miss → call the LLM (agentic investigation or single-shot triage)
      if (!verdict) {
        const expectedNextTokens = llm_calls
          ? Math.max(1500, Math.ceil(llm_tokens / llm_calls))
          : (mode === 'agentic' ? 12000 : (mode === 'hybrid' ? 5000 : 3500));
        if (llm_tokens + expectedNextTokens > tokenBudget) {
          budget_exhausted = true;
          console.warn(
            `[triage] token budget guard reached (${llm_tokens}/${tokenBudget}, ` +
            `next estimate ${expectedNextTokens}); leaving remaining alerts pending`
          );
          break;
        }

        verdict = await triageHermes(row, { ...settings, triage_mode: mode }, {
          actor, requestId: crypto.randomUUID(), signature: sig, cacheKey, config,
        });
        triageRunId = verdict.run_id;
        source = verdict.triage_path;
        llm_calls += verdict.hermes_calls || 1;
        llm_tokens += parseInt(verdict.total_tokens || 0, 10) || 0;
        prompt_tokens += parseInt(verdict.prompt_tokens || 0, 10) || 0;
        completion_tokens += parseInt(verdict.completion_tokens || 0, 10) || 0;
        if (verdict.agentic_escalated) agentic_escalations++;

        if (useCache) {
          await db.query(
            `INSERT INTO triage_cache(
               signature,rule_id,verdict,alert_signature,prompt_version,
               output_schema_version,model,enrichment_fingerprint,agent_run_id,expires_at
             ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()+($10 || ' hours')::interval)
             ON CONFLICT(signature) DO UPDATE SET
               rule_id=EXCLUDED.rule_id,verdict=EXCLUDED.verdict,
               alert_signature=EXCLUDED.alert_signature,
               prompt_version=EXCLUDED.prompt_version,
               output_schema_version=EXCLUDED.output_schema_version,
               model=EXCLUDED.model,
               enrichment_fingerprint=EXCLUDED.enrichment_fingerprint,
               agent_run_id=EXCLUDED.agent_run_id,
               expires_at=EXCLUDED.expires_at,updated_at=NOW()`,
            [cacheKey, row.rule_id, verdict, sig, PROMPT_VERSION,
              OUTPUT_SCHEMA_VERSION, config.hermesModel, enrichmentHash,
              triageRunId, String(cacheTtlHours)]
          );
        }
      }

      const storedVerdict = {
        ...verdict, signature: sig, triage_source: source, cluster_size: 1,
      };
      await db.query(
        `UPDATE alerts SET verdict=$1,triage_status='triaged',triaged_at=NOW(),
           auto_closed=false,auto_close_reason=NULL,signature=$2,triage_run_id=$3
         WHERE id=$4`,
        [storedVerdict, sig, triageRunId, row.id]
      );
      triaged++;
    } catch (err) {
      const msg = safeError(err);
      console.error(`[triage] alert ${row.id} failed:`, msg);
      await db.query(
        `UPDATE alerts SET triage_status='triage_failed',triage_error=$1,
           signature=$2,auto_closed=false,auto_close_reason=NULL WHERE id=$3`,
        [msg.slice(0, 500), sig, row.id]
      );
      failed++;
    }
  }

  console.log(
    `[triage] alerts=${triaged} llm_calls=${llm_calls} ` +
    `cache_hits=${cache_hits} tokens=${llm_tokens}/${tokenBudget} mode=${mode}`
  );
  return {
    triaged, failed, llm_calls, cache_hits, clusters: rows.length,
    llm_tokens, prompt_tokens, completion_tokens, agentic_escalations,
    token_budget: tokenBudget, budget_exhausted,
  };
}

async function retriageAlert(id, settings, { actor = 'system:retriage' } = {}) {
  const current = await db.query(
    'SELECT id,enrichment_status FROM alerts WHERE id=$1',
    [id]
  );
  if (!current.rows.length) return null;
  if (current.rows[0].enrichment_status !== 'enriched') {
    const error = new Error('Alert must be successfully enriched before Hermes triage');
    error.code = 'HERMES_ENRICHMENT_REQUIRED';
    error.status = 409;
    throw error;
  }
  await db.query(
    `UPDATE alerts SET triage_status='pending',triage_error=NULL,verdict=NULL,
       triaged_at=NULL,auto_closed=false,auto_close_reason=NULL,triage_run_id=NULL
     WHERE id=$1`,
    [id]
  );
  return {
    alert_id: id,
    ...(await triagePending(settings, 1, id, { actor, bypassCache: true })),
  };
}

// ── Full run cycle ────────────────────────────────────────────────────────
async function runCycle(trigger = 'scheduler') {
  const settings = await db.getAllSettings();
  const source   = process.env.ALERT_SOURCE || settings.alert_source || 'mock';

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
    prompt_tokens:0, completion_tokens:0,
    correlation_calls:0, correlation_tokens:0,
    autonomous_run_id:null, investigations_created:0,
    investigation_notes_added:0, case_notes_added:0,
    approvals_requested:0, autonomous_failures:0,
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

      if (r.failed) {
        throw new Error(`Failed to persist ${r.failed} of ${alerts.length} fetched alerts`);
      }

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
      stats.prompt_tokens = tr.prompt_tokens || 0;
      stats.completion_tokens = tr.completion_tokens || 0;
      stats.cache_hits = tr.cache_hits || 0;
      stats.agentic_escalations = tr.agentic_escalations || 0;
      stats.token_budget_exhausted = !!tr.budget_exhausted;

      console.log(
        `[cycle] triaged=${tr.triaged} triage_failed=${tr.failed} ` +
        `llm_calls=${tr.llm_calls || 0} tokens=${tr.llm_tokens || 0}`
      );

    } else {
      console.log(
        '[cycle] AI triage disabled; enriched alerts remain pending'
      );
    }

    // 5. Optional Hermes correlation. This is independent from triage so an
    // accepted backlog can be correlated even when new-alert triage is paused.
    if ((settings.correlation_enabled || 'false') === 'true') {
      const correlation = await correlatePending(settings, runId, {
        actor: `system:${trigger}`,
        requestId: crypto.randomUUID(),
      });
      stats.incidents_created = correlation.incidents_created || 0;
      stats.correlation_calls = correlation.llm_calls || 0;
      stats.correlation_tokens = correlation.llm_tokens || 0;
      stats.llm_calls += correlation.llm_calls || 0;
      stats.llm_tokens += correlation.llm_tokens || 0;
      stats.prompt_tokens += correlation.prompt_tokens || 0;
      stats.completion_tokens += correlation.completion_tokens || 0;
      console.log(
        `[cycle] correlated created=${correlation.incidents_created || 0} ` +
        `updated=${correlation.incidents_updated || 0} considered=${correlation.considered || 0}`
      );
    } else {
      console.log('[cycle] Hermes correlation disabled');
    }

    // 6. Optional autonomous internal SOC orchestration. It consumes only
    // already-validated triage/correlation records and reuses Phase 7's
    // allowlisted, audited, idempotent actions. No external response action is
    // available to this worker.
    if ((settings.autonomous_agent_enabled || 'false') === 'true') {
      const autonomous = await runAutonomousAgent(settings, runId, {
        trigger, actor: `system:autonomous-agent`,
      });
      stats.autonomous_run_id = autonomous.run_id;
      stats.investigations_created = autonomous.metrics.investigations_created || 0;
      stats.investigation_notes_added = autonomous.metrics.investigation_notes_added || 0;
      stats.case_notes_added = autonomous.metrics.case_notes_added || 0;
      stats.approvals_requested = autonomous.metrics.approvals_requested || 0;
      stats.autonomous_failures = autonomous.metrics.failures || 0;
      console.log(
        `[cycle] autonomous run=${autonomous.run_id} status=${autonomous.status} ` +
        `investigations=${stats.investigations_created} notes=${stats.case_notes_added} ` +
        `approvals=${stats.approvals_requested} failures=${stats.autonomous_failures}`
      );
    } else {
      console.log('[cycle] Autonomous SOC agent disabled');
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

module.exports = {
  runCycle, ingestAlerts, enrichPending, triagePending, retriageAlert,
  correlatePending, mapWithConcurrency,
};
