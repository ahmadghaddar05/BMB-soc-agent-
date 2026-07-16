# Phase 4 - Hermes Triage Acceptance Gate

## Scope

Phase 4 migrates automated alert triage, bounded investigation, and hybrid escalation to the shared Hermes Runs API. Phase 5 correlation remains disabled. Automatic closure remains disabled. No response action is executed.

The Hermes host profile remains tool-less. BMB owns tool authorization, schemas, evidence construction, deterministic escalation, cache identity, persistence, and audit.

## Automated gate

- [x] API syntax check and complete API test suite pass (64/64 on 2026-07-16).
- [x] Frontend ESLint, tests, and production build pass (10/10 on 2026-07-16).
- [x] Enrichment syntax check and tests pass (2/2 on 2026-07-16).
- [x] Dependency audits report no unresolved production vulnerability.
- [ ] Compose configuration renders successfully.
- [x] Git whitespace/error check passes.

## Runtime cutover

- [x] `pipeline.js` has no import or call to legacy `triageAlert`, `investigateAlert`, or `triageHybrid`.
- [x] Pipeline, agentic, and hybrid modes all invoke the shared Hermes client.
- [x] Missing, unhealthy, incompatible, or unsafe Hermes fails closed with no Groq, Anthropic, or Ollama fallback.
- [x] Hybrid escalation is deterministic and based only on validated screening fields and configured thresholds.
- [x] Phase 5 correlation cannot be enabled through settings, scheduled cycles, or the manual correlation endpoint.

## Schema, evidence, and tools

- [x] Every final triage result passes the strict `soc-triage-turn-v1` schema.
- [x] Every citation exactly matches evidence supplied in the current triage run.
- [x] Every final result cites the input alert ID.
- [x] Alert and enrichment values are marked untrusted and prompt-like content cannot alter the output or tool contract.
- [x] Agentic tools are BMB-owned, bounded, read-only, schema-validated, and audited.
- [x] Screening mode denies and audits any tool request.
- [x] Tool and orchestration time/call budgets terminate safely and call Hermes `/stop` for submitted runs.

## Persistence and cache safety

- [x] Every triage run exists in `agent_runs` with purpose `triage` and provider `hermes`.
- [x] Every Hermes sub-run, tool call, evidence link, usage value, result, failure, and audit outcome is durable.
- [x] `alerts.triage_run_id` links a stored verdict to its durable Hermes run.
- [x] Cache identity binds alert ID, material alert signature, successful enrichment fingerprint, prompt version, output schema version, and Hermes model.
- [x] Legacy signature-only cache rows are invalidated by migration `004_hermes_triage.sql`.
- [x] Manual retriage bypasses the cache.
- [x] Failed enrichment is never sent to Hermes and cannot seed or consume a triage cache entry.

## Safety policy

- [x] Every alert update writes `auto_closed=false` and clears `auto_close_reason`.
- [x] Settings reject attempts to enable automatic closure, Phase 5 correlation, or incident promotion.
- [x] The frontend exposes Hermes as the triage provider and renders automatic closure/correlation as disabled.
- [x] Triage remains disabled on a fresh database until the live acceptance gate is completed.

## Live server deployment gate

1. Pull the Phase 4 branch and retain the existing `.env` secrets.
2. Add `HERMES_TRIAGE_MAX_TOOL_CALLS=3` and `HERMES_TRIAGE_TIMEOUT_MS=180000`.
3. Keep `/home/trainee/.hermes/config.yaml` with `platform_toolsets.api_server: []`.
4. Rebuild/recreate the API and frontend. Confirm migration `004_hermes_triage.sql` appears in `schema_migrations`.
5. Confirm `/api/health/dependencies` reports Hermes `online`, `safe: true`, and zero active host tools.
6. Keep `triage_enabled=false`; collect and enrich a small real Elastic batch.
7. Select one successfully enriched real alert and call its retriage endpoint. Confirm a strict Hermes verdict appears and `auto_closed` remains false.
8. Reconcile the alert against `agent_runs`, `agent_run_steps`, `agent_tool_calls`, `agent_evidence_links`, and `audit_events`.
9. Repeat in `pipeline`, `agentic`, and `hybrid` modes with a controlled small batch.
10. Stop Hermes and confirm triage fails without any request to a legacy provider.
11. Force enrichment failure and confirm the alert is not triaged and no cache row is written.
12. Attempt to enable auto-close and correlation; confirm both settings requests are rejected.
13. Only after the above checks, deliberately set `triage_enabled=true` and monitor token budget, failures, latency, and verdict quality on a bounded batch.

Useful reconciliation query:

```sql
SELECT a.id, a.triage_status, a.auto_closed, a.triage_run_id,
       r.status AS run_status, r.provider, r.model, r.prompt_version,
       r.output_schema_version, r.total_tokens,
       COUNT(DISTINCT s.id) AS hermes_steps,
       COUNT(DISTINCT t.id) AS tool_calls,
       COUNT(DISTINCT e.id) AS evidence_links
FROM alerts a
LEFT JOIN agent_runs r ON r.id=a.triage_run_id
LEFT JOIN agent_run_steps s ON s.run_id=r.id
LEFT JOIN agent_tool_calls t ON t.run_id=r.id
LEFT JOIN agent_evidence_links e ON e.run_id=r.id
WHERE a.id='<exact-alert-id>'
GROUP BY a.id,r.id;
```

## Completion rule

Phase 4 application code is complete only when the automated gate passes. Production acceptance additionally requires the live server gate against the real Hermes and Elastic deployment. Phase 5 correlation and all automatic response actions remain out of scope.
