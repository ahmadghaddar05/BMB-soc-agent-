# Phase 0 — Prioritized Issue Backlog

This backlog converts audit findings into implementation order. IDs correspond to `PHASE_0_AUDIT.md`.

## Phase 1 — Stabilize and secure the foundation

1. P0-001: introduce authentication or, at minimum, an enforced temporary API access boundary before shared deployment.
2. P0-002: relabel/disable fake response actions until approved server actions exist.
3. P0-004: scope retriage to the requested alert and return 404 for missing IDs.
4. P0-005: fix individual-alert search placeholders and add route tests.
5. P0-007: introduce versioned migrations that run for existing databases.
6. P0-008: persist accurate pipeline/AI metrics and repair prediction export.
7. P0-012: reconcile `.env.example`, Compose, README, ports, and active sources.
8. P0-013: implement request-scoped Wazuh TLS behavior.
9. P0-014: add service-specific health checks.
10. P0-016: generate lockfiles and add test/lint/build scripts.
11. P0-017/P0-019/P0-020: standardize errors, route validation, pagination, and filter semantics.
12. P0-018: replace sequential per-alert insert/enrichment loops with bounded batches or concurrency.
13. P0-023: make Elastic CA/TLS configuration portable and explicit.

## Phase 2 — Hermes-only client foundation

1. P0-003/P0-021: create the shared Hermes client and reliability contract.
2. Perform the Hermes capability handshake.
3. Add strict schemas, evidence validation, retries, cancellation, and usage accounting.
4. Add agent run/tool/audit persistence from P0-011.
5. Remove silent legacy fallback after parity gates pass.

## Phase 3 — Grounded Hermes analyst

1. Replace the fixed snapshot with safe read-only tools.
2. Persist conversations, messages, citations, and tool traces.
3. Add streaming/cancellation if supported.
4. Add prompt-injection defenses from P0-022.

## Phase 4 — Hermes triage

1. Migrate triage/investigation/hybrid call sites.
2. Fix cache identity and failed-enrichment handling from P0-010.
3. Keep automatic closure disabled until deterministic/calibrated policy replaces P0-009.

## Phase 5 — Hermes correlation

1. Migrate correlation call site while retaining deterministic candidates and ID guards.
2. Stabilize incident identity and narrative refresh conditions.
3. Link incident changes to Hermes run/evidence records.

## Phase 6 onward — Durable workflows and design completion

1. Move all P0-006 browser-local workflows to server entities/APIs.
2. Add approvals before any real response integration.
3. Replace hardcoded health/identity text from P0-015.
4. Split the frontend bundle from P0-024.
5. Remove duplicate/dead/backup source from P0-025.
6. Remove or implement unused settings from P0-026.
7. Standardize encoding from P0-027.
