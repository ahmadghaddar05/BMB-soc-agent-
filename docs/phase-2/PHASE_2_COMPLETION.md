# Phase 2 - Completion Record

Date: 2026-07-15

Branch: `phase-2-hermes-foundation`

## Completed application scope

- Added a shared Hermes client using the official API server handshake and Runs API.
- Added capability, model, and resolved tool-profile validation with a cached handshake.
- Enforced a tool-less Hermes `api_server` profile for the fixed-evidence Phase 2 chatbot.
- Added bounded per-request/whole-run timeouts, transient retries, Retry-After handling, idempotency keys, response-size limits, cancellation, and Hermes `/stop` propagation.
- Added strict Hermes protocol and chatbot output schemas.
- Added evidence-ID validation that rejects hallucinated citations.
- Removed the chatbot's legacy Groq/Anthropic/Ollama fallback. Missing or unhealthy Hermes fails closed with explicit error codes.
- Added durable conversations, messages, runs, tool calls, evidence links, future action requests/approvals, and actor-attributed audit events.
- Added prompt/schema version, provider/model, request/run IDs, attempts, latency, status/errors, and token usage accounting.
- Moved conversation history authority to PostgreSQL and scoped it to the authenticated actor.
- Added UI conversation continuity, verified citation rendering, new-conversation control, and cancellation.
- Expanded Hermes dependency health to report configured, reachable, safe, model, capabilities, toolsets, and explicit degraded state.
- Aligned the official Hermes port 8642, production startup requirements, Compose, `.env.example`, and server setup documentation.

## Verified automated gates

- API lockfile dry run: pass.
- API syntax/lint: pass.
- API tests: 35 passed, 0 failed.
- API dependency audit: 0 known vulnerabilities.
- Enrichment lockfile dry run: pass.
- Enrichment syntax check: pass.
- Enrichment tests: 2 passed, 0 failed.
- Enrichment dependency audit: 0 known vulnerabilities.
- Frontend lockfile dry run: pass.
- Frontend ESLint: pass.
- Frontend tests: 7 passed, 0 failed.
- Frontend production build: pass (the previously documented large-chunk optimization warning remains non-blocking).
- Frontend dependency audit: 0 known vulnerabilities.
- Git whitespace/error check: pass.

Focused Hermes tests cover safe handshake caching, missing capability rejection, forbidden and read-only host-tool rejection, transient retry/idempotency behavior, run polling, usage normalization, cancellation/stop, invalid structured output, hallucinated citations, durable orchestration, actor-scoped conversations, no-fallback routing, UI conversation continuity, citation rendering, and UI cancellation.

## Honest deployment boundary

Docker, PostgreSQL, and Hermes are installed on the server rather than this laptop. Therefore no claim is made that a live server deployment was exercised here. Before production release, run the deployment gate in `PHASE_2_ACCEPTANCE_GATE.md` on that server: fresh/upgrade migration checks, live handshake and safe-profile checks from the API container, real chat/audit reconciliation, real cancellation, unsafe-profile rejection, and authenticated browser smoke testing.

This boundary is external environment validation, not unfinished Phase 2 application code.

## Later-phase boundary

Phase 2 does not migrate automated triage/investigation or correlation. Those runtime paths retain the explicitly labeled legacy implementation until their Phase 4 and Phase 5 migrations and remain disabled by default. Phase 3 replaces the fixed chatbot evidence snapshot with application-owned bounded read-only SOC tools; it must not re-enable Hermes host tools.
