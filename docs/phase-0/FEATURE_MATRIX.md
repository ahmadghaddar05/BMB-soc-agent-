# Phase 0 — Feature Completion Matrix

Status definitions:

- **Real:** backed by a working server implementation, subject to unavailable external runtime verification.
- **Partial:** contains real functionality but important behavior is derived, incomplete, misleading, or local-only.
- **Local-only:** stored in React state or browser storage; not a shared SOC workflow.
- **Static:** hardcoded presentation with no domain backend.

## Frontend

| Area | Status | Real behavior | Missing or misleading behavior |
|---|---|---|---|
| Application shell | Partial | Real routing and global navigation | Hardcoded analyst identity and agent-online state; no auth |
| Dashboard | Partial | Loads stats, collector status, alert groups, and alerts | Risk score is client-derived; some failures become empty data; status text can overclaim health |
| Alerts | Partial | Grouped/individual lists, detail, filters, pagination, retriage | Individual search SQL defect; pins, escalation, saved view local-only; response checklist session-only |
| AI Triage | Partial | Reads queue/stats and invokes triage/retriage endpoints | Uses legacy LLM; selected retriage is not reliably scoped; no run trace/progress/audit |
| Incidents | Partial | List/detail/status update and PDF report | Owner local-only; containment buttons session-only; default actions can look executable |
| Threat Intelligence | Partial | Real alert/incident pivot plus static TIP enrichment | Default sample IOC; watchlist/block local-only; “connected” hardcoded; no external provider health |
| Assets | Partial | Derives host/user/IP inventory from up to 100 alerts | No asset API, CMDB inventory, pagination, ownership, or durable asset state |
| Vulnerabilities | Partial | Extracts enrichment findings or alert-derived signals from up to 100 alerts | No vulnerability inventory API, remediation state, connector, or complete dataset pagination |
| Investigations | Local-only | Searches alerts and selects evidence | Investigation objects live in local storage; search is affected by `/alerts` bug; no notes/timeline/agent run |
| Reports | Real/partial | Server-generated alert/incident PDFs | No auth, report history, background generation, or access audit |
| Cases | Local-only/partial | Reuses incident list and report link | No case entity; owner and notes local-only; hardcoded owner options |
| Playbooks | Static/local-only | Three hardcoded procedures and browser-local progress | No backend definitions/runs, approvals, integrations, evidence, or action results |
| Integrations | Partial | Loads API/settings/collector/scheduler summaries | Named connection tests do not contact named services; Hermes is not represented accurately |
| Settings | Partial | Reads/writes allow-listed scheduler and legacy AI settings; manual triggers | No Hermes settings/status; stale Wazuh labels; several runtime settings absent; no auth or validation schema |
| Chat widget | Partial | Calls `/api/chat`; renders answers and reported tool label | No persistence, streaming, citations UI, cancellation, dynamic tools, or Hermes health |
| Notifications | Static navigation | Buttons link to alerts/incidents | No notification source, persistence, unread state, or delivery workflow |

## Backend capabilities

| Capability | Status | Notes |
|---|---|---|
| PostgreSQL access | Real | Pool and parameterized queries; runtime not executable in audit environment |
| Elastic collection | Real/partial | Cursor and normalization code exists; live connection unverified; rigid CA mount |
| Wazuh collection | Partial | Real and mock fetch paths; TLS verify flag does not configure TLS |
| Alert grouping | Real | Elastic group key and grouped query exist |
| Deduplication | Real | Alert ID/Elastic UUID constraints and conflict handling |
| Enrichment | Real demo | Working static JSON service; not live AD/CMDB/EDR/TIP/vuln connectors |
| Legacy triage | Real/unsafe for target | Groq/Anthropic/Ollama path; model controls verdict/confidence |
| Hermes triage | Missing | No Hermes call from pipeline |
| Legacy agentic investigation | Real/partial | Tool loop over static enrichment; no durable run record |
| Hermes tool agent | Missing | Chat uses a fixed snapshot only |
| Legacy correlation | Real/partial | Deterministic candidate filter plus LLM grouping; legacy provider only |
| Hermes correlation | Missing | No Hermes call from correlation worker |
| Incident lifecycle | Partial | Open/closed/false-positive status; no assignment/notes/history |
| Case management | Missing | No schema or API |
| Investigation management | Missing | No schema or API |
| Playbook orchestration | Missing | No schema, API, approvals, or integrations |
| Reports | Real | PDFKit endpoints exist |
| Authentication/RBAC | Missing | No identity or permission layer |
| Audit trail | Missing | Fetch runs are operational counters, not actor/agent audit |
| AI observability | Missing/partial | In-memory counters discarded at run completion |
| Evaluation | Partial | Metrics work; live ground truth and accurate efficiency export do not |

## Browser-local state that must move server-side

| Browser key/state | Intended server entity |
|---|---|
| `bmb-pinned-alerts` | Analyst/user alert preferences or shared queue |
| `bmb-escalated-alerts` | Alert escalation/disposition event |
| `bmb-alert-view` | Saved analyst view |
| `bmb-incident-owners` | Incident assignment |
| Incident containment completion state | Response action / playbook step result |
| `bmb-investigations` | Investigation and evidence links |
| `bmb-case-owners` / `bmb-case-notes` | Case, assignment, and note records |
| `bmb-playbook-runs` | Playbook run and step records |
| `bmb-threat-watchlist` | Watchlist entry |
| `bmb-blocked-observables` | Approved response action and integration result |
