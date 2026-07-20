# Phase 4 — SOC Analyst Experience

## Outcome

Phase 4 turns the analyst side of BMB Security Operations into a clearer evidence workspace while preserving the existing Elastic, PostgreSQL, Hermes, investigation, case, approval, and response-simulation contracts.

The main principle is explicit data provenance:

- **Observed evidence** comes from stored Elastic alerts and enrichment records.
- **AI assessment** is model-derived and displays confidence, citations, and limitations when supplied.
- **Internal workflow changes** update BMB records such as ownership, notes, and status.
- **Response actions** remain simulations and never claim to modify endpoints, identities, firewalls, or Elastic records.

## What changed

### Monitoring

- Keeps individual alerts in newest-first order instead of grouping the live stream.
- Preserves pause/resume behavior and reports buffered updates.
- Continues showing alerts if collector-health lookup fails separately.
- Stops background polling while the browser tab is hidden and refreshes when visible again.
- Distinguishes alert failure from an empty alert result.

### Technical triage

- Uses readable activity names while retaining full technical identifiers in disclosures.
- Makes rows keyboard-selectable.
- Persists the analyst's saved local view and restores supported filters safely.
- Resets pagination when filters change.
- Separates source severity from AI confidence.
- Separates observed findings from model-derived findings.
- Displays AI citations and limitations only when actually returned.
- Labels enrichment no-match and unavailable states honestly.

The current backend has no durable per-alert assignment, review-state, SLA, or separate priority fields. Phase 4 does not fake these values. A later backend contract is required before those controls can become durable multi-user workflow features.

### Investigations

- Presents the workflow as search, select, document, assign, and hand off.
- Clears selected evidence whenever a new search runs, preventing hidden evidence from an earlier query from being submitted.
- Clears stale detail while switching investigations and ignores late responses.
- Requires at least one recorded finding before closing an investigation.
- Confirms permanent deletion and clarifies that source alerts are not deleted.
- Shows API failures separately from valid empty states.

### Incident Command

- Adds a compact command summary: what happened, potential impact, containment state, remaining exposure, owner/age, and required decision.
- Uses server-backed ownership instead of browser-local ownership.
- Labels the displayed score as a client-derived risk indicator rather than a stored enterprise risk score.
- Stops inventing ATT&CK stages for alerts that have no stored mapping.
- Clearly marks containment recommendations as planning-only.
- Gives executives a read-only incident evidence view with analyst mutation controls removed.

### Cases

- Uses readable `CASE-######` references instead of exposing raw Elastic IDs in the primary workflow.
- Shows owner, status, age, last update, next action, evidence count, and note count.
- Shows unsupported fields such as priority, SLA, and due date as not stored or not configured.
- Clears stale case detail during rapid selection changes.
- Requires a case note before closure or false-positive classification.

In the current data model, a case is the durable workflow view of an incident record plus case notes. Phase 4 states this linkage instead of pretending there is an independent case entity.

### Human Review Queue

- Clarifies what approval changes inside BMB and which records are simulation-only.
- Replaces ambiguous “executed” labels with contextual language such as “applied internally” or “simulation activated.”
- Requires an analyst reason and exposes load/decision failures.
- Does not show API failure as an empty approval queue.

### Safe Response Simulation

- Uses simulation language for states, verification, rollback, and history.
- Handles unknown response types safely.
- Repeats the permanent boundary that no external system is modified.
- Separates failed loading from an empty simulation list.

### Security context

- Assets and AI triage use normalized activity names and disclose when counts come from bounded samples.
- Entity Intelligence no longer calls a no-match result “clean.” It says that no match was returned and that this does not prove safety.
- Its relationship-density indicator is explicitly a count-based visualization, not a threat-confidence score.
- Vulnerabilities distinguishes structured CVE findings from alert-derived exposure signals.
- Vulnerability configuration guidance no longer routes analysts into administrator-only Settings.

## Authorization boundary

Frontend role hiding is not treated as security. The API now enforces roles for mutations:

- Administrator only: settings and scheduler/agent execution controls.
- SOC analyst or administrator: retriage, incident changes, investigations, case updates/notes, approvals, and response simulations.
- Executive: read-only evidence and reporting access.

API-key automation retains administrator authority. Existing authentication and CSRF validation remain in front of these role checks.

## Existing contracts preserved

- Elastic collection and cursor behavior
- Alert and grouped-activity reads
- Hermes triage and correlation contracts
- PostgreSQL incident, investigation, case-note, approval, response, and audit records
- Existing report generation URLs
- Existing CSRF and session authentication flow

The only backend change in this phase is additive authorization middleware on existing mutation routes; request and response payloads are unchanged.

## Deferred backend work

These features require durable schema/API support and were intentionally not fabricated:

- Per-alert priority separate from severity
- Per-alert analyst assignment and review state
- SLA clocks and due dates
- Shared server-side saved views and column preferences
- Durable business-service mapping
- Independent case identity/lifecycle separate from incidents
- Global approval/response aggregate counts across filtered pages

## Validation

- API tests: **112 passed**
- Frontend tests: **38 passed**
- Frontend lint: **passed**
- Frontend production build: **passed**
- Diff whitespace validation: **passed**

