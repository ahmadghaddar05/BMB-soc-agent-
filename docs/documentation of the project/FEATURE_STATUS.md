# Feature Status

This is the manager-facing implementation status as of 2026-08-26. “Complete” means the repository contains the working UI and server behavior and the relevant automated checks pass; it does not imply that every optional external system is configured in the audit environment. Notes state when output depends on mock ingest, bundled enrichment data, an external Hermes deployment, or internal response simulation.

## Status Legend

| Status | Meaning |
|---|---|
| ✅ Complete | Complete and working as designed for the implemented scope. |
| 🟡 Partial | Implemented in part; the Notes column states exactly what is missing. |
| ❌ Not implemented | No working implementation exists. |
| ⚠️ Implemented but broken/buggy | Code exists but a known defect prevents or compromises intended use; see `KNOWN_ISSUES.md`. |

## Platform Foundation

| Feature | Status | Notes |
|---|---|---|
| <a id="feature-authentication"></a>Local authentication and sessions | ✅ Complete | PostgreSQL users, scrypt password hashes, signed HttpOnly/SameSite=Strict cookie, CSRF checks, session expiry, and logout are implemented. |
| <a id="feature-rbac"></a>Executive/analyst/administrator RBAC | ✅ Complete | Frontend route visibility and API route authorization are both implemented. Frontend guards are not treated as the security boundary. |
| <a id="feature-enterprise-identity"></a>SSO, MFA, SCIM, password reset | ❌ Not implemented | Only local username/password accounts are supported. |
| <a id="feature-api-persistence"></a>Express API and PostgreSQL persistence | ✅ Complete | Alerts, incidents, users, settings, workflow records, actions, responses, and audit events are durable. State does not generally reset on browser refresh. |
| <a id="feature-full-stack-compose"></a>Default Docker Compose startup | ⚠️ Implemented but broken/buggy | Compose definitions exist, but the automatically loaded override contains a malformed Elastic CA volume string; Docker was also unavailable on the audit host. See [KI-002](KNOWN_ISSUES.md#ki-002-compose-override-contains-a-malformed-volume-mapping). |
| <a id="feature-deployment-automation"></a>Hosted deployment/CI release pipeline | ❌ Not implemented | No CI workflow, target cloud environment, TLS termination, migration job, or rollback procedure is committed. |

## Ingestion and Enrichment

| Feature | Status | Notes |
|---|---|---|
| <a id="feature-collector-pipeline"></a>Scheduled alert collector pipeline | ✅ Complete | Scheduled/manual collection, normalization, enrichment, persistence, deduplication, run tracking, and status endpoints are implemented. The repository defaults to mock ingest. |
| <a id="feature-mock-ingest"></a>Deterministic mock alert source | ✅ Complete | Four stable mock records support development and automated tests; they must not be presented as live customer telemetry. |
| <a id="feature-elastic-connector"></a>Elastic connector | 🟡 Partial | Adapter, encrypted dashboard configuration, connectivity test, cursoring, and activation exist. No live Elastic environment was available for this audit. |
| <a id="feature-splunk-connector"></a>Splunk connector | 🟡 Partial | Adapter, encrypted dashboard configuration, test, cursoring, and activation exist. No live Splunk environment was available for this audit. |
| <a id="feature-wazuh-connector"></a>Wazuh connector | 🟡 Partial | Adapter and managed/environment configuration exist. No live Wazuh environment was available for this audit. |
| <a id="feature-enrichment"></a>AD, CMDB, EDR, TIP, and vulnerability enrichment | 🟡 Partial | The enrichment HTTP service works and its tests pass, but all datasets are bundled static JSON loaded into memory; no live enterprise-system connectors exist. |
| <a id="feature-realtime-push"></a>WebSocket/SSE alert delivery | ❌ Not implemented | Operational pages use periodic REST polling. Chat streaming is the only streamed HTTP path. |

## AI-Assisted Analysis

| Feature | Status | Notes |
|---|---|---|
| <a id="feature-ai-provider-integration"></a>Hermes model-provider integration | 🟡 Partial | Strict model routes, capability checks, health status, model tests, and activation are implemented. Hermes is external to this repository, no fallback model exists, credentials are not included, and fresh database policies default to disabled. |
| <a id="feature-alert-triage"></a>Per-alert AI triage and evidence | 🟡 Partial | Server-side triage, stored verdict/confidence/reasoning/evidence/citations, manual retriage, and human review exist. Actual model execution requires configured Hermes and an enabled policy; otherwise alerts remain pending/untriaged. |
| <a id="feature-correlation"></a>AI incident correlation | 🟡 Partial | Correlation worker, schemas, incidents, evidence, and reviews exist. It requires enabled settings and Hermes to produce new correlations. |
| <a id="feature-ai-chat"></a>Streaming SOC assistant | 🟡 Partial | NDJSON streaming, persisted conversations/sub-runs/tool traces/citations, and context prompting are implemented. Answers require a configured Hermes route. |
| <a id="feature-agent-operations"></a>Autonomous agent operations | 🟡 Partial | Status, operation records, policy controls, and manual/scheduled runs exist. Fresh settings disable autonomous operation; supported actions remain bounded to internal workflows. |
| <a id="feature-ai-triage-queue"></a>AI Triage queue | ⚠️ Implemented but broken/buggy | Listing, selection, and per-alert retriage work. “Run pending queue” requires administrator API access while the page permits analysts only; no authorized UI user can use it. See [KI-003](KNOWN_ISSUES.md#ki-003-ai-triage-batch-action-has-no-authorized-ui-user). |
| <a id="feature-human-review"></a>Human AI-decision review and quality metrics | ✅ Complete | Analyst confirm/correct records are persisted and quality aggregates are displayed. |

## Monitoring, Analytics, and Triage Pages

| Feature | Status | Notes |
|---|---|---|
| <a id="feature-live-monitoring-feed"></a>Live Monitoring feed | ✅ Complete | Grouped/individual feeds, filters, pause/buffer, selection, pagination, freshness, and 15-second polling are implemented. “Live” is polling; upstream is mock by default. |
| <a id="feature-monitoring-quick-actions"></a>Monitoring row quick actions | 🟡 Partial | Triage, replay, and investigation navigation work. Mute only hides a row in component memory and resets on refresh/reload. |
| <a id="feature-security-analytics"></a>Security Analytics charts | ✅ Complete | Recharts trend/severity/ranking views use database aggregates, poll every 60 seconds, and link selections to alert search. |
| <a id="feature-alert-workspace"></a>Alert list/detail workspace | ✅ Complete | Grouping, filtering, paging, stored view, pins, detail/journey loading, and retriage are implemented. Pins/view are intentionally browser-local. |
| <a id="feature-ai-confidence"></a>AI confidence gauge | ✅ Complete | Gauge renders the stored backend confidence value or pending state; no frontend randomization is used. |
| <a id="feature-response-readiness"></a>Alert response-readiness checklist | 🟡 Partial | Checklist UI is present but session-only and does not create actions, approvals, or responses. |

## Incident, Case, and Investigation Workflows

| Feature | Status | Notes |
|---|---|---|
| <a id="feature-incident-management"></a>Incident management | ✅ Complete | List/detail/journey, status, owner, evidence, correlation trace, review, and reporting are database/API backed. |
| <a id="feature-case-management"></a>Case management | ✅ Complete | Incident-backed cases persist owner, status, and notes and link to source incidents/reports. Cases are not an independent case entity. |
| <a id="feature-investigations"></a>Investigations | ✅ Complete | Create/edit/delete, alert search/references, owner/status, and durable notes are implemented. |
| <a id="feature-incident-containment"></a>Incident containment controls | 🟡 Partial | UI acknowledgements and approval-gated internal response simulation exist. External host isolation, account suspension, and IP blocking do not. |

## Digital Twin, Simulation, and MITRE

| Feature | Status | Notes |
|---|---|---|
| <a id="feature-digital-twin-topology"></a>Digital Twin topology | 🟡 Partial | Interactive pan/zoom topology and synchronized events render from the latest 100 alerts. There is no persistent topology, network discovery, CMDB graph, or event-driven external state feed. |
| <a id="feature-attack-simulator-training"></a>Attack Simulator training playback | ✅ Complete | Four code-defined scenarios, MITRE phase progression, timing controls, event log, and simulated response summary work locally. |
| <a id="feature-alert-replay"></a>Stored-alert replay | ✅ Complete | Eligible triaged alerts load from the API and replay stored detail/journey through reconstructed phases. It is a visualization, not a model rerun. |
| <a id="feature-attack-execution"></a>Attack execution against a lab/target | ❌ Not implemented | The simulator never emits attack traffic or invokes external tooling. |
| <a id="feature-mitre-incident-view"></a>MITRE Coverage incident view | ✅ Complete | Incident selector, tactic/technique path, timeline, evidence, and action proposals use live stored incident projections. |
| <a id="feature-mitre-coverage-heatmap"></a>MITRE Coverage aggregate heatmap | ✅ Complete | 7/30/90-day tactic and technique coverage aggregates are implemented over persisted alert evidence. |
| <a id="feature-mitre-action-sync"></a>MITRE containment/action synchronization | 🟡 Partial | Action proposals persist into Approvals and internal Responses. No external control state is synchronized back into the incident. |

## Intelligence, Assets, and Exposure

| Feature | Status | Notes |
|---|---|---|
| <a id="feature-threat-intelligence-pivot"></a>Threat-intelligence pivot | 🟡 Partial | Relationship graph and alert/incident pivot use stored data; watchlist is `localStorage`. No live TIP/TAXII/STIX lookup exists. |
| <a id="feature-asset-inventory"></a>Asset inventory | 🟡 Partial | Useful host/identity/IP profiles are derived from the latest 100 alerts. This is not a complete, authoritative, or editable inventory. |
| <a id="feature-vulnerability-workspace"></a>Vulnerability workspace | 🟡 Partial | Parses bundled enrichment findings and alert-derived exposure signals. No scanner connector, remediation status, SLA, exceptions, or full inventory exists. |

## Response and Operations

| Feature | Status | Notes |
|---|---|---|
| <a id="feature-playbooks"></a>Playbooks | 🟡 Partial | Four hardcoded checklists work and save progress in `localStorage`. No server persistence, execution engine, integration actions, or audit trail exists. |
| <a id="feature-approval-workflow"></a>Approval workflow | ✅ Complete | Analysts can review evidence and persist approve/reject decisions in the UI; the API accepts analyst or administrator roles. |
| <a id="feature-simulated-responses"></a>Internal response simulation | ✅ Complete | Approved isolate/suspend/block proposals create durable response records, verification events, and simulated rollback. UI labels describe the simulation boundary. |
| <a id="feature-external-response-execution"></a>Production response connectors | ❌ Not implemented | No EDR, IAM, firewall, SOAR, or ticketing write connector is present. |
| <a id="feature-reports"></a>PDF reports | ✅ Complete | Executive summary, alert, incident, and single-incident PDFs are generated from current database data with role checks. |

## Executive and Administrative Pages

| Feature | Status | Notes |
|---|---|---|
| <a id="feature-executive-dashboard"></a>Executive dashboard | ✅ Complete | Database-backed risk/incident aggregates, trend, decision queue, business-service exposure, AI-value estimates, data trust, and URL-backed drill-down are implemented. Business-service mapping is a code-defined taxonomy. |
| <a id="feature-integration-management"></a>Integration status and navigation | ✅ Complete | Dependency/source/runtime status is implemented. Actual connector CRUD is in Settings rather than this page. |
| <a id="feature-settings-and-connectors"></a>Settings and encrypted connector management | ✅ Complete | Runtime/settings display and Elastic/Splunk/Wazuh connector CRUD, test, activation, disable, and secret encryption are implemented. External systems were not available for live validation. |
| <a id="feature-collector-health"></a>Collector Health administration | ✅ Complete | Status polling, policy editing, last-run detail, and manual run are implemented. |
| <a id="feature-ai-configuration"></a>AI Configuration administration | ✅ Complete | Sanitized status, settings, model catalog/test/activation, and manual pipeline controls are implemented; successful execution still requires Hermes. |
| <a id="feature-user-administration"></a>User administration | ✅ Complete | Administrators can list, create, and delete database-backed local users. |
| <a id="feature-audit-log"></a>Audit log | ✅ Complete | Filtered, paginated database audit-event review is implemented. |
| <a id="feature-data-retention"></a>Data-retention preview and execution | ✅ Complete | Counts, preview, exact-confirmation deletion, audit logging, and scheduled-policy setting are implemented. No archive tier exists. |

## UX, Accessibility, and Quality

| Feature | Status | Notes |
|---|---|---|
| <a id="feature-dark-theme"></a>Dark product theme | ✅ Complete | Shared tokens and page styling are implemented. |
| <a id="feature-light-theme"></a>Light theme | ⚠️ Implemented but broken/buggy | Theme toggle and many overrides exist, but the later unscoped dark token block leaves newer/shared components on dark tokens. See [KI-004](KNOWN_ISSUES.md#ki-004-light-theme-does-not-override-the-product-token-layer). |
| <a id="feature-keyboard-accessibility"></a>Keyboard and modal accessibility | 🟡 Partial | Global focus styles and many semantic controls exist. Tabs lack arrow-key behavior, at least one modal lacks focus trapping/restoration, and an info control uses a non-native interactive span. |
| <a id="feature-reduced-motion"></a>Reduced-motion support | 🟡 Partial | Most product CSS animation families are disabled under `prefers-reduced-motion`; KPI count-up and selected legacy animations are not. |
| <a id="feature-responsive-layout"></a>Responsive layouts | 🟡 Partial | Media queries exist across major pages, but visual browser validation was unavailable during this audit. |
| <a id="feature-role-navigation"></a>Role navigation completeness | ⚠️ Implemented but broken/buggy | `/ai-triage` and `/playbooks` are valid analyst routes but absent from the sidebar; `Pivot.jsx` and `AgentPerformanceHub.jsx` are unrouted/unused. See [KI-005](KNOWN_ISSUES.md#ki-005-valid-pages-are-absent-from-role-navigation). |
| <a id="feature-frontend-quality"></a>Frontend lint, tests, and build | ✅ Complete | ESLint passed; isolated App tests passed `25/25`; full Vitest passed `83/83`; Vite production build passed. |
| <a id="feature-api-quality"></a>API automated tests | ✅ Complete | `200/200` tests passed. |
| <a id="feature-enrichment-quality"></a>Enrichment automated tests | ✅ Complete | `2/2` tests passed. |
| <a id="feature-visual-regression"></a>Automated visual/accessibility regression suite | ❌ Not implemented | No screenshot regression, axe, Lighthouse, or equivalent test configuration was found. |

## Recommended Next Steps

1. **Repair and validate the default deployment path.** Fix `docker-compose.override.yml`, start the complete Compose stack, apply migrations, run connector/enrichment/AI health checks, and capture the page screenshots identified in [PAGES.md](PAGES.md).
2. **Resolve the AI Triage authorization and navigation defects.** Align the batch endpoint with an authorized role, add intended analyst routes to navigation, and remove or route dead page components.
3. **Create one client-validation environment with real telemetry and Hermes.** Configure one supported alert source, real Hermes credentials/model route, and enabled triage/correlation policies; record evidence that ingest, enrichment, triage, correlation, and review complete end to end.
4. **Replace ambiguous simulations and samples with explicit product boundaries or integrations.** Prioritize production response connectors if containment is in client scope; otherwise keep all response language explicitly “simulated.” Replace static enrichment and 100-alert asset/vulnerability samples with authoritative feeds before treating those pages as inventories.
5. **Finish the UI contract.** Define complete dark/light token sets, fix the identified keyboard/focus/reduced-motion gaps, and add browser-based accessibility and visual-regression tests for the major analyst and admin flows.

---

Last updated: 2026-08-26 — generated by full codebase review, Graphify queries, API/enrichment/frontend tests, lint, production build, and local Vite server audit
