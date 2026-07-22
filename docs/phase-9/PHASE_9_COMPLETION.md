# Phase 9 Completion Report

## Outcome

Phase 9 adds a safe response exercise layer to the internship SOC project. Hermes and the autonomous worker can propose three response simulations:

- endpoint isolation;
- identity suspension;
- IP blocking.

These names describe the intended incident-response decision, not an external action. Approval changes only the BMB PostgreSQL simulation ledger. The implementation has no EDR, Active Directory, firewall, Elastic writeback, email, or ticketing connector.

## Why this phase exists

Phase 8 could investigate, correlate, document, and request ownership, but there was no safe way to exercise the response decision lifecycle. Connecting a student project directly to endpoint or identity controls would create unnecessary risk. Phase 9 therefore validates the important control-plane behavior first: evidence, preview, approval, execution record, verification, audit history, and rollback.

## Technical implementation

Migration `009_simulated_response.sql` adds:

- a durable execution preview on each action request;
- `simulated_response_states` for active and reverted simulation state;
- `simulated_response_events` for executed, verified, and reverted events;
- `response.simulate` and `response.rollback` in the controlled-action allowlist;
- `request_simulated_response` as a durable autonomous operation;
- the opt-in `simulated_response_proposals_enabled=false` setting.

The action service enforces all of the following:

1. The target type must be endpoint isolation, identity suspension, or IP blocking.
2. Every supplied alert ID must exist.
3. The target must occur in at least one supplied alert as its host/agent, username, or source/destination IP.
4. Matching pending and active simulations are rejected.
5. Activation always requires approval.
6. Activation and verification are transactional and explicitly record `external_side_effects: false`.
7. Rollback is a separate controlled action and always requires another approval.
8. Real containment action names remain forbidden.

The autonomous worker can propose one simulation for a qualifying critical correlated case. It deterministically prefers a shared host, then identity, then IP, and submits the exact case alert IDs as evidence. The feature has a separate switch and defaults to off. The worker only creates the pending request; it cannot approve its own proposal.

The frontend adds:

- a Response Lab page for active/reverted simulations, exact evidence, verification, and events;
- an approval preview that shows intended effect, simulation connector, reversibility, and zero external effects;
- a rollback request flow that returns to the normal approval queue;
- a settings toggle for autonomous simulation proposals.

Hermes instructions and tool schemas state that simulations are BMB-only and must never be described as real containment.

## API surface

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/responses` | List active or reverted simulation states |
| `GET` | `/api/responses/:id` | Read evidence, verification, preview, and events |
| `POST` | `/api/responses/simulate` | Submit a pending evidence-bound simulation request |
| `POST` | `/api/responses/:id/rollback` | Submit a pending rollback request |

The existing `/api/actions`, `/api/actions/:id/decision`, `/api/action-policy`, `/api/agent/status`, and `/api/agent/run-now` endpoints remain the policy, approval, and orchestration boundary.

## Safety boundary

Phase 9 does **not**:

- isolate a real endpoint;
- disable or suspend a real account;
- change a firewall or block an IP;
- close or modify an Elastic alert;
- run Hermes host tools;
- let the AI approve its own action;
- add arbitrary HTTP, SQL, shell, browser, filesystem, or code-execution capability.

This is intentional for the current internship scope. It demonstrates a complete, auditable response workflow without pretending that an external system changed.

## Local verification

The implemented gate includes API syntax/lint, 99 API tests, frontend lint, 16 frontend tests, and production builds. Tests cover forbidden real containment, strict target validation, evidence binding, pending-before-approval behavior, activation, verification, rollback approval, autonomous proposals, settings, migration structure, API validation, UI state, and CSRF-protected rollback submission.

Live Docker/PostgreSQL/Hermes acceptance remains a server-side deployment check and is documented separately in `PHASE_9_ACCEPTANCE_GATE.md`.
