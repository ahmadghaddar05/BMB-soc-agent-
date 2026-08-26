# Phase 2 — Explainable AI Triage

Phase 2 makes the workflow provenance introduced in Phase 1 understandable to a SOC analyst. It does not change how Hermes decides a verdict and it does not add response authority.

## What analysts can now see

When an alert is selected in Technical Triage, the overview contains a compact **Why this assessment?** card. It shows:

- the recorded triage explanation;
- the verdict and confidence;
- whether the result came from a new AI run or the verified cache;
- the Hermes provider and actual model recorded for that run;
- how many evidence citations were recorded;
- whether the model supplied limitations.

The card explicitly warns that provenance explains how the decision was produced; it does not independently prove the verdict is correct.

The new **Workflow** tab shows the complete processing path:

1. Collected
2. Normalized
3. Enriched
4. Triaged
5. Correlation
6. Incident decision

Each recorded stage can be expanded to inspect its executor, actor, provider, model, confidence, timestamp, bounded input/output summary, limitations, and safe failure details.

## Trust behavior

- The UI reads `GET /api/alerts/:id/journey`.
- It displays append-only records from `workflow_stage_events`.
- A missing stage is shown as **Not recorded**.
- The UI never reconstructs or invents historical stages.
- Alerts created before Phase 1 may have no journey.
- Observed evidence and AI-derived conclusions remain visually distinct.
- Model confidence is presented as a model score, not as proof or probability of compromise.

## Progressive disclosure

The main alert table remains unchanged. Analysts first see a small explanation card in the detail overview and open the Workflow tab only when they need the full technical provenance. This preserves queue readability while making every new triage decision auditable.

## Scope boundary

Phase 2 is read-only. It does not:

- change Elastic data;
- execute containment;
- automatically approve or close alerts;
- change correlation logic;
- create new incidents;
- backfill unsupported historical claims.

Correlation reasoning and incident-creation explanations are handled in later phases.
