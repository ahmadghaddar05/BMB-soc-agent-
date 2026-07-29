# Phase 4 — Durable Analyst Review

Phase 4 adds a clear human control point after AI triage and correlation. A SOC analyst can confirm a decision, challenge it, or state that more evidence is required.

## What changed

- Alert triage and incident correlation views show the latest human review.
- Analysts and administrators can record a review with a required written reason.
- Reviews are append-only: a new review is added instead of replacing an earlier one.
- Every review creates a server-side audit event in the same database transaction.
- Executive read-only incident views do not expose analyst review controls.

## Why this matters

The AI verdict remains visible as the original machine assessment. Human feedback is stored separately, so the platform can show:

1. what the AI concluded;
2. which stored evidence supported that conclusion;
3. whether a human agreed;
4. why the human agreed, disagreed, or requested more evidence; and
5. who recorded the review and when.

This prevents a browser-only flag from being mistaken for a durable workflow decision and makes later quality review possible.

## Review decisions

- **Confirm** — stored evidence supports the AI decision.
- **Challenge** — the AI decision appears incorrect or overstated.
- **Need evidence** — the available evidence is insufficient.

A reason of 10–1000 characters is mandatory.

## Safety boundary

Recording a review does not change or erase the AI verdict, close an alert or incident, execute a response action, or modify Elastic.

## Backend contract

`POST /api/workflow-reviews`

```json
{
  "entity_type": "alert",
  "entity_id": "elastic:example",
  "decision": "challenged",
  "reason": "The source host is an approved scanner and the scheduled change record matches."
}
```

Alert and incident journey responses now include `analyst_reviews`, newest first. Migration `018_analyst_decision_reviews.sql` creates the durable review store.
