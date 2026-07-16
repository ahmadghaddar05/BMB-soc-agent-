# BMB SOC Agent

BMB SOC Agent is a containerized security-operations workspace for collecting alerts, enriching evidence, triaging activity, correlating incidents, and assisting analysts.

Phase 7 provides a grounded Hermes analyst, Hermes-only triage/correlation, durable investigations/cases, and controlled internal workflow actions. Hermes cannot access host tools or arbitrary writes. The BMB API can execute low-risk investigation/note actions directly while owner and status changes wait for explicit analyst approval. External containment remains unavailable. Triage and scheduled correlation remain disabled by default pending live acceptance. Automatic closure and singleton incident promotion remain hard-disabled.

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

## Hermes grounded analyst, triage, and correlation setup

Run Hermes on the Docker server, not on the analyst laptop. In the dedicated Hermes profile, set `API_SERVER_ENABLED=true`, `API_SERVER_HOST=0.0.0.0`, `API_SERVER_PORT=8642`, and a strong `API_SERVER_KEY`, then start `hermes gateway`. Keep port 8642 blocked from untrusted networks; only the local Docker host needs it. The SOC API calls `http://host.docker.internal:8642/v1` server-to-server, so browser CORS is not needed.

Use `hermes tools` to configure the `api_server` platform as an isolated, tool-less profile. BMB does not enable Hermes host tools, including read-only file or memory tools. Hermes requests structured application tool calls; the authenticated BMB API validates its parameterized evidence tools and the five controlled Phase 7 workflow actions. Verify the resolved host profile before starting BMB:

```bash
curl -s http://127.0.0.1:8642/v1/capabilities -H "Authorization: Bearer $API_SERVER_KEY"
curl -s http://127.0.0.1:8642/v1/models -H "Authorization: Bearer $API_SERVER_KEY"
curl -s http://127.0.0.1:8642/v1/toolsets -H "Authorization: Bearer $API_SERVER_KEY"
```

Set the BMB `HERMES_API_KEY` to that same secret. The API performs all three checks before each cached capability window, verifies the configured model, and rejects unsafe advertised tools. Chat, triage, and correlation use Hermes `/v1/runs`, poll status, and call `/stop` on cancellation or timeout. Chat and agentic triage use bounded structured loops around these BMB-owned tools:

- SOC summary and recent collection runs
- Alert search and alert detail, including untriaged collected alerts
- Incident search and incident detail
- Exact IP, username, and hostname pivots
- Identity and logon context
- Asset, EDR, threat-intelligence, and vulnerability context

Every argument passes a strict JSON schema. Queries are parameterized and result/time/iteration limits are enforced. Raw payloads, full logs, credentials, secrets, and tokens are withheld or redacted. Tool data is explicitly treated as untrusted to resist prompt injection. Final output and citations are schema-validated against evidence actually returned during the run. Conversations, every Hermes sub-run, tool traces, usage, evidence links, and audit events are durable. The Hermes key remains backend-only.

The UI uses `POST /api/chat/stream` for bounded progress events and final output. `POST /api/chat` remains available for trusted API clients that need a single JSON response. Browser cancellation propagates through the BMB tool loop to Hermes `/stop`.

`GET /api/health/dependencies` reports Hermes reachability, model/capabilities, host toolsets, safe-profile state, and the BMB application tool count. `HERMES_REQUIRED=true` makes the production container reject missing credentials at startup. There is no Groq, Anthropic, or Ollama fallback for chat, triage, or correlation.

Phase 4 supports strict `pipeline`, bounded `agentic`, and deterministic `hybrid` triage modes. Verdict cache entries bind the exact alert, material signature, successful enrichment evidence, prompt/schema versions, and Hermes model. Every verdict links to a durable Hermes run. Failed enrichment is never triaged.

Phase 5 correlation is incremental and tool-less. The application selects newly triaged alerts, adds only recent context with exact shared entities, and bounds the batch and token estimate. Hermes returns a strict incident schema. The API rejects unknown IDs, duplicate membership, groups without a newly triaged alert, and groups lacking a connected entity/time chain. Common entities and severity are recomputed from supplied evidence before persistence. Incident keys remain stable as membership grows, closed or false-positive incidents are never reopened, and unchanged membership does not rewrite the narrative. The correlation cursor advances only after the Hermes result and every incident/audit write succeed. `POST /api/scheduler/correlate-now` runs a manual pass; scheduled correlation is controlled independently by `correlation_enabled`.

Phase 7 adds `request_soc_action` as the only AI write boundary. Investigation creation and investigation/case notes execute inside the BMB database. Investigation/case owner or status updates create pending requests in `/approvals` and execute only after an authenticated, CSRF-protected decision. Requests are policy-versioned, idempotent, transactional, and audited. Host isolation, account disablement, IP blocking, email quarantine, Elastic writeback, and other external response actions are not implemented.

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

The API obtains a PostgreSQL advisory lock and applies versioned SQL files from `api/src/db/migrations` before starting workers. Applied versions are recorded in `schema_migrations`. Phase 2 added durable agent records, Phase 3 added independently queryable Hermes sub-runs, Phase 4 added exact triage cache provenance plus `alerts.triage_run_id`, Phase 5 added `incidents.correlation_run_id`, Phase 6 added durable investigations/cases, and Phase 7 activated policy-controlled action requests and approvals.

## Health and metrics

- `GET /api/health` reports API process health.
- `GET /api/health/dependencies` checks PostgreSQL, enrichment, Hermes, and the selected alert source and reports configured/reachable/degraded/disabled state.
- `fetch_runs` persists fetched, stored, duplicate, enrichment, triage, failure, AI call/token/cache, correlation, token-budget, and duration metrics.
- `SOC_API_KEY=... node eval/export_predictions.js` exports the stored call, token, and latency values instead of inferred placeholders.

## Local verification

Install from lockfiles and run every Phase 7 check:

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

The Approval Queue executes only the allowlisted internal Phase 7 workflow actions described above. Containment recommendations, playbooks, watchlists, and external-response controls remain review state and do not execute firewall, EDR, identity, email, Elastic, or ticketing actions. Real external response requires Phase 8 connector authorization, approval gates, and audited integrations.

See `docs/phase-0/PHASE_0_AUDIT.md`, `docs/phase-2/PHASE_2_ACCEPTANCE_GATE.md`, and `docs/phase-3/PHASE_3_ACCEPTANCE_GATE.md` for the audited baseline and delivery gates.

For a consolidated technical and non-technical explanation of the complete journey from Phase 0 through Phase 4, see `docs/PHASE_0_TO_4_PROJECT_HISTORY.md`.
