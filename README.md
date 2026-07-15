# BMB SOC Agent

BMB SOC Agent is a containerized security-operations workspace for collecting alerts, enriching evidence, triaging activity, correlating incidents, and assisting analysts.

Phase 2 establishes the shared Hermes agent boundary. The chatbot is Hermes-only and fails closed when Hermes is missing, incompatible, or unsafe. Automated triage and correlation remain disabled by default and retain explicitly labeled legacy code until their Hermes migrations in Phases 4 and 5; the whole pipeline is not yet Hermes-only.

## Services

- PostgreSQL 16 stores alerts, incidents, settings, migrations, and pipeline metrics.
- The Node API runs collection, enrichment orchestration, triage/correlation workers, authentication, and REST endpoints.
- The Node enrichment service supplies the bundled AD, CMDB, EDR, threat-intelligence, and vulnerability datasets.
- The React/Vite frontend is served by nginx and proxies `/api` to the API service.

## Requirements

- Docker Compose for the container workflow.
- Node.js 20.19–24 and npm 10+ for local development.
- A Hermes server exposing its authenticated API server on port `8642`.

## Safe mock quick start

1. Copy `.env.example` to `.env`.
2. Keep `ALERT_SOURCE=mock` and `WAZUH_MODE=mock`.
3. Replace `POSTGRES_PASSWORD`, `SOC_ADMIN_PASSWORD`, and `SOC_SESSION_SECRET` with strong random values. The session secret must contain at least 32 characters.
4. Set `HERMES_API_KEY` to the same secret as Hermes `API_SERVER_KEY` and prepare the isolated Hermes profile described below.
5. Start the stack:

```bash
docker compose up --build -d
```

Open `http://localhost:8080` and sign in with `SOC_ADMIN_USERNAME` and `SOC_ADMIN_PASSWORD`.

The API is bound to `http://127.0.0.1:3000`; the database is bound to `127.0.0.1:5432`. The enrichment service is internal to the Compose network. `GET /api/health` is public; operational and write endpoints require a signed session or the optional bearer API key.

## Alert-source modes

### Mock

Set `ALERT_SOURCE=mock` and `WAZUH_MODE=mock`. Collection uses deterministic sample alerts, no external alert platform is contacted, and AI triage remains disabled by the fresh-database settings. This is the recommended local validation mode.

### Elastic Security

Set `ALERT_SOURCE=elastic`, `ELASTICSEARCH_URL`, and `ELASTIC_API_KEY`. Elastic access is read-only and automatic writeback remains disabled.

For verified TLS, set `ELASTIC_VERIFY_TLS=true`, `ELASTIC_CA_HOST_PATH` to the certificate on the Docker host, and keep `ELASTIC_CA_CERT` as its container path. Start with the certificate override:

```bash
docker compose -f docker-compose.yml -f docker-compose.elastic.yml up --build -d
```

For a controlled development environment only, `ELASTIC_VERIFY_TLS=false` skips certificate verification and does not require the override file.

### Wazuh

Set `ALERT_SOURCE=wazuh`. For deterministic mock data keep `WAZUH_MODE=mock`. For a real indexer set `WAZUH_MODE=real`, `WAZUH_INDEXER_URL`, `WAZUH_INDEXER_USER`, and `WAZUH_INDEXER_PASS`. Set `WAZUH_VERIFY_TLS=true` when the indexer certificate is trusted.

## Hermes Phase 2 setup

Run Hermes on the Docker server, not on the analyst laptop. In the dedicated Hermes profile, set `API_SERVER_ENABLED=true`, `API_SERVER_HOST=0.0.0.0`, `API_SERVER_PORT=8642`, and a strong `API_SERVER_KEY`, then start `hermes gateway`. Keep port 8642 blocked from untrusted networks; only the local Docker host needs it. The SOC API calls `http://host.docker.internal:8642/v1` server-to-server, so browser CORS is not needed.

Use `hermes tools` to configure the `api_server` platform as an isolated, tool-less profile. Phase 2 supplies a fixed SOC evidence snapshot through the API and therefore permits no Hermes host tools, including read-only file or memory tools. Verify the resolved profile before starting BMB:

```bash
curl -s http://127.0.0.1:8642/v1/capabilities -H "Authorization: Bearer $API_SERVER_KEY"
curl -s http://127.0.0.1:8642/v1/models -H "Authorization: Bearer $API_SERVER_KEY"
curl -s http://127.0.0.1:8642/v1/toolsets -H "Authorization: Bearer $API_SERVER_KEY"
```

Set the BMB `HERMES_API_KEY` to that same secret. The API performs all three checks before each cached capability window, verifies the configured model, and rejects unsafe advertised tools. Chat uses Hermes `/v1/runs`, polls status, calls `/stop` on cancellation/timeout, validates a strict JSON response and every evidence citation, and stores conversations, messages, runs, tool traces, usage, evidence links, and audit events. The key remains backend-only.

`GET /api/health/dependencies` reports Hermes reachability, model/capabilities, toolsets, and safe-profile state. `HERMES_REQUIRED=true` makes the production container reject missing credentials at startup. There is no Groq, Anthropic, or Ollama fallback for chat.

The legacy provider variables remain only for triage/investigation and correlation until their Phase 4 and Phase 5 migrations. Fresh databases keep AI triage disabled and automatic closure blocked.

## Authentication and security

- Browser login creates an HMAC-signed, HttpOnly, SameSite=Strict cookie.
- The local HTTP quick start uses `SOC_COOKIE_SECURE=false`; set it to `true` whenever the browser origin is HTTPS.
- Cookie-authenticated writes require the session CSRF token.
- `SOC_API_KEY` optionally enables trusted automation with `Authorization: Bearer ...`.
- `SOC_ALLOWED_ORIGINS` is empty for same-origin deployments; provide a comma-separated allowlist only for intentional cross-origin browser clients.
- `SOC_AUTH_DISABLED=true` is rejected in production.
- Security headers, request IDs, JSON size limits, and login/chat rate limits are enabled.

This is a Phase 1 access boundary with one administrator identity, not full multi-user RBAC.

## Database lifecycle

The API obtains a PostgreSQL advisory lock and applies versioned SQL files from `api/src/db/migrations` before starting workers. Applied versions are recorded in `schema_migrations`. Phase 2 adds durable agent conversation, message, run, tool-call, evidence-link, action-request/approval, and audit-event tables.

## Health and metrics

- `GET /api/health` reports API process health.
- `GET /api/health/dependencies` checks PostgreSQL, enrichment, Hermes, and the selected alert source and reports configured/reachable/degraded/disabled state.
- `fetch_runs` persists fetched, stored, duplicate, enrichment, triage, failure, AI call/token/cache, correlation, token-budget, and duration metrics.
- `SOC_API_KEY=... node eval/export_predictions.js` exports the stored call, token, and latency values instead of inferred placeholders.

## Local verification

Install from lockfiles and run every Phase 2 check:

```bash
cd api
npm ci
npm run check
npm test

cd ../enrichment
npm ci
npm run check
npm test

cd ../frontend
npm ci
npm test
npm run build
```

The frontend build may report a chunk-size optimization warning; bundle splitting is tracked for the design-completion phase and does not affect build correctness.

## Important UI behavior

Containment recommendations, alert escalation markers, playbooks, assignments, watchlists, cases, and investigations that are browser-local are labeled as local review state. They do not execute firewall, EDR, identity, email, or ticketing actions. Real response actions require a later server workflow, authorization checks, approval gates, and audited integrations.

See `docs/phase-0/PHASE_0_AUDIT.md`, `docs/phase-0/PHASE_1_ACCEPTANCE_GATE.md`, and `docs/phase-2/PHASE_2_ACCEPTANCE_GATE.md` for the audited baseline and delivery gates.
