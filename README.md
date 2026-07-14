# SOC Agent v2

Professional, containerised SOC alert-triage platform built on:

- **Postgres 16** — persistent alert store with enrichment + triage lifecycle
- **Node.js enrichment service** — AD / CMDB / EDR / TIP / Vuln in a single container
- **Node.js API** — Wazuh fetch, enrich-then-store pipeline, LLM triage, REST API
- **React + Vite frontend** — dark-theme SOC dashboard served by nginx
- **Docker Compose** — one command to run everything

## Quick start

```bash
# 1. Copy and edit secrets
cp .env.example .env
$EDITOR .env          # set WAZUH_*, GROQ_API_KEY, POSTGRES_PASSWORD

# 2. Build and start all containers
docker compose up --build -d

# 3. Wait ~15s for postgres to initialise, then open:
#    http://localhost        ← SOC dashboard
#    http://localhost:3000   ← API (Swagger at /api/health)
#    http://localhost:3001   ← Enrichment service
```

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                     Docker network                          │
│                                                            │
│  ┌──────────────┐   fetch    ┌─────────────────────────┐  │
│  │  Wazuh       │ ─────────► │  api  :3000              │  │
│  │  Indexer     │           │                           │  │
│  └──────────────┘           │  • fetch worker           │  │
│                             │  • enrich worker          │  │
│                             │  • triage worker (LLM)    │  │
│                             │  • REST API               │  │
│                             └──────────┬────────────────┘  │
│                                        │ enrichment calls  │
│                             ┌──────────▼────────────────┐  │
│                             │  enrichment  :3001         │  │
│                             │  AD/CMDB/EDR/TIP/Vuln      │  │
│                             └───────────────────────────┘  │
│                                        │                   │
│                             ┌──────────▼────────────────┐  │
│                             │  postgres  :5432           │  │
│                             │  alerts + incidents +      │  │
│                             │  fetch_runs + settings     │  │
│                             └───────────────────────────┘  │
│                                                            │
│  ┌──────────────┐  /api/*                                  │
│  │  frontend    │ ──────────────────────────────────────►  │
│  │  nginx :80   │  nginx proxies to api:3000               │
│  └──────────────┘                                          │
└────────────────────────────────────────────────────────────┘
```

## Data lifecycle

Every alert goes through these states in Postgres:

```
fetched_at → enrichment_status: pending
               ↓ enrichment worker
             enriched | enrichment_failed   (error stored, alert kept)
               ↓ triage worker (LLM)
             triage_status: triaged | triage_failed
```

The Settings page shows exactly how many alerts are in each state.
Failures are stored with error messages and can be retried from Settings.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `WAZUH_MODE` | `mock` | `real` or `mock` |
| `WAZUH_INDEXER_URL` | — | `https://<ip>:9200` |
| `WAZUH_INDEXER_USER` | `admin` | Indexer user |
| `WAZUH_INDEXER_PASS` | — | Indexer password |
| `WAZUH_VERIFY_TLS` | `false` | Set `true` for valid certs |
| `LLM_PROVIDER` | `groq` | `groq` or `ollama` |
| `GROQ_API_KEY` | — | Required when provider=groq |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | |
| `OLLAMA_MODEL` | `llama3.1:8b` | |

## API endpoints

```
GET  /api/health
GET  /api/stats                   Dashboard stats
GET  /api/alerts?page=&limit=&... Paginated alert list
GET  /api/alerts/:id              Single alert with full enrichment + verdict
GET  /api/incidents               Correlated incidents
GET  /api/incidents/:id           Incident with all linked alerts
PATCH /api/incidents/:id          Update status (open/closed/false_positive)
GET  /api/pivot?indicator=        IOC sweep across alerts + incidents
GET  /api/settings                All settings + pipeline stats
PUT  /api/settings                Update settings
GET  /api/scheduler/status        Scheduler state + recent runs
POST /api/scheduler/run-now       Trigger an immediate fetch cycle
GET  /api/runs                    Fetch run history
```

## Adding the log generator

If using the test log generator, copy its output to Wazuh's monitored paths:

```bash
python3 generate_logs.py --all --count 100 --incidents 3 --append
./run_and_copy.sh --all --count 100 --incidents 3 --append
```

Then trigger a fetch cycle from Settings or wait for the scheduler.
