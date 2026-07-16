# Phase 3 - Completion Record

Date: 2026-07-16

Branch: `phase-3-grounded-hermes-analyst`

## Completed application scope

- Replaced the fixed top-alert/open-incident evidence snapshot with a bounded structured Hermes investigation loop.
- Added 12 BMB-owned read-only SOC tools for summary, alert search/detail, incident search/detail, observable pivots, identity/logon context, asset/EDR context, threat intelligence, and vulnerability context.
- Included collected alerts that are still pending triage so Phase 3 works while Phase 4 automation remains disabled.
- Kept the Hermes `api_server` host profile tool-less; no Hermes shell, file, browser, web, memory, delegation, cron, or write tool is enabled.
- Added strict per-tool JSON schemas, explicit application authorization, parameterized database queries, fixed enrichment paths, URL encoding, semantic IP/timestamp checks, row/result/iteration/time limits, and sensitive-field redaction.
- Marked all returned SOC fields as untrusted evidence and added prompt-injection instructions plus marker escaping.
- Added a strict tool-call/final-answer protocol and exact evidence type/ID validation for every citation.
- Added durable `agent_run_steps` records so every Hermes sub-run is queryable alongside tool calls, evidence links, messages, usage, and audit events.
- Persisted and audited completed, failed, denied, cancelled, invalid-output, timeout, and over-budget paths.
- Added authenticated NDJSON investigation progress at `POST /api/chat/stream`, retained the JSON `POST /api/chat` endpoint, and propagated cancellation through the tool loop to Hermes.
- Disabled nginx buffering for the grounded analyst stream and aligned its timeout with the bounded investigation timeout.
- Updated the chat UI to show grounded read-only status, active tool progress, completed tools/evidence counts, citations, confidence, and limitations.
- Expanded dependency health with BMB application tool mode/count/names while preserving the strict zero-host-tool safety check.
- Added Phase 3 environment defaults, README guidance, and a live deployment acceptance gate.

## Verified automated gates

- API lockfile dry run: pass.
- API syntax check: pass.
- API tests: 50 passed, 0 failed.
- API dependency audit: 0 known vulnerabilities.
- Enrichment lockfile dry run: pass.
- Enrichment syntax check: pass.
- Enrichment tests: 2 passed, 0 failed.
- Enrichment dependency audit: 0 known vulnerabilities.
- Frontend lockfile dry run: pass.
- Frontend ESLint: pass.
- Frontend tests: 9 passed, 0 failed.
- Frontend production build: pass.
- Frontend dependency audit: 0 known vulnerabilities.
- Git whitespace/error check: pass.
- Repository secret scan: no real credential added; only `.env.example` placeholders matched.

The existing non-blocking frontend chunk-size warning remains tracked for the later design-completion phase.

## Honest deployment boundary

Docker, PostgreSQL, Hermes, and Elastic are installed on the Linux server rather than this laptop. Docker Compose rendering, migration application against the live PostgreSQL volume, the real Hermes structured loop, the manual Elastic alert search, stream behavior through the deployed nginx container, live cancellation, prompt-injection smoke testing, and audit reconciliation must therefore be run on that server using `PHASE_3_ACCEPTANCE_GATE.md`.

The laptop does not have a `docker` executable, so no claim is made that those external checks passed here. This is an external deployment validation boundary, not unfinished Phase 3 application code.

## Later-phase boundary

Phase 3 does not migrate automated triage/investigation or correlation. Those paths remain disabled by default and retain their explicitly labeled legacy provider implementation until Phase 4 and Phase 5. Phase 3 does not execute response actions; later workflow phases must retain authorization and approval gates before any write or containment integration.
