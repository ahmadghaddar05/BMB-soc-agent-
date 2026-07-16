# Phase 7 Completion Report

## Outcome

Phase 7 changes the grounded Hermes chatbot from read-only analysis into a controlled workflow assistant. Hermes can request a small set of application-owned actions, but it cannot perform arbitrary writes or use host tools. The BMB API validates policy, permissions, targets, parameters, idempotency, approvals, execution, and audit records.

## Action policy

| Action | Behavior | Reason |
| --- | --- | --- |
| `investigation.create` | Executes directly | Creates a reversible internal workspace from validated alert IDs |
| `investigation.add_note` | Executes directly | Appends internal analyst documentation |
| `case.add_note` | Executes directly | Appends internal analyst documentation |
| `investigation.update` | Requires explicit approval | Can change ownership, title, or workflow state |
| `case.update` | Requires explicit approval | Can change ownership or workflow state |

Every other action type is denied. In particular, Phase 7 does not expose host isolation, account disablement, IP/domain blocking, firewall changes, email quarantine, ticket creation, or Elastic writeback.

## Technical implementation

- Added migration `007_controlled_actions.sql` to activate the dormant action-request and approval model with a policy version, approval flag, idempotency key, result, executor, timestamps, error code, and one-decision constraint.
- Added a transactional action service with strict allowlist and per-action parameter validation.
- Added idempotent AI requests so retrying one Hermes tool call cannot repeat a workflow mutation.
- Added row locking for decisions so two approval attempts cannot execute one request twice.
- Added authenticated APIs for policy discovery, action submission, listing/detail, and approval/denial.
- Added the bounded `request_soc_action` Hermes tool. It delegates to the action service and never receives SQL, filesystem, shell, browser, or arbitrary HTTP capability.
- Added durable `action_request` evidence citations to the Hermes run history.
- Added a frontend Approval Queue with exact target, reason, parameters, policy, decision history, execution result, and CSRF-protected approve/deny controls.
- Updated chat results to distinguish `pending` actions from actions actually `executed`.

## API surface

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/action-policy` | Return the active Phase 7 allowlist and approval requirements |
| `GET` | `/api/actions` | List controlled action requests with optional status filter |
| `GET` | `/api/actions/:id` | Read one request and its decision history |
| `POST` | `/api/actions` | Submit an allowlisted application action |
| `POST` | `/api/actions/:id/decision` | Approve-and-execute or deny one pending sensitive action |

All routes require the existing authenticated administrator boundary. Cookie-authenticated writes also require the session CSRF token.

## Failure behavior

- Unknown action type: denied before database access.
- Invalid or extra parameters: denied before execution.
- Missing target/evidence: rejected without a partial workflow record.
- Repeated AI request: returns the original request through its idempotency key.
- Concurrent or repeated decision: only the first pending decision can proceed.
- Target removed after request but before approval: request becomes `failed`; it is not reported as executed.
- Hermes host tools: remain disabled and rejected by dependency health checks.

## Deliberately deferred beyond Phase 7

- External containment and response connectors.
- Connector-specific authorization and dry-run/rollback behavior.
- EDR host isolation, identity disablement, network blocking, mail quarantine, or ticket-system writes.
- Expanded multi-role separation between action requester and approver.

Phase 8 builds autonomous internal orchestration on this boundary. External response connectors are deferred to Phase 9.
