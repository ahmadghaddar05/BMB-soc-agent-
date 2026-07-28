# Phase 1 — Workflow Provenance Foundation

## Purpose

Phase 1 creates the trustworthy record needed to explain how an alert moved
through BMB. It does not add another dense dashboard or change the existing
triage and correlation policies.

The recorded journey is:

```text
Collected → Normalized → Enriched → Triaged → Correlated → Incident decision
```

## What is stored

`workflow_stage_events` is an append-only stage ledger. Each event records:

- the alert, incident, or fetch run it belongs to;
- the stage and its completed, failed, or skipped status;
- whether the executor was the system, AI, cache, or an analyst;
- the authenticated/system actor;
- links to the fetch run and Hermes agent run when applicable;
- the authoritative provider and model observed for AI work;
- triage, correlation, or incident confidence when it exists;
- bounded input/output summaries, reason, limitations, and safe errors;
- start, finish, and creation timestamps;
- a unique idempotency key to prevent duplicate records.

Existing `fetch_runs`, `agent_runs`, `agent_run_steps`,
`agent_evidence_links`, and `audit_events` remain authoritative. The new ledger
connects those records instead of duplicating their full content.

## Recording behavior

- Collection and normalization events are written only when a new alert is
  inserted.
- Enrichment success or failure is recorded with the alert update.
- Triage success or failure is recorded with the stored alert verdict.
- Cached triage is labelled `cache`; a new model decision is labelled `ai`.
- Correlation records which candidates were included, excluded, skipped by
  deterministic screening, or failed.
- Incident creation/update decisions link to the exact Hermes correlation run.
- Authenticated incident status changes are recorded as analyst decisions.

No missing stage is silently inferred.

## Read-only analyst contracts

```text
GET /api/alerts/:id/journey
GET /api/incidents/:id/journey
```

These endpoints return only recorded stage events in chronological order.
They are available to SOC analysts and administrators through the existing
role policy. Executives remain restricted to executive-safe aggregate and
incident-brief endpoints.

## What is intentionally deferred

Phase 1 does not yet add the final journey component to Technical Triage or
Incident Command. The compact visual presentation, detailed verdict
explanation, correlation score breakdown, and analyst correction controls
belong to later phases and will consume this foundation.
