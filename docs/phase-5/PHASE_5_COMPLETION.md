# Phase 5 Completion — Hermes Correlation

## Outcome

Phase 5 migrates incident correlation from the removed direct-provider service to the shared Hermes Runs API. The application—not Hermes—keeps candidate selection, permissions, evidence validation, incident writes, cursor safety, and audit ownership.

## Implemented

- Added a tool-less Hermes correlation orchestrator with one run-scoped session and strict JSON output.
- Rejects fabricated alert IDs, duplicate membership, disconnected entity/time groups, and groups that do not include newly triaged evidence.
- Derives severity and shared entities from stored alerts instead of trusting model-authored values.
- Preserves incremental candidate/context limits and advances the cursor only after successful model validation and persistence.
- Uses stable incident identity when membership grows, preserves analyst-closed/false-positive incidents, and avoids narrative churn for unchanged membership.
- Fails closed when a model group overlaps multiple open incidents or multiple groups target the same open incident.
- Persists the parent correlation run, Hermes sub-run, usage, input alert links, output incident links, and audit events.
- Added `incidents.correlation_run_id` through migration `005_hermes_correlation.sql`.
- Re-enabled manual and optional scheduled correlation while retaining a disabled-by-default rollout.
- Removed the direct Groq/Anthropic/Ollama service and its runtime environment/settings surface.
- Kept automatic closure and singleton promotion disabled.

## Safety boundary

Hermes receives a bounded set of normalized, untrusted alert evidence and cannot invoke application tools during correlation. It proposes groupings only. PostgreSQL writes happen in deterministic application code after every schema and grounding check passes.

## Verification

The automated gate covers strict schema enforcement, fabricated IDs, overlapping groups, disconnected evidence, run provenance, stable incident identity, unchanged narrative behavior, ambiguous incident overlap, cursor success/failure behavior, migration content, routes, and settings.

Production acceptance still requires applying migration 005, keeping correlation disabled, running one manual pass against the real Hermes/Elastic environment, inspecting the resulting run/evidence/incident records, and only then enabling scheduled correlation.
