# Phase 8 Completion Report

## Outcome

Phase 8 turns the internal SOC pipeline into a proactive background agent. A scheduled cycle can collect Elastic alerts, enrich them, run strict Hermes triage, correlate related activity into cases, and then autonomously create internal investigations and grounded timeline notes. Critical-case ownership changes are proposals only and remain in the Phase 7 approval queue.

This phase does not add external response. The agent cannot isolate hosts, disable accounts, block indicators, quarantine email, close alerts, mark cases false positive, or write back to Elastic.

## Autonomous decision policy

Only stored, validated records qualify:

- Severity must be `high` or `critical`.
- Standalone alerts must have a strict Hermes verdict of `true_positive` or `needs_investigation`.
- Confidence must meet `autonomous_min_confidence` (default `0.70`).
- Evidence must be within `autonomous_lookback_hours` (default 24 hours).
- Work is bounded by `autonomous_max_items` (default 20) per source class and cycle.
- Alerts already represented by an open correlated case are not separately automated.

For a qualifying case, the agent creates/reuses one investigation, links its alerts, adds a grounded investigation note, and adds a grounded case note. For a qualifying standalone alert, it creates/reuses one investigation and adds a grounded triage note. For an unowned critical case, it may submit a `case.update` owner proposal, which requires human approval.

## Retry and failure safety

- Every autonomous action has a deterministic Phase 8 operation key.
- Every underlying Phase 7 action uses the same value as its idempotency key.
- A completed operation is never executed again.
- A failed operation records its error and attempt count and can be retried.
- A crash after action execution but before operation completion safely resolves the original action on retry.
- One failed candidate does not stop unrelated candidates; the autonomous run becomes `partial`.
- Notes state that no containment, closure, or false-positive decision was executed.
- All SQL is application-owned and parameterized; Hermes receives no host tools.

## Durable records

- `autonomous_runs`: one row per orchestration cycle with trigger, policy version, status, metrics, error, and timing.
- `autonomous_operations`: one idempotent row per investigation, note, or approval proposal with source, target, status, attempts, result, and error.
- `fetch_runs`: links the autonomous run and records created investigations, notes, approval requests, and failures.
- `action_requests`, workflow notes, investigation links, and audit events remain the authoritative mutation trail.

## API and UI

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/agent/status` | Read readiness, latest/recent runs, recent operations, totals, and pending approvals |
| `POST` | `/api/agent/run-now` | Run bounded orchestration against already stored evidence |
| `POST` | `/api/scheduler/run-now` | Run the complete collection-to-autonomous pipeline |

The dashboard shows agent enablement, pipeline readiness, latest metrics, failures, approval count, and recent operations. Settings provides an opt-in master switch and bounded confidence/look-back/work-item controls. The default remains disabled until server acceptance succeeds.

## Operational flow

```text
Elastic read-only collection
  -> PostgreSQL deduplication
  -> enrichment
  -> strict Hermes triage
  -> deterministic guards + Hermes correlation
  -> Phase 8 qualification policy
  -> idempotent investigation and notes
  -> approval queue for critical-case ownership
```

External response connectors are deferred to Phase 9.
