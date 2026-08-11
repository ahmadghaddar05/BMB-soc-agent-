# BMB SOC Agent

BMB SOC Agent is a containerized security-operations workspace for collecting alerts, enriching evidence, triaging activity, correlating incidents, and assisting analysts.

Phase 9 adds an approval-gated simulated response lab on top of the proactive Phase 8 SOC agent. The agent may propose an evidence-bound endpoint isolation, identity suspension, or IP block simulation for a critical correlated case. Approval activates only a durable BMB simulation record, verification confirms only that internal state, and a second approval can roll it back. No EDR, identity, firewall, Elastic, email, or ticketing system is modified. Triage, scheduled correlation, autonomous orchestration, and automatic response proposals remain disabled by default pending live acceptance.

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
3. Replace `POSTGRES_PASSWORD`, the three initial account passwords (`SOC_EXECUTIVE_PASSWORD`, `SOC_ANALYST_PASSWORD`, and `SOC_ADMIN_PASSWORD`), and `SOC_SESSION_SECRET` with strong random values. These initial accounts are imported into the database only when the managed user directory is empty. Every initial account must use a unique username and a password of at least 12 characters. The session secret must contain at least 32 characters.
4. Set `HERMES_API_KEY` to the same secret as Hermes `API_SERVER_KEY` and prepare the isolated Hermes profile described below.
5. Start the stack:

```bash
docker compose up --build -d
```

Open `http://localhost:8080/login`. Every account uses this one login page:

- Executive: `SOC_EXECUTIVE_USERNAME` and `SOC_EXECUTIVE_PASSWORD`
- SOC Analyst: `SOC_ANALYST_USERNAME` and `SOC_ANALYST_PASSWORD`
- Security Administrator: `SOC_ADMIN_USERNAME` and `SOC_ADMIN_PASSWORD`

The server reads the account role from PostgreSQL and automatically opens the correct workspace. Users cannot select or override their role from the browser. After the first start, a security administrator can create and remove accounts under **Users & Access**. Environment credentials are not re-imported while the directory contains users and may be removed after a successful bootstrap. An empty directory requires at least the administrator bootstrap account.

The API is bound to `http://127.0.0.1:3000`; the database is bound to `127.0.0.1:5432`. The enrichment service is internal to the Compose network. `GET /api/health` is public; operational and write endpoints require a signed session or the optional bearer API key.

## Alert-source modes

The recommended production workflow is **Security Administrator → Settings → Security source connectors**. An administrator selects Elastic, Splunk, or Wazuh, enters the endpoint and least-privilege credential, saves it, runs a bounded read-only test, and explicitly activates it. Credentials and optional CA certificates are AES-256-GCM encrypted by the API and are never returned to the browser. Switching the active connector takes effect on the next collection pass and does not delete previously stored evidence.

Set `CONNECTOR_ENCRYPTION_KEY` once on the API server to a stable random 32-byte value. Keep it in the deployment secret store; changing or losing it makes saved connector credentials unreadable. Environment source variables remain supported as a bootstrap and disaster-recovery fallback when no dashboard-managed connector is active.

```bash
openssl rand -base64 32
```

### Mock

Set `ALERT_SOURCE=mock` and `WAZUH_MODE=mock`. Collection uses deterministic sample alerts, no external alert platform is contacted, and AI triage remains disabled by the fresh-database settings. This is the recommended local validation mode.

### Elastic Security

Choose Elastic in the connector wizard and provide its host, port, read-only API key, alert alias, raw-event indices, and TLS trust. Each managed Elastic connector has an independent durable cursor. Automatic writeback remains disabled.

For the environment fallback, set `ALERT_SOURCE=elastic`, `ELASTICSEARCH_URL`, and `ELASTIC_API_KEY`.

For verified TLS, set `ELASTIC_VERIFY_TLS=true`, `ELASTIC_CA_HOST_PATH` to the certificate on the Docker host, and keep `ELASTIC_CA_CERT` as its container path. Start with the certificate override:

```bash
docker compose -f docker-compose.yml -f docker-compose.elastic.yml up --build -d
```

For a controlled development environment only, `ELASTIC_VERIFY_TLS=false` skips certificate verification and does not require the override file.

### Splunk

Choose Splunk in the connector wizard and provide its management host, port `8089`, read-only token, index, base search, and TLS trust. Port `8089` is Splunk's management REST API; HEC port `8088` is not used because BMB reads events rather than sending them. The token's role needs permission to search the configured index and access its own authentication context. The connector uses `/services/search/jobs/export`, sends time bounds as export parameters, and normalizes Splunk fields into BMB's canonical alert schema.

In the environment fallback, use `SPLUNK_AUTH_SCHEME=Bearer` for Splunk JWT authentication tokens. `Splunk` is also supported for a Splunk session key/token when required by the deployment. `SPLUNK_COLLECTION_MODE=index` runs the bounded `SPLUNK_SEARCH`. `SPLUNK_COLLECTION_MODE=triggered_alerts` reads fired-alert metadata and follows each alert SID to the triggering search-job results; set `SPLUNK_NAMESPACE_OWNER` and `SPLUNK_NAMESPACE_APP` to the saved-search namespace (`-` and `search` are the common defaults). The index/base search remain available for raw-event pivots and fallback collection.

Those environment variables are fallback configuration only; the wizard stores the corresponding values securely without requiring an image rebuild.

For verified TLS, set `SPLUNK_VERIFY_TLS=true`, `SPLUNK_CA_HOST_PATH` to the CA certificate on the Docker host, and `SPLUNK_CA_CERT=/run/secrets/splunk_ca.pem`, then include the Splunk Compose override:

```bash
docker compose -f docker-compose.yml -f docker-compose.splunk.yml up --build -d
```

Set `SPLUNK_VERIFY_TLS=false` only for a short connectivity test in an isolated lab. This mode is reported as degraded security configuration and does not use `docker-compose.splunk.yml`.

### Wazuh

Choose Wazuh in the connector wizard and provide the indexer endpoint, least-privilege username/password, index pattern, and TLS trust. For the environment fallback, set `ALERT_SOURCE=wazuh`, `WAZUH_MODE=real`, `WAZUH_INDEXER_URL`, `WAZUH_INDEXER_USER`, and `WAZUH_INDEXER_PASS`.

## Hermes grounded analyst, triage, and correlation setup

Run Hermes on the Docker server, not on the analyst laptop. In the dedicated Hermes profile, set `API_SERVER_ENABLED=true`, `API_SERVER_HOST=0.0.0.0`, `API_SERVER_PORT=8642`, and a strong `API_SERVER_KEY`, then start `hermes gateway`. Keep port 8642 blocked from untrusted networks; only the local Docker host needs it. The SOC API calls `http://host.docker.internal:8642/v1` server-to-server, so browser CORS is not needed.

Use `hermes tools` to configure the `api_server` platform as an isolated, tool-less profile. BMB does not enable Hermes host tools, including read-only file or memory tools. Hermes requests structured application tool calls; the authenticated BMB API validates its parameterized evidence tools and the Phase 9 controlled-action allowlist. Verify the resolved host profile before starting BMB:

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

### Switching between GPT-5.6 Sol and Meta Llama 3.3 70B

BMB keeps Hermes as the only AI gateway. The administrator can open **AI Configuration → AI model routing**, inspect both approved routes, make a small connectivity test, and activate one for new chat, triage, and correlation runs. In-progress runs are not interrupted. A failed selected route is reported and audited; BMB never silently falls back to the other model.

The GPT-5.6 Sol profile uses the existing authenticated default route in Hermes. To enable the Llama profile, the only new secret to add is the OpenRouter key on the server running Hermes:

```bash
printf '\nOPENROUTER_API_KEY=%s\n' 'PASTE_YOUR_OPENROUTER_KEY_HERE' >> /home/trainee/.hermes/.env
```

Restart the Hermes gateway using the same service or process manager that starts it, then use **Test selected route** before activation. Do not put `OPENROUTER_API_KEY` in the BMB repository, BMB `.env`, Docker Compose, PostgreSQL, or the browser. The approved Llama route is `openrouter` / `meta-llama/llama-3.3-70b-instruct`. Only the profile identifier is stored in BMB settings, and triage cache identity includes the selected provider and model.

Phase 4 supports strict `pipeline`, bounded `agentic`, and deterministic `hybrid` triage modes. Verdict cache entries bind the exact alert, material signature, successful enrichment evidence, prompt/schema versions, and selected provider/model route. Every verdict links to a durable Hermes run. Failed enrichment is never triaged.

Phase 5 correlation is incremental and tool-less. The application selects newly triaged alerts, adds only recent context with exact shared entities, and bounds the batch and token estimate. Hermes returns a strict incident schema. The API rejects unknown IDs, duplicate membership, groups without a newly triaged alert, and groups lacking a connected entity/time chain. Common entities and severity are recomputed from supplied evidence before persistence. Incident keys remain stable as membership grows, closed or false-positive incidents are never reopened, and unchanged membership does not rewrite the narrative. The correlation cursor advances only after the Hermes result and every incident/audit write succeed. `POST /api/scheduler/correlate-now` runs a manual pass; scheduled correlation is controlled independently by `correlation_enabled`.

Phase 7 adds `request_soc_action` as the only AI write boundary. Investigation creation and investigation/case notes execute inside the BMB database. Investigation/case owner or status updates create pending requests in `/approvals` and execute only after an authenticated, CSRF-protected decision. Requests are policy-versioned, idempotent, transactional, and audited. Host isolation, account disablement, IP blocking, email quarantine, Elastic writeback, and other external response actions are not implemented.

Phase 8 adds an opt-in orchestration worker after triage and correlation. It qualifies only high/critical stored evidence with approved verdicts and a configurable minimum confidence, then reuses Phase 7 actions with deterministic idempotency keys. Autonomous runs and each operation are durable and visible on the dashboard. A failed candidate is recorded without corrupting other work, and replays cannot duplicate completed investigations or notes. `GET /api/agent/status` exposes readiness and history; `POST /api/agent/run-now` processes stored evidence; the normal scheduler runs the complete collection-to-agent flow.

Phase 9 adds `response.simulate` and `response.rollback` to that same controlled-action boundary. Both actions always remain pending until an authenticated, CSRF-protected approval. Simulation targets must be present in the supplied stored alerts, duplicates are rejected, activation and verification are transactional, and rollback requires a separate approval. `/responses` shows the durable simulation state and event history. `simulated_response_proposals_enabled` is a separate opt-in setting; enabling it lets the autonomous worker propose one bounded simulation for a qualifying critical case but never bypasses approval.

## Authentication and security

- Browser login creates an HMAC-signed, HttpOnly, SameSite=Strict cookie.
- Accounts and fixed roles are stored in the PostgreSQL `app_users` directory. Passwords are hashed with scrypt and never returned to the browser.
- Executive, SOC analyst, and administrator accounts all use one login endpoint. The server assigns the role from the authenticated database record and the browser cannot request or switch roles.
- Every session is revalidated against the current user record. Removing an account invalidates its existing browser sessions immediately.
- Only administrators can list, create, or remove users. Administrators cannot remove their own account or the last active administrator.
- The local HTTP quick start uses `SOC_COOKIE_SECURE=false`; set it to `true` whenever the browser origin is HTTPS.
- Cookie-authenticated writes require the session CSRF token.
- `SOC_API_KEY` optionally enables trusted automation with `Authorization: Bearer ...`.
- `SOC_ALLOWED_ORIGINS` is empty for same-origin deployments; provide a comma-separated allowlist only for intentional cross-origin browser clients.
- `SOC_AUTH_DISABLED=true` is rejected in production.
- Security headers, request IDs, JSON size limits, and login/chat rate limits are enabled.

This is a small database-managed RBAC directory, not an LDAP/SSO identity provider. It provides server-enforced role separation for the internship platform. The three environment accounts are a one-time bootstrap path for a new directory; routine user provisioning is performed from **Users & Access**.

## Database lifecycle

The API obtains a PostgreSQL advisory lock and applies versioned SQL files from `api/src/db/migrations` before starting workers. Applied versions are recorded in `schema_migrations`. Phase 2 added durable agent records, Phase 3 added independently queryable Hermes sub-runs, Phase 4 added exact triage cache provenance plus `alerts.triage_run_id`, Phase 5 added `incidents.correlation_run_id`, Phase 6 added durable investigations/cases, Phase 7 activated policy-controlled action requests and approvals, Phase 8 added durable autonomous runs and retry-safe operations, Phase 9 added reversible simulated response state and events, migration 012 added the database-managed RBAC user directory, and migration 013 added the administrator-selected AI model profile.

## Health and metrics

- `GET /api/health` reports API process health.
- `GET /api/health/dependencies` checks PostgreSQL, enrichment, Hermes, and the selected alert source and reports configured/reachable/degraded/disabled state.
- `fetch_runs` persists fetched, stored, duplicate, enrichment, triage, failure, AI call/token/cache, correlation, autonomous investigation/note/approval, token-budget, and duration metrics.
- `SOC_API_KEY=... node eval/export_predictions.js` exports the stored call, token, and latency values instead of inferred placeholders.

## Local verification

Install from lockfiles and run every Phase 9 check:

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

The Approval Queue executes only the allowlisted internal workflow and simulated-response actions described above. The Response Lab is deliberately not a real response connector: it cannot execute firewall, EDR, identity, email, Elastic, or ticketing actions. Any future real connector requires separate authorization, secrets, least-privilege integration design, live verification, and an explicit project phase.

See `docs/phase-0/PHASE_0_AUDIT.md`, `docs/phase-2/PHASE_2_ACCEPTANCE_GATE.md`, and `docs/phase-3/PHASE_3_ACCEPTANCE_GATE.md` for the audited baseline and delivery gates.

For a consolidated technical and non-technical explanation of the complete journey from Phase 0 through Phase 4, see `docs/PHASE_0_TO_4_PROJECT_HISTORY.md`.
