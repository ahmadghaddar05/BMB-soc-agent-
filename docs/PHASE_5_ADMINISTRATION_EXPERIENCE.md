# Phase 5 — Security Administration Experience

## Purpose

Phase 5 separates platform administration from executive reporting and day-to-day SOC analysis. It gives a Security Administrator a focused workspace for connection status, collection health, AI policy, access posture, audit evidence, data lifecycle visibility, reports, and platform safeguards.

The same backend and stored evidence remain in use. This phase does not create a separate application or duplicate security data.

## Administrator information architecture

The administrator sidebar is now intentionally limited to:

- Integrations
- Collector Health
- AI Configuration
- Users & Access
- Audit & Governance
- Data Retention
- Reports
- Settings

SOC alert queues, investigations, cases, approvals, and response simulation are hidden from the administrator experience. Their APIs are reserved for the SOC Analyst role. Executive pages remain separate.

An authenticated Administrator can use the header **View as** selector to preview the Executive, SOC Analyst, or Administrator experience without restarting the API. The selection is stored only in that browser and changes presentation and landing-page routing, not the authenticated server role or its permissions. Non-administrator production sessions do not receive this selector.

## What each administration area does

### Integrations

Shows only real external connections: the configured security telemetry source, Hermes, and the enrichment service. A simulated source is clearly labelled and does not count as a connected production integration. Credentials and certificate contents are never returned to the browser.

### Collector Health

Combines collector state, scheduler state, stored pipeline counts, cursor position, the latest collection run, and recent cycle history. Administrators can run one internal collection cycle and edit the settings actually used by the current source:

- Elastic deployments use Elastic look-back, risk-score threshold, and Elastic result limit.
- Wazuh deployments use Wazuh look-back, rule level, and Wazuh result limit.

Polling pauses when the browser tab is hidden, and refreshed server data does not overwrite an unsaved form draft.

### AI Configuration

Separates masked Hermes runtime facts from three independent database-backed policies:

- Triage policy
- Correlation policy
- Analyst-guided workflow policy

Each policy validates and saves independently. The page states the operational boundary: AI-assisted workflows can create internal investigations, notes, and approval requests, but they do not directly isolate endpoints, disable identities, block addresses, or alter an external security platform.

### Users & Access

Reports the authentication mode, current effective role, session lifetime, secure-cookie state, configured-origin count, and whether a service API credential exists. It honestly describes the current single environment-managed account model. It does not present fake user creation, deletion, password, MFA, or role-assignment controls.

### Audit & Governance

Reads durable `audit_events` with bounded pagination and actor, event-type, and outcome filters. It exposes request and target references plus structured metadata for traceability. Configuration changes now enter this ledger as one audited change set.

### Data Retention

Shows record coverage and date ranges for alerts, audit events, collection runs, and triage-cache entries. It explicitly states that BMB-managed PostgreSQL alert/audit retention is not configured and that Elastic lifecycle management belongs to the external Elastic deployment. Cache reuse expiry is not described as data deletion.

### Settings

Settings is now a concise safeguards and ownership page. Collection and AI controls live in their dedicated workspaces. Passwords, API keys, TLS material, and retention jobs remain environment-managed and are not editable in the browser.

## Server-side authorization

Role-specific navigation is backed by a server-side read matrix:

- Executive: executive overview, incident review, source-status context, and summary reports.
- SOC Analyst: operational evidence and SOC workflow endpoints.
- Security Administrator: administration, configuration, scheduler history, audit, and governance endpoints.

Executives cannot retrieve raw alert queues, investigation/action/response records, settings, run history, or detailed technical PDFs. Analysts cannot retrieve administration settings, scheduler history, runtime configuration, audit, or governance data. Existing mutation routes continue to enforce explicit role checks and CSRF protection.

The context-aware assistant is available to all authenticated roles. Only SOC Analysts and Administrators may request controlled internal actions; Executive assistant sessions remain read-oriented.

## New backend contracts

- `GET /api/admin/runtime` — safe runtime configuration summary with credential presence only.
- `GET /api/admin/audit-events` — filtered, bounded durable audit feed.
- `GET /api/admin/data-governance` — stored-data coverage and honest lifecycle ownership.

Existing collection, settings, health, agent, reporting, authentication, CSRF, Elastic, Hermes, enrichment, action, and workflow contracts were preserved.

## Configuration integrity

`PUT /api/settings` now applies an allowed change set inside one database transaction. The transaction locks current values, writes every requested value, and records one `settings.updated` audit event containing the actor, request ID, changed keys, and before/after values. A database or audit failure rolls the entire change set back. Scheduler restart happens only after the database commit.

The setting allowlist now includes the bounded Elastic collector values consumed by the pipeline, preventing the administrator interface from saving unrelated Wazuh values on an Elastic deployment.

## Intentional limitations

- The current authentication model is one environment-managed interactive account, not a multi-user directory.
- Password rotation and role assignment are deployment operations.
- PostgreSQL alert and audit retention jobs are not implemented.
- Elastic index lifecycle is configured in Elastic, outside BMB.
- External response execution remains unavailable; response workflows are simulations and approval-controlled internal records.
- Historical audit coverage begins with operations that already emit audit events plus the new transactional settings audit. Earlier unaudited operations cannot be reconstructed.

These limitations are displayed in the interface rather than replaced with sample values or non-functional controls.

## Validation

- API test suite: 118 passed.
- Frontend test suite: 38 passed.
- Frontend ESLint: passed.
- Vite production build: passed.
- Git whitespace validation: passed.
