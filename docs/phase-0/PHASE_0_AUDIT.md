# Phase 0 — Current-State Audit

Audit date: 2026-07-15

Branch: `ui-redesign` at `060d450`

Scope: `api`, `enrichment`, `eval`, `frontend`, `postgres`, Docker configuration, Hermes integration, and project documentation.

## Executive verdict

The repository is a functional prototype, not yet a production SOC platform. The React production bundle builds, active backend JavaScript parses and loads, the evaluation demo runs, and the enrichment service works against its bundled static datasets. The application contains real alert collection, persistence, enrichment, triage, correlation, incident, pivot, reporting, and settings code.

Hermes is not the platform agent. It is used only by `POST /api/chat` when `HERMES_API_KEY` is non-empty. It receives one fixed database snapshot and has no tool-calling loop. Alert triage, agentic investigation, correlation, and the fallback chatbot still use the legacy Groq/Anthropic/Ollama service.

Several redesigned screens are presentation layers over real endpoints, but investigations, cases, playbooks, assignments, watchlists, blocking, escalation, and response progress are partly or entirely browser-local. There is no authentication, authorization, durable agent audit trail, or server-side action approval system.

Phase 0 made no production behavior changes. Only audit documentation was added.

## What was verified

| Check | Result | Evidence |
|---|---|---|
| Git worktree before audit | Pass | Clean `ui-redesign`, tracking `origin/ui-redesign` |
| Active backend/eval JavaScript syntax | Pass | All active `.js` files passed `node --check` |
| API module loading | Pass | Routes, Hermes, legacy LLM, pipeline, and correlation modules loaded |
| Frontend production build | Pass with warning | Vite transformed 2,318 modules; JS bundle 735.06 kB, 204.50 kB gzip |
| Evaluation harness | Pass, demo only | Built-in synthetic example produced accuracy/F1 output |
| Enrichment process | Pass | Health and representative AD, CMDB, TIP, and composite enrichment calls succeeded |
| Database integration | Not executable here | No Docker, `psql`, `.env`, or running PostgreSQL |
| Elastic integration | Not executable here | No credentials, CA file, `.env`, or reachable configured service |
| Wazuh integration | Not executable here | No credentials, `.env`, or reachable configured service |
| Hermes integration | Not executable here | No `.env`, Hermes credential, or declared reachable service |
| Browser visual QA | Not executable here | No in-app or Chrome browser backend was available; production build still passed |

An unverified external check is not counted as passing or failing.

## Current architecture

1. `api/src/workers/scheduler.js` triggers a pipeline cycle.
2. The pipeline selects Elastic or Wazuh/mock using the database `alert_source` setting.
3. Source alerts are normalized, grouped, and inserted into PostgreSQL.
4. Pending alerts are enriched through the internal enrichment HTTP service.
5. If `triage_enabled=true`, the legacy LLM service triages signature clusters.
6. The legacy LLM service correlates plausible alert candidates into incidents.
7. Significant standalone triaged alerts may be promoted to incidents.
8. Express exposes alert, incident, pivot, report, settings, scheduler, stats, and chat routes.
9. React consumes those routes through nginx `/api` proxying.
10. Hermes is selected only inside the chat route and only when its API key exists.

## Data inventory

### PostgreSQL tables

| Table | Current responsibility | Missing for target platform |
|---|---|---|
| `settings` | String key/value runtime configuration | Schema validation, secret separation, versioning |
| `alerts` | Raw/normalized alert, enrichment, verdict, lifecycle, Elastic grouping | Analyst state, evidence normalization, agent run reference |
| `incidents` | LLM-correlated alert arrays and narrative | Assignments, notes, disposition history, stable entity model |
| `fetch_runs` | Basic collection/enrichment/triage counters | AI calls, tokens, latency, correlation counters, per-stage timing |
| `triage_cache` | Signature-to-verdict cache | Prompt version, enrichment hash, provider/model version, safe invalidation |

There are no database entities for users, roles, conversations, agent runs, tool calls, investigations, cases, notes, assignments, playbook definitions/runs, watchlists, action requests, approvals, notifications, or audit events.

### Enrichment datasets

The service loads static JSON at process start: 100 AD users, 31 AD groups, 25 CMDB assets, 22 EDR agents, 25 EDR detections, 13 threat indicators, and 37 vulnerability findings. These are useful demo fixtures, not live enterprise connectors.

## API inventory

The API exposes 24 routes:

- Health: `GET /api/health`
- Settings: `GET/PUT /api/settings`
- Scheduler/collector: status, run-now, enrich-pending, triage-pending, correlate-now
- Alerts: list, grouped list, critical list, detail, retriage
- Incidents: list, detail, status update
- Intelligence: IOC pivot
- Reports: alert, incident, and single-incident PDFs
- AI: chat
- Analytics: stats and run history

The enrichment service exposes 10 routes for health, AD, CMDB, EDR, TIP, vulnerability, and composite enrichment.

## Hermes audit

Confirmed current behavior:

- `HERMES_API_KEY` acts as the chat routing switch.
- Hermes receives at most 12 recent alerts and 8 open incidents plus aggregate stats.
- The evidence window is fixed to 24 hours.
- Only the last four user/assistant history entries are included.
- Hermes uses a single `/chat/completions` request.
- No native or emulated tool calls are supplied.
- No retry/backoff exists for network errors or HTTP 429.
- No structured output schema is requested or validated.
- Citations are requested in the prompt but not programmatically verified.
- The conversation and response are not persisted.
- `tools_used` always reports a synthetic `soc_evidence_snapshot` item.
- If the Hermes key is absent, chat silently falls back to the legacy LLM service.
- Triage, agentic investigation, hybrid triage, and correlation never call Hermes.

Hermes capabilities that must be verified against a live configured instance before Phase 2 design is frozen: native function calling, JSON/structured output behavior, streaming, context limits, cancellation, usage reporting, and supported error/rate-limit semantics.

## Confirmed findings

### Critical

**P0-001 — No authentication or authorization.** The nginx frontend exposes `/api`; Express has no identity middleware, role checks, or audit actor. Any reachable user can read SOC evidence, change settings, trigger pipeline work, retriage alerts, change incident status, and download reports.

**P0-002 — Operational-looking response controls do not execute controlled actions.** Incident buttons labeled Disable, Isolate, and Run only toggle React session state. Threat-intelligence “Block indicator” only writes local storage. This can mislead an analyst about containment state.

### High

**P0-003 — Hermes is chat-only while all autonomous AI remains legacy.** `pipeline.js` and `correlation.js` import `services/llm.js`; settings and Docker default to Groq.

**P0-004 — Retrieging an alert is not scoped to that alert.** The route resets the requested ID and then calls `triagePending(settings, 1)`, whose query selects the highest-level newest pending alert globally. A missing ID also receives no 404 and can trigger triage of an unrelated pending alert.

**P0-005 — Individual alert search has a SQL placeholder defect.** The `/alerts` search branch increments the parameter counter once too many. Pagination placeholders then exceed the supplied parameter array. This directly affects the Investigations evidence search.

**P0-006 — Browser-local SOC records are not durable or collaborative.** Investigations, case owners/notes, incident owners, playbook runs, threat watch/block lists, alert pins/escalations, saved views, and response progress are absent from the server data model.

**P0-007 — No migration runner or schema versioning exists.** PostgreSQL init scripts run automatically only for a fresh volume. Existing deployments require undocumented/manual execution and can silently miss later schema/settings changes.

**P0-008 — AI baseline instrumentation is not persisted.** Pipeline memory tracks AI calls and tokens, but `fetch_runs` and `finishFetchRun` discard them. The export script substitutes triaged alerts for LLM calls and hardcodes tokens/latency to zero. The checked-in ground truth contains placeholder IDs.

**P0-009 — Model confidence can drive automatic closure.** Legacy model-generated confidence, verdict, and severity feed the auto-close gate. This is not a calibrated or deterministic safety signal.

**P0-010 — Triage cache identity is insufficient.** Cache keys contain only the alert signature. They exclude prompt version, model/Hermes version, and enrichment hash; alerts whose enrichment failed are eligible for triage and caching.

**P0-011 — No agent audit or approval model exists.** There are no durable conversations, tool calls, action proposals, approvals, or actor-attributed audit events.

**P0-012 — Environment documentation is incomplete and stale.** `.env.example` omits Elastic and Anthropic variables used by Compose. README startup URLs do not match port `8080`, calls `/api/health` Swagger, and documents a Wazuh/Groq platform rather than the current Elastic/Hermes branch.

**P0-013 — Wazuh TLS setting is ineffective.** `WAZUH_VERIFY_TLS=false` reaches an empty conditional block and no request-specific TLS agent is supplied. Self-signed Wazuh behavior therefore does not match configuration/documentation.

### Medium

**P0-014 — Integration cards do not test the named integrations.** Elastic and enrichment cards call `/collector/status`; AI and PostgreSQL cards call `/settings`. These prove the API/database query responded, not that Elastic, enrichment, Hermes/LLM, or PostgreSQL-specific health is good.

**P0-015 — UI health and identity labels are hardcoded.** “Agent online,” “Monitoring Elastic,” “Intelligence connected,” analyst name/role, and some operational claims are displayed without corresponding health or identity evidence.

**P0-016 — No lockfiles or test scripts.** All packages install floating versions allowed by semver; Docker runs `npm install`. Package scripts provide no unit, integration, lint, or end-to-end test command.

**P0-017 — Frontend errors are often hidden.** Several pages use `finally` without `catch`; Dashboard suppresses grouped/alert failures with empty fallbacks; detail failures fall back to summary data. Users can see empty or stale views without a visible error.

**P0-018 — Collection and enrichment are sequential.** Per-alert insert and enrichment loops limit throughput and make a 1,000-alert configured batch potentially slow.

**P0-019 — Route input constraints are inconsistent.** Several page/limit/time inputs are not bounded or rejected consistently. Incident update does not return 404 when no record is changed.

**P0-020 — Search and severity semantics differ by view.** Grouped alerts use source severity and `dataset`; individual alerts use verdict severity and omit dataset filtering. Switching views can change results unexpectedly.

**P0-021 — Hermes and legacy HTTP behavior lacks a common reliability contract.** Hermes has a timeout but no retries; legacy JSON/tool calls have retries but no request timeout. Error formats and usage accounting differ.

**P0-022 — Prompt-injection boundaries are incomplete.** Raw alert/log/enrichment content is embedded into model prompts without a strong untrusted-data boundary or output citation enforcement.

**P0-023 — Elastic CA configuration is rigid.** The code requires a readable CA file even when TLS verification is disabled, and Compose mounts a fixed Linux host certificate path. This is not portable and can fail before connectivity is tested.

**P0-024 — Frontend bundle is large.** The production JS chunk is 735.06 kB minified and triggers Vite's chunk-size warning; all pages are eagerly imported.

### Low / maintenance

**P0-025 — Dead and duplicate source exists.** `frontend/src/Reports.jsx` duplicates the routed page exactly, `Pivot.jsx` is not routed, and numerous `.before-*`/`.backup` source trees remain inside the repository/build context.

**P0-026 — Unused configuration exists.** `VITE_API_URL`, `ELASTIC_SPACE_ID`, scheduler environment defaults, and several database flags are declared but not consumed by active application behavior.

**P0-027 — Documentation contains mojibake in this Windows checkout/output path.** Several rendered console/source excerpts show broken UTF-8 punctuation. Encoding should be standardized and verified in UI/report output.

## Positive foundations to retain

- Parameterized SQL in the existing chatbot tools; no model-authored SQL path.
- Backend-only AI keys.
- Elastic read-only collection design and cursor safety checks.
- Alert ID filtering on legacy correlation output.
- Signature clustering, cache TTL check, token budget guard, and incremental correlation cursor.
- Closed/false-positive incidents are not intentionally reopened.
- PostgreSQL and API ports are bound to loopback in Compose.
- Enrichment is isolated behind an internal service and composite endpoint.
- Frontend compiles successfully and has a broad, coherent navigation structure.
- The evaluation metric functions provide a useful starting point once real labels and instrumentation exist.

## Phase 0 completion statement

The repository has been statically audited end to end, all locally executable checks have been run, and every unavailable external verification has an explicit prerequisite. Phase 1 should begin from `PHASE_1_ACCEPTANCE_GATE.md`; no production fixes were intentionally mixed into this phase.
