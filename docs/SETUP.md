# Local Setup, Build, and Deployment

## Prerequisites

| Tool/service | Required version | Required for |
|---|---|---|
| Git | Any current version | Clone and version-control operations. Audit host used `2.48.1`. |
| Node.js | `>=20.19 <25` | All three services; the frontend has the strictest lower bound. Container builds use Node 20 Alpine. Audit host used `24.12.0`. |
| npm | Lockfile-compatible npm | Dependency installation and scripts. Audit host used `11.6.2`; no npm version is pinned. |
| Docker Engine + Compose plugin | No version pinned | Recommended full-stack run and the only committed deployment process. |
| PostgreSQL | 16 for parity | Required by the API. Compose uses `postgres:16-alpine`. |
| Hermes API | Deployment-specific | Required only when `HERMES_REQUIRED=true` or AI triage/correlation/chat/agent workflows are enabled. Hermes is not included in this repository. |
| OpenSSL or Node `crypto` | Current version | Optional generation of connector/session/password secrets. |

The root directory has no `package.json`; run npm commands inside `frontend`, `api`, or `enrichment`.

## Clone and Install

### Clone

```powershell
git clone https://github.com/ahmadghaddar05/BMB-soc-agent-.git BMB-soc-agent--main
Set-Location BMB-soc-agent--main
```

### Install all service dependencies

```powershell
Set-Location api
npm ci

Set-Location ..\enrichment
npm ci

Set-Location ..\frontend
npm ci

Set-Location ..
```

`npm ci` uses each committed `package-lock.json` and replaces that service’s existing `node_modules` directory.

## Configure the Environment

Create the ignored local environment file:

```powershell
Copy-Item .env.example .env
notepad .env
```

Do not commit `.env`, credentials, private keys, or CA material. For a local telemetry-only run, keep `ALERT_SOURCE=mock`, keep `WAZUH_MODE=mock`, and set `HERMES_REQUIRED=false`. For AI workflows, leave `HERMES_REQUIRED=true` and provide a Hermes key that matches `API_SERVER_KEY` on the Hermes host.

Generate suitable values with Node when required:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
```

The first command produces a 32-byte Base64 session/connector key; run it separately for each secret. The second produces a bootstrap password longer than the 12-character minimum.

## Environment Variables

### Core database and authentication

| Variable | Purpose | Example value | Required? |
|---|---|---|---|
| `POSTGRES_DB` | Compose database name. | `socagent` | Yes for Compose; default exists. |
| `POSTGRES_USER` | Compose database owner/user. | `socagent` | Yes for Compose; default exists. |
| `POSTGRES_PASSWORD` | PostgreSQL password and API connection-string value. | A generated 24+ character value | Yes; replace the committed fallback. |
| `DATABASE_URL` | Direct API PostgreSQL connection string. Compose constructs it. | `postgres://socagent:secret@127.0.0.1:5432/socagent` | Yes for manual API runs. |
| `SOC_EXECUTIVE_USERNAME` | Initial executive username imported only when `app_users` is empty. | `executive` | Conditional; recommended on first start. |
| `SOC_EXECUTIVE_PASSWORD` | Initial executive password. | Generated 12+ character value | Conditional on bootstrapping the executive role. |
| `SOC_ANALYST_USERNAME` | Initial analyst username. | `analyst` | Conditional; recommended on first start. |
| `SOC_ANALYST_PASSWORD` | Initial analyst password. | Generated 12+ character value | Conditional on bootstrapping the analyst role. |
| `SOC_ADMIN_USERNAME` | Initial administrator username. | `admin` | Conditional; recommended on first start. |
| `SOC_ADMIN_PASSWORD` | Initial administrator password. | Generated 12+ character value | Conditional on bootstrapping the administrator role. |
| `SOC_SESSION_SECRET` | HMAC secret for signed session cookies. | Independent generated 32-byte Base64 value | Yes when authentication is enabled; minimum 32 characters. |
| `SOC_SESSION_TTL_MINUTES` | Session lifetime, clamped to 15–1440 minutes. | `480` | No; default `480`. |
| `SOC_COOKIE_SECURE` | Adds the Secure attribute to the session cookie. | `false` locally; `true` behind HTTPS | No; must be `true` for an HTTPS deployment. |
| `SOC_API_KEY` | Optional bearer credential for trusted automation. | Generated 24+ character value | No. |
| `CONNECTOR_ENCRYPTION_KEY` | AES key for dashboard-managed connector credentials; accepts 64 hex chars or Base64 decoding to 32 bytes. | Generated 32-byte Base64 value | Required only for managed connector CRUD. |
| `SOC_ALLOWED_ORIGINS` | Comma-separated CORS origins for cross-origin browsers. | `https://soc.example.internal` | No for same-origin frontend/API. |
| `SOC_AUTH_DISABLED` | Development-only authentication bypass read by the API. Compose fixes it to `false`. | `false` | No; cannot be `true` in production. |
| `NODE_ENV` | Runtime mode. Compose sets `production`. | `development` | No for manual run. |
| `PORT` | API or enrichment listen port, depending on process. | `3000` or `3001` | No; each service has a default/Compose value. |
| `ENRICHMENT_URL` | API-to-enrichment service base URL. | `http://127.0.0.1:3001` | Required for enrichment-backed tools; Compose sets it. |

Bootstrap passwords are imported only when the user table is empty. Changing them later does not update existing accounts; use **Users & Access** for normal account administration.

### Alert source selection

| Variable | Purpose | Example value | Required? |
|---|---|---|---|
| `ALERT_SOURCE` | Environment fallback source: `mock`, `elastic`, `splunk`, or `wazuh`. An active managed connector takes precedence. | `mock` | No; default `mock`. |

### Elastic

| Variable | Purpose | Example value | Required? |
|---|---|---|---|
| `ELASTICSEARCH_URL` | Elastic base URL. | `https://elastictrainee:9200` | Yes when `ALERT_SOURCE=elastic`. |
| `ELASTIC_API_KEY` | Read-only Elastic API key. | Redacted credential | Yes when `ALERT_SOURCE=elastic`. |
| `ELASTIC_ALERT_ALIAS` | Security alert index/alias. | `.alerts-security.alerts-default` | No; has default. |
| `ELASTIC_EVENT_INDICES` | Comma/wildcard raw event scope for grounded evidence tools. | `logs-*` | No; default `logs-*`. |
| `ELASTIC_VERIFY_TLS` | Enables TLS certificate verification. | `true` | No; default `true`. |
| `ELASTIC_CA_HOST_PATH` | Host path mounted by `docker-compose.elastic.yml`. | `C:\certs\http_ca.crt` | Required for a private CA with the Elastic overlay. |
| `ELASTIC_CA_CERT` | CA path inside the API container/process. | `/run/secrets/http_ca.crt` | Required when Elastic TLS verification is enabled by API startup validation. |

Use the explicit certificate overlay:

```powershell
docker compose -f docker-compose.yml -f docker-compose.elastic.yml up --build -d
```

### Splunk

| Variable | Purpose | Example value | Required? |
|---|---|---|---|
| `SPLUNK_URL` | Splunk management API URL. | `https://splunk.example.internal:8089` | Yes when `ALERT_SOURCE=splunk`. |
| `SPLUNK_TOKEN` | Read-only bearer/Splunk token. | Redacted credential | Yes when `ALERT_SOURCE=splunk`. |
| `SPLUNK_INDEX` | Alert/result index. | `alerts` | No; default `alerts`. |
| `SPLUNK_SEARCH` | Search used in index collection mode. | `search index=alerts` | Conditional; blank uses adapter behavior. |
| `SPLUNK_COLLECTION_MODE` | `index` or `triggered_alerts`. | `index` | No; default `index`. |
| `SPLUNK_NAMESPACE_OWNER` | Saved-search namespace owner. | `-` | No; default `-`. |
| `SPLUNK_NAMESPACE_APP` | Saved-search namespace app. | `search` | No; default `search`. |
| `SPLUNK_AUTH_SCHEME` | `Bearer` or `Splunk`. | `Bearer` | No; default `Bearer`. |
| `SPLUNK_VERIFY_TLS` | Enables TLS certificate verification. | `true` | No; default `true`. |
| `SPLUNK_CA_HOST_PATH` | Host CA path mounted by `docker-compose.splunk.yml`. | `C:\certs\splunk-ca.pem` | Conditional for a private CA. |
| `SPLUNK_CA_CERT` | CA path inside the API container/process. | `/run/secrets/splunk_ca.pem` | Conditional for a private CA. |

Use the explicit certificate overlay:

```powershell
docker compose -f docker-compose.yml -f docker-compose.splunk.yml up --build -d
```

### Wazuh

| Variable | Purpose | Example value | Required? |
|---|---|---|---|
| `WAZUH_MODE` | `mock` or real indexer mode. | `mock` | No; default `mock`. |
| `WAZUH_INDEXER_URL` | Wazuh Indexer URL. | `https://wazuh-indexer.example.internal:9200` | Yes for a real Wazuh source. |
| `WAZUH_INDEXER_USER` | Indexer username. | `soc-readonly` | Conditional; default `admin`. |
| `WAZUH_INDEXER_PASS` | Indexer password. | Redacted credential | Yes for a real Wazuh source. |
| `WAZUH_VERIFY_TLS` | Enables TLS verification. | `true` | No; `.env.example` defaults to `false`; verified TLS is required outside controlled testing. |
| `WAZUH_INDEX` | Wazuh alert pattern. | `wazuh-alerts-*` | No; has default. |
| `WAZUH_CA_CERT` | CA path read by the adapter. | `/run/secrets/wazuh_ca.pem` | Conditional, but the committed Compose file does not forward/mount it; see [KI-023](KNOWN_ISSUES.md#ki-023-wazuh-custom-ca-configuration-is-not-forwarded-by-compose). |

### Hermes

| Variable | Purpose | Example value | Required? |
|---|---|---|---|
| `HERMES_REQUIRED` | Fails API startup when Hermes credentials/safety capabilities are missing. | `false` for telemetry-only local work; `true` for AI-enabled deployment | No at API level; Compose default is `true`. |
| `HERMES_API_URL` | Hermes OpenAI-compatible gateway URL. | `http://host.docker.internal:8642/v1` | Required when Hermes is enabled. |
| `HERMES_API_KEY` | Server-to-Hermes key; must match Hermes host `API_SERVER_KEY`. | Redacted credential | Required when `HERMES_REQUIRED=true`. |
| `HERMES_MODEL` | Default Hermes model alias. | `hermes-agent` | No; has default. |
| `HERMES_TIMEOUT_MS` | Overall operation timeout, bounded 10,000–600,000ms. | `180000` | No. |
| `HERMES_REQUEST_TIMEOUT_MS` | Individual request timeout, bounded 1,000–60,000ms. | `10000` | No. |
| `HERMES_MAX_RETRIES` | Request retries, bounded 0–5. | `2` | No. |
| `HERMES_POLL_INTERVAL_MS` | Sub-run polling interval, bounded 100–5,000ms. | `500` | No. |
| `HERMES_CAPABILITY_TTL_MS` | Capability-cache lifetime. | `60000` | No. |
| `HERMES_ANALYST_MAX_TOOL_CALLS` | Maximum grounded-chat tool calls, bounded 1–8. | `4` | No. |
| `HERMES_ANALYST_TIMEOUT_MS` | Grounded analyst timeout. | `240000` | No. |
| `HERMES_TRIAGE_MAX_TOOL_CALLS` | Triage tool-call cap, bounded 1–4. | `3` | No. |
| `HERMES_TRIAGE_TIMEOUT_MS` | Triage timeout. | `180000` | No. |
| `HERMES_CORRELATION_TIMEOUT_MS` | Correlation timeout. | `180000` | No. |
| `HERMES_TOOL_TIMEOUT_MS` | Per-tool timeout. | `10000` | No. |
| `HERMES_TOOL_RESULT_MAX_BYTES` | Per-tool result cap, bounded 4,096–262,144 bytes. | `65536` | No. |
| `HERMES_STRICT_CAPABILITIES` | Fails closed when required capabilities cannot be verified. | `true` | Must be `true` when Hermes is required. |
| `HERMES_ENFORCE_SAFE_TOOLSETS` | Enforces the allowed SOC tool boundary. | `true` | Must be `true` when Hermes is required. |
| `HERMES_REQUIRE_TOOLLESS_PROFILE` | Requires the configured toolless profile. | `true` | Must be `true` when Hermes is required. |
| `HERMES_FORBIDDEN_TOOLS` | Comma-separated host tools that fail the SOC profile closed. | Value committed in `.env.example` | No; secure default exists. |

OpenRouter credentials for the optional model profile belong on the Hermes host, not in BMB `.env`. The API’s model catalog routes that profile through Hermes.

### Declared but inactive Compose variables

| Variable | Current state |
|---|---|
| `LLM_PROVIDER` | Passed by Compose but not read by active API code. |
| `NOUS_BASE_URL`, `NOUS_API_KEY`, `NOUS_MODEL`, `NOUS_JSON_MODE`, `NOUS_REQUEST_TIMEOUT_MS` | Passed by Compose but not read; Nous is not an active fallback. |
| `ELASTIC_SPACE_ID` | Passed by Compose but not read by the active Elastic adapter. |

Do not rely on these settings. See [KI-022](KNOWN_ISSUES.md#ki-022-compose-advertises-ai-provider-variables-the-api-does-not-read).

### Maintenance-script-only variables

| Variable | Purpose | Required? |
|---|---|---|
| `ALERT_RETENTION_CONFIRMATION` | Must equal `PURGE DASHBOARD ALERTS` for destructive CLI retention. | Only for `run`, not `preview`. |
| `MITRE_BACKFILL_CONFIRMATION` | Must equal `BACKFILL MITRE MAPPINGS` for a write backfill. | Only for `run`. |
| `MITRE_BACKFILL_SINCE_HOURS` | Limits the MITRE mapping scan window. | No. |
| `SPLUNK_NORMALIZATION_CONFIRMATION` | Must equal `BACKFILL SPLUNK ALERTS` for a write backfill. | Only for `run`. |

## Run the Full Stack

Until KI-002 is fixed, always specify the base Compose file so Docker does not automatically load `docker-compose.override.yml`:

```powershell
docker compose -f docker-compose.yml up --build -d
docker compose -f docker-compose.yml ps
```

Expected endpoints:

| Service | URL/exposure | Expected result |
|---|---|---|
| Frontend | `http://localhost:8080/login` | Login page. |
| API health | `http://127.0.0.1:3000/api/health` | JSON health response; endpoint is public. |
| PostgreSQL | `127.0.0.1:5432` | Localhost-only database port. |
| Enrichment | Internal Compose network on `enrichment:3001` | No host port is published. |

Verify without signing in:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
docker compose -f docker-compose.yml exec enrichment wget -qO- http://localhost:3001/health
```

The API obtains a PostgreSQL advisory lock and applies all files under `api/src/db/migrations` before bootstrapping an empty user directory and starting workers. There is no separate migration command for normal startup.

## Run the Frontend Development Server

Keep PostgreSQL, enrichment, and API in Compose, then run Vite locally:

```powershell
docker compose -f docker-compose.yml up --build -d postgres enrichment api
Set-Location frontend
npm run dev -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/login`. Vite proxies `/api` to `http://localhost:3000`. Stopping or omitting the API causes proxy `502`/`ECONNREFUSED` errors.

## Build for Production

```powershell
Set-Location frontend
npm ci
npm run build
```

The output is `frontend/dist`. The production Dockerfile performs the same build in Node 20 Alpine and copies it into unpinned `nginx:alpine`.

## Run Checks and Tests

### API

```powershell
Set-Location api
npm ci
npm run check
npm test
```

### Enrichment

```powershell
Set-Location enrichment
npm ci
npm run check
npm test
```

### Frontend

```powershell
Set-Location frontend
npm ci
npm run lint
npm test
npm run build
```

Audit results on 2026-08-26: API `200/200`, enrichment `2/2`, and frontend `83/83` tests passed; frontend lint and production build passed.

## Deployment Process

The only committed deployment mechanism is Docker Compose:

```powershell
docker compose -f docker-compose.yml up --build -d
```

The frontend container serves static files and reverse-proxies `/api/` to the API container. `/api/chat/stream` has proxy buffering disabled and a 300-second read timeout. No hosted target, CI/CD workflow, TLS termination, image registry, backup schedule, monitoring integration, or automated rollback is defined. Treat Compose as a local/single-host packaging baseline, not a production deployment runbook.

For an HTTPS deployment, terminate TLS in an external reverse proxy/load balancer, set `SOC_COOKIE_SECURE=true`, restrict `SOC_ALLOWED_ORIGINS` if cross-origin access is required, protect PostgreSQL, and provide secret/certificate management outside Git.

## Common Troubleshooting

Only issues reproduced or proven during this audit are included.

### `docker` is not recognized

Docker was absent from the audit host, so the Compose runtime could not be verified. Install Docker Engine/Desktop with the Compose plugin, then confirm:

```powershell
docker version
docker compose version
```

### Plain `docker compose up` fails before starting services

The automatic override is malformed. Use the base file explicitly until [KI-002](KNOWN_ISSUES.md#ki-002-compose-override-contains-a-malformed-volume-mapping) is fixed:

```powershell
docker compose -f docker-compose.yml config
docker compose -f docker-compose.yml up --build -d
```

### API exits with `Invalid configuration`

The API validates configuration before connecting. Observed required conditions include `DATABASE_URL`, a 32+ character session secret, 12+ character configured bootstrap passwords, source credentials/CA paths for the selected connector, and `HERMES_API_KEY` plus strict safety flags when `HERMES_REQUIRED=true`. For a telemetry-only local run, set:

```dotenv
ALERT_SOURCE=mock
WAZUH_MODE=mock
HERMES_REQUIRED=false
```

### Vite reports `/api` proxy `ECONNREFUSED`

This occurred when Vite was running without the API. Start the API on port 3000:

```powershell
docker compose -f docker-compose.yml up --build -d postgres enrichment api
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

### Vite/Vitest reports `spawn EPERM` in a restricted shell

The audit encountered this when Vite attempted to spawn its config helper inside a restricted process sandbox. Running the same isolated and full tests in a normal approved shell produced `25/25` and `83/83` passes. This is an execution-environment restriction, not a repository test failure.

---

Last updated: 2026-08-26 — generated by environment contract, startup validation, Compose, Dockerfile, script, build, test, and local-server audit
