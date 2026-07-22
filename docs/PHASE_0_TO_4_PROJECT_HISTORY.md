# BMB SOC Agent: Phase 0 to Phase 4 Project History

Date: 2026-07-16  
Current milestone: Phase 4 application code complete; live Phase 4 acceptance still required before enabling automatic triage broadly.

## 1. Purpose of this document

This document explains what changed from Phase 0 through Phase 4, why each phase was necessary, and how the system evolved both logically and technically.

It is written for two audiences:

- Non-technical readers who need to understand the business and security outcome.
- Technical readers who need a concise record of the architecture, code changes, data model, controls, testing, and remaining work.

No secrets, passwords, API keys, or private credential values are included.

## 2. Executive summary

We started with a broad SOC prototype. It could collect alerts, enrich them, display them, call AI models, and present many analyst workflows, but several important controls were missing or incomplete. Hermes existed only as an optional chatbot path, automated triage still used direct legacy providers, many UI actions were local-only, and there was no reliable authentication, migration, audit, or evidence-grounding foundation.

We deliberately improved the system in this order:

1. **Phase 0 - Understand reality:** audit the entire repository and separate real features from mock, partial, local-only, and unsafe behavior.
2. **Phase 1 - Make the foundation safe and reliable:** add authentication, validation, migrations, accurate metrics, dependency checks, tests, and operational reliability.
3. **Phase 2 - Establish one trusted AI boundary:** build the shared Hermes Runs API client, fail closed, validate capabilities and outputs, and persist every AI run.
4. **Phase 3 - Ground the analyst:** replace the fixed chatbot snapshot with bounded, application-owned, read-only SOC tools and verifiable citations.
5. **Phase 4 - Migrate automated triage:** move pipeline, agentic, and hybrid triage to Hermes with strict evidence, cache, audit, and safety rules.

The result is not simply "an AI chatbot connected to alerts." It is an application-controlled SOC system in which Hermes can reason over bounded evidence, while the BMB API owns permissions, queries, validation, persistence, budgets, and safety decisions.

## 3. Before and after

| Area | Phase 0 state | Phase 4 state |
|---|---|---|
| User access | No authentication or authorization boundary | Signed HttpOnly session, CSRF protection, optional bearer key, CORS restrictions, rate limits, security headers |
| Database lifecycle | Fresh-volume initialization only | Versioned, advisory-locked, idempotent migrations recorded in `schema_migrations` |
| Hermes | Optional single-shot chatbot; silent legacy fallback | Required, capability-checked Runs API boundary for chat and triage; no legacy fallback |
| Chat evidence | Fixed recent-alert/incident snapshot | Bounded read-only SOC tools selected during a structured investigation loop |
| Automated triage | Direct Groq/Anthropic/Ollama implementation | Hermes-only pipeline, agentic, and deterministic hybrid modes |
| Evidence grounding | Citations requested but not enforced | Exact evidence type/ID validation; Phase 4 verdict must cite its input alert |
| Agent records | No durable conversation/tool/audit model | Durable conversations, messages, runs, sub-runs, tool calls, evidence links, usage, failures, and audit events |
| Cache safety | Alert signature only | Exact alert, material signature, enrichment fingerprint, prompt version, schema version, model, run, and expiry |
| Automatic response | Model confidence could affect automatic closure | Automatic closure, incident promotion, and response actions disabled |
| Correlation | Legacy provider path could run | Disabled until its separate Hermes migration in Phase 5 |
| Health | Several UI cards checked generic endpoints | Direct PostgreSQL, enrichment, Hermes, and selected-source dependency checks |
| Testing | No dependable test/lint/lockfile gate | Lockfiles, lint/syntax gates, API/enrichment/frontend tests, builds, audits, and phase acceptance records |

## 4. Current architecture after Phase 4

```text
Elastic / Wazuh / Mock source
            |
            v
     Collection worker
            |
     normalize + deduplicate
            |
            v
        PostgreSQL
            |
            v
   Enrichment service
 AD / CMDB / EDR / TIP / Vuln
            |
            v
  Successfully enriched alerts
            |
            +----------------------------+
            |                            |
            v                            v
  Hermes triage orchestration     Analyst chatbot
 pipeline / agentic / hybrid      structured investigation
            |                            |
            +------------+---------------+
                         |
            BMB-owned read-only tools
            strict schemas and limits
                         |
                         v
       validated result + exact citations
                         |
                         v
      durable run/evidence/audit records
                         |
                         v
               React analyst interface
```

The central design rule is that Hermes does not control the database, host, network, or response integrations. Hermes returns a validated structured request or result. The API decides whether a tool is allowed, validates arguments, executes parameterized read-only logic, sanitizes the result, and records the outcome.

---

## 5. Phase 0 - Audit and roadmap

### Non-technical explanation

Phase 0 answered a basic but critical question: **what does the product really do today?**

The UI looked like a complete SOC platform, but some screens were real, some were partially connected, and others only changed browser state. We needed an honest baseline before changing production behavior. Phase 0 therefore changed documentation, not runtime behavior.

### Why we did it

- To avoid building new AI automation on top of unknown security and data-quality problems.
- To distinguish real backend operations from visual demonstrations.
- To identify where Hermes was actually used and where legacy AI providers still controlled behavior.
- To create an ordered backlog instead of fixing isolated symptoms.

### What we found

The prototype already had useful foundations:

- React/Vite frontend with a broad SOC interface.
- Node/Express API.
- PostgreSQL alert and incident storage.
- Elastic, Wazuh, and mock collection paths.
- Alert normalization, grouping, deduplication, enrichment, triage, correlation, reports, and pivots.
- A separate enrichment service with bundled AD, CMDB, EDR, threat-intelligence, and vulnerability data.

The audit also identified major gaps:

- No authentication, authorization, CSRF protection, or actor-attributed audit trail.
- Hermes was chat-only and received one fixed snapshot.
- Chat silently fell back to Groq, Anthropic, or Ollama.
- Automated triage, investigation, and correlation bypassed Hermes.
- Alert retriage could select the wrong alert.
- Individual alert search had a PostgreSQL placeholder defect.
- Existing databases had no dependable migration runner.
- AI metrics were inaccurate or discarded.
- Model confidence could contribute to automatic closure.
- Cache keys ignored model, prompt, schema, and enrichment changes.
- Many apparent response actions were browser-local and did not contain threats.
- Health cards, environment documentation, TLS behavior, validation, and error reporting were incomplete.

### How we documented it

Phase 0 produced:

- `docs/phase-0/PHASE_0_AUDIT.md`
- `docs/phase-0/FEATURE_MATRIX.md`
- `docs/phase-0/ISSUE_BACKLOG.md`
- `docs/phase-0/HERMES_MIGRATION_MAP.md`
- The Phase 1 acceptance gate

The migration map established the long-term rule that chat, triage, investigation, and correlation should eventually share one Hermes boundary, while deterministic application code retains permissions and write authority.

---

## 6. Phase 1 - Stabilize and secure the foundation

### Non-technical explanation

Phase 1 made the prototype safe enough to build on. Before adding more AI capability, we secured access, made database upgrades repeatable, corrected important alert-query bugs, made operational status truthful, and introduced repeatable quality checks.

### Why we did it

An AI agent should not be added to an unauthenticated API with unreliable migrations and ambiguous health signals. Phase 1 reduced the risk that a user, deployment, or future agent could trigger the wrong operation or act on misleading data.

### Logical changes

- Users must authenticate before accessing SOC data or changing operational state.
- Browser writes require CSRF protection.
- Automation can use an explicit backend API key rather than a browser cookie.
- Every request receives an ID so failures can be traced.
- Input is rejected early when pagination, dates, enums, or identifiers are invalid.
- Retrieging alert A can only retriage alert A.
- A missing alert or incident returns a clear 404.
- Service health means the named dependency was actually checked.
- Collection and enrichment are bounded rather than unbounded sequential loops.
- Database upgrades run exactly once and are tracked.
- UI controls that do not execute real containment are labeled truthfully.

### Technical/code changes

| Code area | Brief change |
|---|---|
| Package management | Added deterministic lockfiles, supported Node engine ranges, and `npm ci` Docker builds for API, enrichment, and frontend |
| Database | Added an advisory-locked migration runner and consolidated idempotent schema; began recording applied versions |
| Authentication | Added signed HMAC session cookies, HttpOnly and SameSite behavior, login/logout/session routes, CSRF validation, and optional bearer API authentication |
| API security | Added restricted CORS, Helmet security headers, body limits, request IDs, login/chat rate limits, and production configuration checks |
| Routes | Fixed alert-search placeholder numbering, exact retriage scoping, missing-record behavior, pagination bounds, enum/date validation, and standardized errors |
| Pipeline | Added bounded concurrency for ingestion and enrichment and persisted accurate AI/cache/correlation/token/duration metrics |
| Sources/TLS | Made `mock`, `elastic`, and `wazuh` explicit startup modes; added request-scoped TLS behavior and portable Elastic CA configuration |
| Health | Added dependency-specific PostgreSQL, enrichment, Hermes, and selected alert-source checks |
| Frontend | Added login/session handling, authenticated identity, visible API failures, dependency-backed status, and truthful local-only labels |
| Documentation | Corrected ports, environment variables, startup instructions, source modes, and the Hermes/legacy boundary |

### Verification

- API: 20 tests passed.
- Enrichment: 2 tests passed.
- Frontend: 5 tests passed; lint and production build passed.
- Dependency audits reported zero vulnerabilities.
- The mock cycle fetched, stored, and enriched four alerts with zero AI calls.

---

## 7. Phase 2 - Hermes agent foundation

### Non-technical explanation

Phase 2 changed Hermes from an optional chatbot endpoint into a trusted platform service. The application now verifies Hermes before using it, records every conversation and run, rejects unsupported or unsafe configurations, and never silently switches the chatbot to another provider.

### Why we did it

Without a shared reliability and audit boundary, every AI feature would implement its own timeouts, retries, errors, usage accounting, and security assumptions. Phase 2 created one reusable Hermes contract before expanding AI access to more SOC data.

### Logical changes

- Hermes must prove which model and capabilities it supports.
- Hermes must support starting, polling, and stopping Runs API jobs.
- The configured Hermes host profile must be tool-less.
- Missing, unhealthy, incompatible, or unsafe Hermes fails closed.
- The browser is not the authority for conversation history; PostgreSQL is.
- Every citation must refer to evidence supplied during that run.
- Cancellation in the browser propagates to Hermes.
- Every successful and failed AI interaction becomes queryable evidence.

### Technical/code changes

| Code area | Brief change |
|---|---|
| Hermes client | Added shared Runs API client for `/v1/capabilities`, `/v1/models`, `/v1/toolsets`, `/v1/runs`, run status, and run stop |
| Reliability | Added request and whole-run timeouts, bounded transient retries, `Retry-After`, idempotency keys, response-size limits, polling, cancellation, and `/stop` |
| Protocol validation | Added strict JSON schemas for capability, run, and chatbot output envelopes |
| Grounding | Added exact evidence-ID citation validation to reject hallucinated references |
| Routing | Removed the chatbot's Groq/Anthropic/Ollama fallback |
| Persistence | Migration 002 added conversations, messages, runs, tool calls, evidence links, future action request/approval records, and audit events |
| Provenance | Stored actor, request ID, local/Hermes run IDs, provider/model, prompt/schema version, attempts, latency, status/error, and token usage |
| Frontend | Added conversation continuity, verified citation display, new-conversation control, and cancellation |
| Health/config | Added detailed Hermes safe-profile health and aligned the server contract to authenticated port 8642 |

### Why Hermes remained tool-less

At this stage, the chatbot still used a fixed application-generated evidence snapshot. Enabling Hermes host tools would have added filesystem, shell, browser, or network authority without a business need. The secure choice was to keep `platform_toolsets.api_server: []` and let the BMB API own all future SOC tools.

### Verification

- API: 35 tests passed.
- Enrichment: 2 tests passed.
- Frontend: 7 tests passed; lint and production build passed.
- Dependency audits reported zero vulnerabilities.
- Tests covered handshake safety, retries, cancellation, structured output, citation rejection, durable records, actor scoping, and fail-closed routing.

---

## 8. Phase 3 - Grounded Hermes analyst

### Non-technical explanation

Phase 3 changed the chatbot from "answer using this small fixed snapshot" to "investigate using a safe set of SOC lookups." Hermes can ask the application for more evidence, but it cannot directly query the database or access the server.

This made the chatbot useful for real analyst questions such as searching alerts by identity, inspecting a specific alert, pivoting an IP, or checking asset, EDR, threat-intelligence, and vulnerability context.

### Why we did it

A fixed snapshot often omitted the evidence needed to answer a question. Sending much larger snapshots would increase cost, leak unnecessary data, and still provide no reliable evidence trace. Bounded tools allow the model to request only the context needed for the current investigation.

### Logical changes

- Hermes may request one approved application tool at a time.
- The API validates the tool name and every argument.
- The API executes fixed parameterized queries or fixed enrichment-service paths.
- Results are bounded, sanitized, and explicitly marked as untrusted data.
- Hermes either requests another permitted tool or returns one strict final answer.
- Final citations are accepted only if that exact evidence was returned in the current run.
- The browser receives bounded progress events rather than hidden long-running work.

### BMB-owned read-only tools

Phase 3 added 12 structured tools:

1. SOC summary and collection-run context.
2. Alert search.
3. Alert detail.
4. Incident listing/search.
5. Incident detail.
6. Observable pivot.
7. Identity context.
8. Logon context.
9. Asset context.
10. EDR context.
11. Threat-intelligence context.
12. Vulnerability context.

### Technical/code changes

| Code area | Brief change |
|---|---|
| `hermes/soc-tools.js` | Defined strict tool schemas, authorization checks, parameterized queries, fixed service paths, result limits, redaction, and evidence descriptors |
| Hermes chat orchestration | Added the structured tool-call/final-answer loop with call/time budgets and prompt-injection boundaries |
| Migration 003 | Added `agent_run_steps` so each Hermes sub-run is independently queryable |
| API streaming | Added authenticated NDJSON progress at `POST /api/chat/stream` while retaining regular JSON chat |
| Cancellation | Connected browser abort to the BMB loop and Hermes `/stop` |
| nginx | Disabled buffering for the streaming route and aligned timeouts |
| Chat UI | Displayed grounded/read-only status, active/completed tools, evidence counts, citations, confidence, and limitations |
| Alert search | Included collected alerts still pending triage, allowing analysis before Phase 4 automation was enabled |

### Security controls

- No model-authored SQL.
- No arbitrary URL, filesystem path, command, or host-tool execution.
- `additionalProperties: false` schemas reject hidden arguments.
- Values are URL encoded when inserted into fixed enrichment paths.
- Raw logs, source payloads, credentials, authorization headers, tokens, and cookies are omitted or redacted.
- Row, byte, history, iteration, and time limits are enforced.
- Unknown, malformed, unauthorized, timed-out, and over-budget calls are denied and audited.
- Evidence containing prompt-like text is data, never an instruction.

### Verification

- API: 50 tests passed.
- Enrichment: 2 tests passed.
- Frontend: 9 tests passed; lint and production build passed.
- Dependency audits reported zero vulnerabilities.
- Tests covered tools, authorization, schemas, untriaged search, parameter binding, redaction, prompt-injection containment, timeouts, cancellation, evidence validation, persistence, and streaming.

---

## 9. Phase 4 - Hermes-only automated triage

### Non-technical explanation

Phase 4 applied the safe Hermes foundation to automatic alert assessment. The system can now screen an alert, investigate it with approved read-only tools when needed, and return a structured severity, verdict, confidence, attack stage, findings, recommended analyst actions, limitations, and evidence citations.

The AI still cannot close alerts or execute containment. It recommends; the application validates and stores.

### Why we did it

The original automated triage path still called Groq, Anthropic, or Ollama directly. Its cache did not account for enrichment or prompt/model changes, and enrichment failures could enter triage. Those behaviors were not consistent with the Hermes-only, evidence-grounded architecture established in Phases 2 and 3.

### The three triage modes

| Mode | Logical behavior | Intended use |
|---|---|---|
| `pipeline` | One strict Hermes screening run with no tools | Safest and lowest-cost default |
| `agentic` | Bounded Hermes investigation using approved BMB tools | Deep analysis of selected alerts |
| `hybrid` | Strict screening followed by deterministic escalation when high-risk evidence remains ambiguous | Controlled balance between cost and depth |

Hybrid escalation is decided by application code using validated severity, confidence, verdict, and configured rule-level thresholds. Hermes cannot decide to bypass this policy.

### Technical/code changes

| Code area | Brief change |
|---|---|
| `hermes/triage.js` | Added the Phase 4 orchestration, prompts, evidence input, triage modes, deterministic escalation, budgets, run-scoped sessions, citation enforcement, and cache identity |
| `hermes/schemas.js` | Added strict triage turn/final schemas for severity, verdict, confidence, attack stage, findings, actions, narrative, citations, and limitations |
| `hermes/store.js` | Added durable triage start, completion, failure, citation, usage, and audit persistence |
| `pipeline.js` | Removed runtime legacy triage imports/calls and routed enriched pending alerts to Hermes |
| Routes | Added actor-aware manual triage/retriage errors and disabled the manual correlation endpoint until Phase 5 |
| Migration 004 | Added `alerts.triage_run_id` and exact cache provenance fields; invalidated old signature-only cache entries |
| Settings | Rejected attempts to enable automatic closure, correlation, or incident promotion |
| Frontend settings | Replaced legacy provider controls with Hermes triage modes and showed auto-close/correlation as disabled |
| Configuration | Added triage tool-call and orchestration timeout limits to config, `.env.example`, and Compose |

### Exact cache identity

The old cache used only an alert signature. Phase 4 binds a cache entry to:

- Exact alert ID.
- Material alert signature.
- Successful enrichment status and enrichment fingerprint.
- Prompt version.
- Output schema version.
- Hermes model.
- Durable agent run.
- Expiration time.

Manual retriage bypasses cache. Failed enrichment cannot be sent to Hermes and cannot create or consume a cache entry.

### Evidence and session isolation

- Every final verdict must cite evidence returned during that run.
- Every final verdict must specifically cite its exact input alert.
- Each durable triage run receives a separate Hermes session, preventing a later retriage from inheriting prior hidden context.
- Steps inside one investigation share only that run-scoped session.

### Safety outcome

- No Groq, Anthropic, or Ollama fallback for chat or triage.
- No automatic alert closure.
- No incident promotion.
- No Phase 5 correlation execution.
- No response or containment action.
- Hermes host tool profile remains empty.

### Verification

- API: 64 tests passed.
- Enrichment: 2 tests passed.
- Frontend: 10 tests passed; lint and production build passed.
- API, frontend, and enrichment dependency audits reported zero vulnerabilities.
- Git whitespace/error validation passed.
- Docker Compose rendering and real live triage remain server-side acceptance checks because Docker is not installed on the Windows development machine.

---

## 10. Operational deployment and troubleshooting completed

In addition to repository changes, the live Linux environment required several configuration and integration fixes.

### API startup credentials

The API intentionally rejected weak or missing secrets. We generated and stored values meeting these minimums:

- Session secret: at least 32 characters.
- Administrator password: at least 12 characters.
- Strong SOC API key.

The actual values remain only in `.env` and are not documented or committed.

### PostgreSQL authentication

The API initially failed because the password in `.env` did not match the existing `socagent` PostgreSQL role stored in the persistent volume. We aligned the database role password with the configured value, verified a TCP login with `SELECT 1`, and recreated the API container.

This distinction mattered because changing `POSTGRES_PASSWORD` does not retroactively change a role already initialized inside an existing PostgreSQL volume.

### Hermes installation and gateway

- Confirmed stale Hermes configuration and a `socat` proxy existed while the executable/service was missing.
- Installed Hermes Agent 0.18.2 for the unprivileged `trainee` user.
- Reused the existing strong Hermes API server key instead of regenerating it unnecessarily.
- Configured the Hermes API server on host port 8642.
- Kept the Docker bridge proxy on 8643 where required by the deployment topology.
- Installed/started the Hermes gateway as a user service and verified `/health` from both the local and bridge endpoints.
- Configured the BMB API with the matching backend-only Hermes URL, key, and `hermes-agent` model.

### Unsafe Hermes tools

Hermes initially advertised terminal, file, browser, code execution, memory, delegation, cron, and other host tools. The BMB dependency check correctly marked this profile unsafe.

We set:

```yaml
platform_toolsets:
  api_server: []
```

After restarting Hermes, BMB reported Hermes online and safe with zero active host tools. All SOC evidence access now goes through the BMB-owned tool boundary.

### Real Elastic Security connection

- Verified the Elasticsearch 9.4.2 cluster over TLS using its CA certificate.
- Created/configured a read-only API key with access to the required alert and log indices.
- Set `ALERT_SOURCE=elastic` and validated the API container's source configuration.
- Confirmed access to `.alerts-security.alerts-default` and collected real Elastic alert records into PostgreSQL.
- Verified that duplicate alerts were not stored twice.
- Queried stored alert IDs, timestamps, rule descriptions, severities, risk scores, users, hosts, IPs, and triage states.

### Dashboard visibility problem

The backend and nginx API returned alerts correctly, but the dashboard requested `limit=1000`, while Phase 1 correctly enforced a smaller API limit. Those requests returned HTTP 400, making data appear missing even though PostgreSQL and `/api/alerts` contained it.

We corrected the frontend request size, rebuilt the UI, and verified alerts in both development port 5173 and the deployed nginx interface on port 8080. We also clarified that:

- Port 5173 is the Vite development server.
- Port 8080 is the deployed Docker/nginx application.

### Chatbot validation

We tested progressively:

- Hermes health, model, capabilities, and safe tool profile.
- Simple bounded questions to avoid unnecessary tool budget errors.
- Identity-focused alert investigation.
- Evidence-grounded responses with explicit limitations.

Responses correctly separated observed evidence from inference, identified missing raw-log details, avoided claiming containment, and recommended analyst validation. Tool budget and unsupported-evidence errors were treated as safety controls, not bypassed.

---

## 11. End-to-end logic at Phase 4

### Alert collection flow

1. Scheduler or manual run starts a fetch cycle.
2. The configured source is selected: mock, Elastic, or Wazuh.
3. Source documents are normalized into the common alert model.
4. Stable source identifiers and database constraints prevent duplicates.
5. Alerts are stored in PostgreSQL.
6. Pending records are enriched through the internal enrichment service.
7. Successfully enriched alerts remain pending or enter Hermes triage when explicitly enabled.
8. Metrics and run status are stored in `fetch_runs`.
9. The frontend reads alerts/groups/stats through authenticated API routes.

### Analyst-chat flow

1. Authenticated browser sends a question and server-issued conversation ID.
2. API loads bounded actor-scoped conversation history.
3. API verifies Hermes capabilities, model, Runs API support, and zero host tools.
4. Hermes receives strict instructions and untrusted evidence context.
5. Hermes may request one allow-listed BMB tool.
6. API validates and executes the read-only tool, sanitizes its result, and stores evidence/audit records.
7. The loop continues within tool/time budgets.
8. Final output passes strict schema and exact citation validation.
9. Progress and result stream to the UI.
10. Conversation, sub-runs, tokens, evidence, and outcome remain durable.

### Automated-triage flow

1. Worker selects only `pending` and successfully `enriched` alerts.
2. Application computes material signature, enrichment fingerprint, and exact cache identity.
3. If an exact non-expired cache record exists, its durable run is reused.
4. Otherwise a durable Phase 4 triage run is created before Hermes is called.
5. Pipeline, agentic, or hybrid orchestration runs under strict budgets.
6. Every Hermes sub-run and BMB tool call is recorded.
7. Final verdict must pass schema, evidence, and input-alert citation validation.
8. Alert is marked triaged and linked to `triage_run_id`.
9. `auto_closed` is always written as false.
10. Failure marks the alert `triage_failed`; it never falls back to a legacy provider.

## 12. Data model evolution

| Migration | Purpose |
|---|---|
| `001_current_schema.sql` | Consolidated idempotent current schema, core alerts/incidents/settings/fetch metrics, and safe defaults |
| `002_hermes_agent_audit.sql` | Conversations, messages, agent runs, tool calls, evidence links, future action requests/approvals, and audit events |
| `003_grounded_hermes_analyst.sql` | Independently queryable Hermes sub-run steps for grounded investigations |
| `004_hermes_triage.sql` | Alert-to-triage-run linkage, exact cache provenance, legacy cache invalidation, and disabled unsafe automation settings |

The migration runner obtains a PostgreSQL advisory lock so multiple API instances cannot apply schema changes concurrently. Applied filenames/versions are recorded, making upgrades repeatable for both fresh and populated databases.

## 13. Security and trust model

### Trusted components

- The authenticated BMB API is the policy and orchestration authority.
- PostgreSQL is the durable source of application state, history, and audit records.
- Configuration secrets remain server-side.

### Untrusted inputs

- Browser requests until authenticated and validated.
- Alert descriptions, logs, enrichment text, and external source fields.
- Hermes tool requests and final output until schema/evidence validation succeeds.
- Any prompt-like text contained inside SOC evidence.

### Explicitly prohibited capabilities

- Model-authored SQL.
- Hermes shell, terminal, file, browser, arbitrary web/HTTP, memory, code execution, delegation, or cron tools.
- Direct credentials in prompts or browser responses.
- Automatic alert closure or containment.
- Unapproved write actions.
- Silent fallback to another AI provider.

## 14. Code areas changed across the phases

| Area | Responsibility after Phase 4 |
|---|---|
| `api/src/config.js` | Validated runtime settings and bounded Hermes time/call limits |
| `api/src/middleware/auth.js` and authentication routes | Sessions, CSRF, bearer authentication, identity, and access boundary |
| `api/src/db` and migrations | Connection pool, migration runner, schema, agent records, triage provenance |
| `api/src/services/hermes/client.js` | Shared capability-checked, retrying, cancellable Runs API client |
| `api/src/services/hermes/schemas.js` | Strict capabilities, chat, tool, run, and triage schemas |
| `api/src/services/hermes/store.js` | Durable agent/chat/triage/tool/evidence/audit persistence |
| `api/src/services/hermes/soc-tools.js` | BMB-owned bounded read-only SOC tool surface |
| `api/src/services/hermes/chat.js` | Grounded analyst orchestration |
| `api/src/services/hermes/triage.js` | Phase 4 automated triage orchestration and exact cache identity |
| `api/src/workers/pipeline.js` | Collection, enrichment, Hermes triage, metrics, and fail-closed lifecycle |
| `api/src/routes/index.js` | Validated authenticated API endpoints and disabled Phase 5/unsafe operations |
| `frontend/src` | Login/session UX, truthful health/errors, grounded chat progress/citations, Hermes triage settings, alert display fixes |
| `enrichment/src` | Internal AD/CMDB/EDR/TIP/vulnerability lookup service |
| `docker-compose*.yml` and `.env.example` | Service wiring, safe defaults, TLS mounts, Hermes settings, backend-only secrets |
| `api/test`, `frontend` tests, enrichment tests | Regression, security, schema, route, migration, orchestration, and UI verification |
| `docs/phase-*` | Audit evidence, acceptance gates, completion records, and live deployment boundaries |

## 15. What is real, what remains limited

### Real at Phase 4

- Authenticated API and UI access boundary.
- PostgreSQL-backed alert, incident, settings, run, evidence, and audit data.
- Mock, Elastic, and Wazuh source modes in code.
- Real Elastic alert collection tested on the server.
- Internal enrichment service.
- Hermes Runs API chatbot with bounded SOC tools.
- Hermes-only automated triage code.
- Strict evidence and output validation.
- Accurate AI usage/run metrics and durable provenance.

### Still intentionally limited

- Enrichment datasets are bundled demonstration data, not live enterprise AD/CMDB/EDR/TIP/vulnerability connectors.
- Phase 5 correlation is disabled and its legacy code is disconnected from the Phase 4 pipeline.
- Cases, investigations, assignments, notes, watchlists, and playbooks remain partly browser-local or incomplete.
- Response controls do not isolate hosts, disable users, block indicators, or create external tickets.
- No automatic closure is allowed.
- Full multi-user RBAC is not implemented; Phase 1 provides a single-admin boundary.
- The frontend still has a non-blocking bundle-size warning.
- Phase 4 triage remains disabled by default until the live acceptance checklist is completed.

## 16. Why the phases were separated

The order was a safety decision:

- We audited before changing behavior so we did not confuse visual completeness with operational completeness.
- We added identity, migrations, validation, tests, and metrics before giving AI more access.
- We built one Hermes reliability boundary before implementing tools.
- We made tools read-only and evidence-grounded before using them for automatic triage.
- We kept correlation and write actions out of scope until their own deterministic policies, schemas, provenance, and approvals can be implemented.

This reduced the chance that each new feature would create a new AI provider path, hidden state, unsafe tool surface, or unaudited decision.

## 17. Verification progression

| Phase | API tests | Enrichment tests | Frontend tests | Other gates |
|---|---:|---:|---:|---|
| Phase 0 | Static/syntax audit | Service smoke checks | Production build | Feature matrix and prioritized findings |
| Phase 1 | 20 | 2 | 5 | Lockfiles, lint, build, audits, YAML parsing, mock pipeline |
| Phase 2 | 35 | 2 | 7 | Hermes handshake/retry/cancel/schema/persistence tests and audits |
| Phase 3 | 50 | 2 | 9 | Tool authorization, grounding, streaming, redaction, injection, and audit tests |
| Phase 4 | 64 | 2 | 10 | Triage modes, cache provenance, enrichment gate, citation/session isolation, safety settings, build, audits |

Local checks do not replace live checks. Docker, PostgreSQL, Hermes, and Elastic acceptance must run on the Linux deployment server, and skipped external checks must remain documented rather than being reported as passed.

## 18. Current branch and milestone history

The main branch now contains the complete ancestry through Phase 4. Important milestone branches/commits include:

- `phase-1-foundation` - secured and stabilized foundation.
- `phase-2-hermes-foundation` - shared Hermes client and durable audit model.
- `phase-3-grounded-hermes-analyst` - bounded read-only SOC tools and grounded streaming analyst.
- `phase-4-hermes-triage` - Hermes-only automated triage, commit `f55b9de`.
- `main` currently points to the Phase 4 milestone.

## 19. Next work

### Before enabling Phase 4 triage broadly

1. Render Compose successfully on the Linux server.
2. Confirm migration 004 is recorded.
3. Confirm Hermes health reports safe, online, correct model, and zero host tools.
4. Keep triage disabled while collecting and enriching a controlled real Elastic batch.
5. Manually retriage one enriched real alert and reconcile every run/evidence/audit record.
6. Test pipeline, agentic, and hybrid modes on small controlled batches.
7. Stop Hermes and confirm fail-closed behavior.
8. Force enrichment failure and confirm Hermes/cache are not used.
9. Confirm attempts to enable auto-close and correlation are rejected.
10. Enable triage only after the live gate passes and monitor quality, failures, latency, and token use.

### Later phases

- **Phase 5:** migrate correlation to Hermes while retaining deterministic candidate and ID guards.
- **Phase 6+:** make investigations, cases, assignments, notes, watchlists, and playbooks durable; add approval-gated integrations; improve RBAC, notifications, connectors, bundle splitting, repository cleanup, and design completion.

## 20. Final outcome

From Phase 0 to Phase 4, the BMB SOC Agent evolved from a capable but loosely controlled prototype into a secured, testable, auditable, evidence-grounded SOC platform foundation.

The most important accomplishment is architectural: AI is no longer treated as a trusted operator. Hermes is a bounded reasoning service. The BMB application remains responsible for identity, permissions, evidence access, deterministic policies, validation, database writes, caching, audit, and any future approval process.

That separation is what allows later phases to add correlation and controlled workflows without sacrificing safety or traceability.
