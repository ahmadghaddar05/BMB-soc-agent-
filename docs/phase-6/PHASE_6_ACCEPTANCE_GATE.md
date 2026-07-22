# Phase 6 Acceptance Gate

## Scope

Phase 6 replaces browser-local investigation and case workflow state with authenticated, server-owned records. It does not add automated containment, external response integrations, playbook execution, watchlists, or approval execution.

## Required outcomes

- Investigations persist in PostgreSQL with title, search context, status, owner, evidence links, creator, and timestamps.
- Investigation evidence links reference real stored alerts and reject unknown alert IDs.
- Investigation and case notes are append-only server records with author and timestamp.
- Correlated incidents expose a durable case owner and case timeline.
- The Investigations and Cases pages read and write only the protected workflow APIs for in-scope state.
- Every workflow mutation records the authenticated actor in `audit_events`.
- The grounded AI analyst can read bounded investigation and case context through application-owned tools.
- All non-GET browser requests retain CSRF protection.
- Deleting an investigation removes its notes and links but never deletes source alerts.
- Existing alert collection, Hermes triage, grounded chat, and Hermes correlation behavior remains unchanged.

## Safety boundary

Phase 6 manages analyst records only. The application still cannot block an IP, disable an identity, isolate a host, close an Elastic alert, or invoke an external response tool. Those actions require a later approval-gated integration phase.

## Verification gate

- API syntax and frontend lint pass.
- API tests, including workflow validation/audit tests, pass.
- Frontend tests, including protected investigation creation and case ownership persistence, pass.
- The frontend production build succeeds.
- The Phase 6 database migration is versioned and covered by migration tests.
