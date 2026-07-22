# Phase 0 — Hermes Migration Map

## Required end state

The BMB application calls one AI boundary: Hermes. Groq, Anthropic, Ollama, and any future underlying model are configured behind Hermes, not in this application. Deterministic code remains responsible for permissions, candidate selection, validation, database writes, cache identity, action approval, and audit.

## Current-to-target call map

| Current function/path | Current provider | Target Hermes capability | Migration requirement |
|---|---|---|---|
| `POST /api/chat` → `chatHermes` | Hermes if key exists | Grounded analyst agent | Replace snapshot with bounded read-only tools and durable conversation/run records |
| `POST /api/chat` → `chatAgent` fallback | Groq/Anthropic/Ollama | None | Remove silent fallback; fail closed with explicit Hermes health error |
| `triageAlert` | Legacy LLM | Structured Hermes alert triage | Strict schema, evidence IDs, prompt version, timeout/retry, audit |
| `investigateAlert` | Legacy LLM tool loop | Hermes investigation agent | Port enrichment/SOC tools to Hermes contract; record every call/result |
| `triageHybrid` | Legacy LLM | Hermes bounded hybrid triage | Deterministic escalation policy plus Hermes triage/investigation calls |
| `correlateAlerts` | Legacy LLM | Structured Hermes correlation | Keep deterministic candidate filter and ID guard; persist Hermes run linkage |

## Existing tools that can be adapted

Read-only database tools already implemented in `services/dbtools.js`:

- Search alerts
- Get alert
- List critical alerts
- List incidents
- Get incident
- Pivot indicator
- Get stats

Enrichment tools already implemented in `services/tools.js`:

- Get AD user
- Check logon anomaly
- Get asset by hostname/IP
- Get EDR detections
- Check threat intelligence
- Get vulnerability risk

They are a useful starting point, but require JSON-schema validation, authorization context, pagination, result-size controls, sensitive-field filtering, timeouts, audit persistence, and standardized error codes before Hermes can use them.

## Hermes capability handshake required

Against the real Hermes deployment, verify and record:

1. OpenAI-compatible endpoint and authentication format.
2. Native `tools`/function-call request and response format.
3. Behavior for multiple tool calls in one turn.
4. JSON schema or structured-output support.
5. Streaming protocol and termination behavior.
6. Context and output token limits.
7. Usage metadata fields.
8. HTTP 429 and `Retry-After` behavior.
9. Timeout/cancellation behavior.
10. Model identifier/version reporting.

If Hermes lacks native tool calling, the API must run a bounded orchestration loop in which Hermes returns a validated command envelope. It must never accept raw SQL, URLs, filesystem paths, or unrestricted commands from model output.

## Target agent records

Add durable records for:

- `agent_conversations`
- `agent_messages`
- `agent_runs`
- `agent_tool_calls`
- `agent_evidence_links`
- `action_requests`
- `action_approvals`
- `audit_events`

Every run should record purpose, actor, Hermes model/version, prompt version, input evidence references, tool calls/results, output schema version, tokens, latency, status, error category, and any proposed/approved/executed action.

## Target read-only tool surface

- SOC summary and collection health
- Alert/group search and detail
- Incident search and detail
- Entity/observable pivot
- Asset and identity context
- Threat intelligence and vulnerability context
- Investigation/case detail
- Fetch and agent run detail

## Target controlled write surface

Hermes may propose these operations, but the API owns authorization and approval:

- Request retriage
- Create investigation/case
- Link evidence
- Add a note
- Assign an owner
- Add a watchlist entry
- Change incident disposition
- Start/advance a playbook
- Request an external containment action

No unrestricted SQL, shell, arbitrary HTTP, or direct integration credential access is permitted.

## Configuration removal map

Remove from application runtime after Hermes parity is proven:

- `LLM_PROVIDER`
- `GROQ_API_KEY`, `GROQ_MODEL`
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- `OLLAMA_BASE_URL`, `OLLAMA_MODEL`
- Legacy provider/model fields in Settings
- Direct provider resolution and HTTP calls in `services/llm.js`

Retain/add:

- Hermes base URL, credential secret, agent/model identifier, timeout
- Retry/backoff policy
- feature-specific prompt/schema versions
- per-purpose token/iteration budgets
- health/capability state

## Migration acceptance conditions

- Runtime code has no direct Groq, Anthropic, or Ollama request path.
- Missing/unhealthy Hermes never silently selects a legacy provider.
- Chat, triage, investigation, and correlation all use the shared Hermes client.
- All Hermes outputs pass strict schema and evidence-ID validation.
- Every Hermes run and tool call is durable and queryable.
- Write actions require explicit tool authorization and approval policy.
- Existing evaluation gates meet the agreed baseline before legacy deletion.
