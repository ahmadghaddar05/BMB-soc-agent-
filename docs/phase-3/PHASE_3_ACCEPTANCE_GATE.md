# Phase 3 - Grounded Hermes Analyst Acceptance Gate

## Scope

Phase 3 replaces the fixed chatbot evidence snapshot with application-owned, bounded, read-only SOC tools. It does not migrate automated triage/investigation or correlation; those remain Phase 4 and Phase 5. It does not execute response actions.

The Hermes `api_server` host profile remains tool-less. BMB owns authorization, schemas, queries, enrichment URLs, limits, evidence validation, persistence, and audit.

## Automated gate

- [ ] API lockfile installs cleanly.
- [ ] API syntax check passes.
- [ ] API tests pass, including grounded orchestration, tool authorization, strict schemas, untriaged-alert search, parameter binding, prompt-injection containment, result redaction, timeouts, cancellation, evidence validation, audit failure paths, and stream validation.
- [ ] API dependency audit reports no known vulnerabilities.
- [ ] Enrichment lockfile, syntax check, tests, and dependency audit pass.
- [ ] Frontend lockfile, ESLint, tests, production build, and dependency audit pass.
- [ ] Compose configuration renders successfully.
- [ ] Git whitespace/error check passes.

## Tool boundary

- [ ] Only the documented BMB SOC tools are advertised to Hermes.
- [ ] Every tool has a strict JSON schema with `additionalProperties: false`.
- [ ] The tool executor requires an explicit authenticated read authorization context.
- [ ] Database tools contain no model-authored SQL and use only parameterized values.
- [ ] Enrichment tools use fixed service paths; model values are URL-encoded path/query values only.
- [ ] Raw source payloads, full logs, credentials, secrets, tokens, cookies, and authorization values are omitted or redacted.
- [ ] Tool calls have bounded time, result bytes, rows, history, and total iterations.
- [ ] Unknown tools, malformed arguments, invalid IPs/timestamps, and over-budget calls are denied and audited.
- [ ] Tool results are marked untrusted and prompt-like content inside evidence never changes the tool allowlist or output contract.

## Grounding and persistence

- [ ] The chatbot no longer constructs or reports `soc_evidence_snapshot`.
- [ ] Search includes collected alerts whose `triage_status` is still `pending`.
- [ ] A final citation is accepted only if its exact type/ID was returned by a tool in the current run.
- [ ] Conversations and history remain scoped to the authenticated actor.
- [ ] Every local run, Hermes sub-run, tool call, tool status, usage value, evidence link, final citation, and audit outcome is durable.
- [ ] Failed, cancelled, invalid-output, denied-tool, and timeout paths are recorded.

## Streaming and cancellation

- [ ] `POST /api/chat/stream` emits only bounded progress metadata and one final result or standardized error.
- [ ] Streaming uses authenticated same-origin credentials and CSRF protection for browser sessions.
- [ ] nginx buffering is disabled for the stream response.
- [ ] Browser cancellation stops the active BMB orchestration and calls Hermes `/stop` for a submitted run.
- [ ] `POST /api/chat` continues to provide the same grounded result as one JSON response.

## Live server deployment gate

These checks must run on the Docker/Hermes server:

1. Pull the Phase 3 branch and retain the existing `.env` secrets.
2. Add the four bounded Phase 3 settings from `.env.example`, or use their safe defaults.
3. Keep `/home/trainee/.hermes/config.yaml` with `platform_toolsets.api_server: []`.
4. Confirm Hermes `/health`, `/v1/capabilities`, `/v1/models`, and `/v1/toolsets` from the host and API container.
5. Rebuild/recreate the API and frontend. Confirm migration `003_grounded_hermes_analyst.sql` is present in `schema_migrations`.
6. Confirm `/api/health/dependencies` reports Hermes `online`, `safe: true`, zero active host tools, `application_tool_mode: bounded_read_only`, and the documented application tool count.
7. Collect the manual Elastic critical test alert. Ask Hermes to find it by rule name, ID, and source IP even while its triage state is pending.
8. Confirm the answer cites the exact BMB alert ID and the UI shows `search_alerts`/`get_alert` progress and trace.
9. Insert an alert description containing a prompt-injection attempt. Confirm Hermes treats it as evidence text and neither requests an unapproved tool nor follows the embedded instruction.
10. Cancel a live multi-step request. Confirm the browser reports cancellation and the local/Hermes runs reach a cancelled state.
11. Temporarily request or expose an unsafe Hermes host tool in a non-production test profile. Confirm health/chat fail closed.
12. Reconcile the returned run ID against `agent_runs`, `agent_run_steps`, `agent_tool_calls`, `agent_evidence_links`, `agent_messages`, and `audit_events`.

Useful reconciliation query:

```sql
SELECT r.id, r.status, r.actor, r.model, r.total_tokens,
       COUNT(DISTINCT s.id) AS hermes_steps,
       COUNT(DISTINCT t.id) AS tool_calls,
       COUNT(DISTINCT e.id) AS evidence_links
FROM agent_runs r
LEFT JOIN agent_run_steps s ON s.run_id=r.id
LEFT JOIN agent_tool_calls t ON t.run_id=r.id
LEFT JOIN agent_evidence_links e ON e.run_id=r.id
WHERE r.id='<run_id-from-chat-response>'
GROUP BY r.id;
```

## Completion rule

Phase 3 application code is complete only when the automated gate passes. Production acceptance additionally requires the live server deployment gate against the real Hermes and configured alert source. Any skipped live item must remain explicitly documented as an external validation boundary, not reported as passed.
