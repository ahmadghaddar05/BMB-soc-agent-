# BMB SOC Platform

BMB SOC is a role-separated security operations platform for SOC analysts, security administrators, and executive reviewers. It collects alerts from Elastic Security, Splunk, Wazuh, or a deterministic lab source; stores and enriches the evidence; uses the external Hermes service for evidence-grounded triage and correlation when enabled; and exposes monitoring, analytics, investigation, case, MITRE ATT&CK, approval, and simulated-response workflows. PostgreSQL is the durable system of record; the React application does not call Elastic or Splunk directly.

## Tech Stack

Versions below are the constraints committed in each service's `package.json`. Container image tags come from `docker-compose.yml` and Dockerfiles.

| Layer | Technology | Version |
|---|---|---|
| Frontend framework | React | `^18.3.1` |
| Routing | React Router DOM | `^6.23.1` |
| Styling | Tailwind CSS plus repository CSS | `^3.4.4` |
| State management | React state, reducers, hooks, and browser storage; no external store | React `^18.3.1` |
| Charts | Recharts | `^2.12.7` |
| Icons | Lucide React | `^0.383.0` |
| Dates | date-fns | `^3.6.0` |
| Frontend build | Vite with `@vitejs/plugin-react` | Vite `^8.1.4`; plugin `^6.0.3` |
| Frontend tests | Vitest and jsdom | Vitest `^4.1.10`; jsdom `^29.1.1` |
| API | Node.js and Express | Node `>=20 <25`; Express `^4.19.2` |
| Database client | `pg` | `^8.11.5` |
| Database | PostgreSQL container | `16-alpine` |
| Enrichment service | Node.js and Express | Node `>=20 <25`; Express `^4.19.2` |
| PDF generation | PDFKit | `^0.15.0` |
| Production UI host | nginx | `alpine` tag, not pinned to a release |
| Deployment | Docker Compose | Compose specification; no version pinned in the repository |

## Project Structure

```text
BMB-soc-agent--main/
|-- api/                 # Express API, PostgreSQL access, migrations, collectors, AI workflows, and tests
|   `-- src/
|       |-- db/          # Database pool, migration runner, and versioned SQL migrations
|       |-- middleware/  # Signed-session authentication, CSRF, and role enforcement
|       |-- routes/      # REST endpoints for SOC, workflow, response, connector, and admin data
|       |-- services/    # Elastic, Splunk, Wazuh, Hermes, reporting, retention, and policy services
|       `-- workers/     # Collection, triage, correlation, autonomous workflow, and scheduler workers
|-- enrichment/          # Express gateway over bundled AD, CMDB, EDR, TIP, and vulnerability JSON datasets
|-- frontend/            # React/Vite single-page application and nginx production configuration
|   `-- src/
|       |-- components/  # Shared UI, shell, workflow, chart, replay, and topology components
|       |-- hooks/       # Replay, synchronized-event, and executive-drawer state hooks
|       |-- lib/         # API client, role policy, transforms, and deterministic simulation data
|       |-- pages/       # Route-level executive, analyst, and administrator workspaces
|       `-- styles/      # MITRE-specific stylesheet; the main stylesheet is src/index.css
|-- generators/          # Python lab telemetry and attack-scenario generators
|-- postgres/            # Legacy/bootstrap SQL mounted by PostgreSQL Compose startup
|-- eval/                # Stored-prediction export and evaluation scripts
|-- docs/                # Engineering, audit, phase, setup, and product-status documentation
|-- graphify-out/        # Generated code knowledge graph and query cache
|-- docker-compose.yml   # PostgreSQL, enrichment, API, and frontend production stack
|-- docker-compose.*.yml # Source-specific and certificate Compose overlays
`-- .env.example         # Supported runtime configuration contract
```

Files ending in `.before-*`, `.backup`, or `.save` are historical snapshots and are not active imports or container entrypoints.

## Quickstart

### Full Stack with the Deterministic Lab Source

Prerequisites and required secret lengths are documented in [SETUP.md](SETUP.md). From the repository root in PowerShell:

```powershell
Copy-Item .env.example .env
notepad .env
docker compose -f docker-compose.yml up --build -d
docker compose -f docker-compose.yml ps
```

Set the required PostgreSQL, bootstrap-account, and session values before starting. Set `HERMES_REQUIRED=false` for a telemetry-only local run, or configure `HERMES_API_KEY` for AI workflows. `CONNECTOR_ENCRYPTION_KEY` is required only for dashboard-managed connector credentials. Keep `ALERT_SOURCE=mock` and `WAZUH_MODE=mock` for deterministic alert collection. Open `http://localhost:8080/login`.

The explicit `-f docker-compose.yml` avoids the malformed automatic override recorded in [KI-002](KNOWN_ISSUES.md#ki-002-compose-override-contains-a-malformed-volume-mapping). Compose could not be executed during the 2026-08-26 audit because Docker is not installed on the audit host; this limitation is recorded in [KI-001](KNOWN_ISSUES.md#ki-001-full-compose-stack-was-not-runtime-validated-in-this-audit).

### Frontend Development Server

```powershell
Set-Location frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 4173
```

The development URL is `http://127.0.0.1:4173/`. Vite proxies `/api` to `http://127.0.0.1:3000`; start the API and PostgreSQL stack for authenticated pages.

### Build and Tests

```powershell
Set-Location api
npm ci
npm run check
npm test

Set-Location ..\enrichment
npm ci
npm run check
npm test

Set-Location ..\frontend
npm ci
npm test
npm run build
```

Audit result on 2026-08-26: API `200/200` tests passed, enrichment `2/2` tests passed, frontend `83/83` tests passed in a clean isolated run, the frontend linter passed, and the frontend production build passed. An earlier concurrent audit run caused an `App.test.jsx` timeout; the isolated file (`25/25`) and subsequent full-suite rerun both passed, so that transient result is not classified as a product defect.

## Documentation Index

- [Architecture](ARCHITECTURE.md) — service boundaries, request and alert flows, state, dependencies, and limitations.
- [API and Data](API_AND_DATA.md) — runtime data shapes, persistence tables, source inventory, and endpoint contracts.
- [Components](COMPONENTS.md) — shared component props, variants, real usage examples, and call sites.
- [Pages](PAGES.md) — every route, component composition, data source, interaction, gap, and screenshot placeholder.
- [Design System](DESIGN_SYSTEM.md) — implemented tokens, typography, spacing, elevation, motion, and drift.
- [Feature Status](FEATURE_STATUS.md) — manager-facing implementation and verification status for every product area.
- [Known Issues](KNOWN_ISSUES.md) — runtime failures, functional gaps, accessibility findings, and technical debt.
- [Setup](SETUP.md) — prerequisites, environment configuration, local run, build, and deployment instructions.
- [Changelog](CHANGELOG.md) — notable changes reconstructed from Git history.
- [AI Triage and Correlation Guide](AI_TRIAGE_AND_CORRELATION_GUIDE.md) — detailed Hermes workflow and evidence-boundary behavior.
- [Managed Connectors](MANAGED_CONNECTORS.md) — connector storage, activation, and least-privilege behavior.

---

Last updated: 2026-08-26 — generated by full codebase review, Graphify queries, automated tests, production build, and local development-server audit.
