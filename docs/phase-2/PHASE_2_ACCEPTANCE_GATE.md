# Phase 2 - Hermes Agent Foundation Acceptance Gate

## Scope

Phase 2 establishes one reliable, auditable Hermes boundary and moves the analyst chatbot fully onto it. It does not migrate automated triage/investigation or correlation; those remain the Phase 4 and Phase 5 scopes and stay disabled by default.

The implementation follows the official Hermes API server surface:

- [Hermes API server](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/api-server.md)
- [Hermes programmatic integration](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/programmatic-integration.md)
- [Hermes toolsets reference](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/toolsets-reference.md)

## Required contract

- `GET /v1/capabilities`, `GET /v1/models`, and `GET /v1/toolsets` must succeed and pass schema validation.
- The configured model must be advertised.
- Hermes must advertise run submission, run status, and run stop.
- The resolved `api_server` profile must be tool-less in Phase 2. The fixed SOC evidence snapshot does not require Hermes host tools.
- Chat uses `POST /v1/runs`, polls `GET /v1/runs/{id}`, and uses `POST /v1/runs/{id}/stop` for cancellation and timeout.
- Transient network, 408, 425, 429, and 5xx failures use bounded retries. POST retries require an idempotency key.
- Per-request and whole-run timeouts are bounded.
- Hermes response bodies are size bounded and parsed as JSON.
- The chatbot output must match the versioned JSON schema. Every citation must reference evidence supplied in that run.
- Missing, unhealthy, incompatible, or unsafe Hermes must never select Groq, Anthropic, Ollama, or another application-side provider.

## Durable records

Migration `002_hermes_agent_audit.sql` must create:

- `agent_conversations`
- `agent_messages`
- `agent_runs`
- `agent_tool_calls`
- `agent_evidence_links`
- `action_requests`
- `action_approvals`
- `audit_events`

Each chat run records actor, request ID, local and Hermes run IDs, provider/model, prompt and schema versions, input evidence references, snapshot tool trace, status, error category, attempts, latency, token usage, citations, and audit events. Proposed future write actions have separate request and approval records; Phase 2 does not execute them.

## UI contract

- The browser sends only the question and optional server-issued `conversation_id`; it does not supply trusted history.
- The server loads bounded conversation history from PostgreSQL and scopes the conversation to the authenticated actor.
- The browser persists the conversation ID for the tab, renders verified citations, supports a new conversation, and can cancel an active request.
- A disconnected or cancelled browser request propagates cancellation to the Hermes run.

## Configuration gate

Production Compose sets `HERMES_REQUIRED=true`. The API refuses to start without `HERMES_API_KEY`. The default official API port is 8642. Hermes credentials remain in the API container and never reach the browser.

`HERMES_ENFORCE_SAFE_TOOLSETS=true` is the default. Disabling it is an explicit operator override and is not an accepted production configuration.

## Automated verification gate

- API syntax check passes.
- API unit/route/migration tests pass.
- Enrichment syntax and tests pass.
- Frontend lint and tests pass.
- Frontend production build passes.
- Dependency audits report zero known vulnerabilities.
- Lockfile clean-install checks pass.

## Deployment verification gate

These checks require the Docker/Hermes server and cannot be replaced by local mocks:

1. Run all migrations against a fresh PostgreSQL 16 volume.
2. Run migration 002 over a backup/copy of the populated server database and verify record counts.
3. Confirm all three Hermes handshake endpoints from inside the API container.
4. Confirm `/api/health/dependencies` reports Hermes as configured, reachable, safe, and online.
5. Submit a real chat, verify the cited evidence IDs exist, and reconcile the UI response with `agent_runs`, `agent_messages`, `agent_tool_calls`, `agent_evidence_links`, and `audit_events`.
6. Cancel a real long-running chat and confirm Hermes reaches `cancelled` and the local run is recorded as cancelled.
7. Temporarily expose a forbidden Hermes tool in a test profile and confirm health/chat fail closed with `HERMES_UNSAFE_TOOL_PROFILE`.
8. Run an authenticated browser smoke test through nginx at port 8080.

Phase 2 application code is complete only when the automated gate passes. Production release additionally requires the deployment gate on the server that owns Docker and Hermes.
