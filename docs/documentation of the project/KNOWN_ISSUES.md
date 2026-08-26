# Known Issues and Audit Findings

Issues below were found by direct source review, route/request tracing, automated checks, a production build, and a local Vite run. They are not inferred from an earlier product brief. Severity uses the requested `Cosmetic`, `Functional`, or `Blocking` scale.

## Audit Evidence Summary

| Check | Result |
|---|---|
| Frontend ESLint | Passed. |
| Frontend Vitest | Passed `83/83` in a clean full-suite run; isolated `App.test.jsx` passed `25/25`. |
| Frontend production build | Passed; notable artifact sizes are recorded in KI-016. |
| API tests | Passed `200/200`. |
| Enrichment tests | Passed `2/2`. |
| Local Vite server | Served `http://127.0.0.1:4173/` successfully. `/api/auth/session` returned proxy `502 / ECONNREFUSED` because the API was not running in that session. |
| Full Docker Compose run | Not executed: Docker is absent from the audit host and the default override is malformed. |
| Visual browser inspection | Not completed: the in-app browser runtime reported no available browser instance. |
| `TODO`/`FIXME` scan | No `TODO`, `FIXME`, `HACK`, `XXX`, or `BUG` marker was found in active `api/src`, `enrichment`, or `frontend/src` JS/JSX/CSS/SQL files. |

## KI-001: Full Compose Stack Was Not Runtime-Validated in This Audit

| Field | Detail |
|---|---|
| Location | Repository deployment path; all pages in [PAGES.md](PAGES.md) |
| Description | Docker is not installed on the audit host, and the in-app browser had no available browser instance. Only the Vite document was served; its API proxy logged `ECONNREFUSED` because the API was not started. Database migrations, authenticated page rendering, connector health, and screenshots were therefore not validated together in one running environment. |
| Severity | Blocking — audit/deployment verification, not evidence that all application code is broken. |
| Suggested fix | Resolve KI-002, start the full Compose stack on a Docker-capable host, run the smoke flow in [SETUP.md](SETUP.md), and replace the screenshot placeholders in [PAGES.md](PAGES.md). |

## KI-002: Compose Override Contains a Malformed Volume Mapping

| Field | Detail |
|---|---|
| Location | `docker-compose.override.yml:4` |
| Description | The quoted Elastic CA bind-mount string is split across lines between the source default and `http_ca.crt`. Docker Compose automatically reads this override with `docker-compose.yml`, so the documented default startup path is likely to fail parsing or construct an invalid mount. |
| Severity | Blocking |
| Suggested fix | Put the source and target on one valid YAML scalar, validate with `docker compose config`, then run `docker compose up --build` and the health checks. |

## KI-003: AI Triage Batch Action Has No Authorized UI User

| Field | Detail |
|---|---|
| Location | `frontend/src/pages/AITriage.jsx:54`; `frontend/src/lib/roles.js:101`; `api/src/routes/index.js:795`; [AI Triage page](PAGES.md#ai-triage-queue) |
| Description | The page permits `soc_analyst` only, while `POST /scheduler/triage-pending` requires `administrator`. Analysts receive `403`, and administrators cannot open the page through the current frontend route policy. Per-alert retriage is unaffected. |
| Severity | Functional |
| Suggested fix | Either authorize analysts for a bounded triage-queue endpoint or allow administrators to open the page. Add an integration test covering the chosen role contract. |

## KI-004: Light Theme Does Not Override the Product Token Layer

| Field | Detail |
|---|---|
| Location | `frontend/src/index.css:926`, `frontend/src/index.css:1198`; [Design System drift log](DESIGN_SYSTEM.md#drift-log) |
| Description | Light-mode rules are selector-specific literals declared before the later unscoped dark `:root` product tokens. New shared components continue to resolve dark surface/text tokens, creating mixed light/dark screens when the theme toggle is used. |
| Severity | Functional |
| Suggested fix | Define complete semantic tokens under `:root`/`[data-theme="light"]` and `[data-theme="dark"]`, then remove selector-specific theme patches after visual regression coverage exists. |

## KI-005: Valid Pages Are Absent from Role Navigation

| Field | Detail |
|---|---|
| Location | `frontend/src/lib/roles.js:41-66`, `frontend/src/lib/roles.js:101`, `frontend/src/lib/roles.js:112`; [Unrouted and Hidden Page Files](PAGES.md#unrouted-and-hidden-page-files) |
| Description | `/ai-triage` and `/playbooks` are valid analyst routes but do not appear in `ROLE_NAVIGATION`. `frontend/src/pages/Pivot.jsx` has no route, and `frontend/src/components/executive/AgentPerformanceHub.jsx` has no active importer. The functionality is difficult or impossible to discover through normal navigation. |
| Severity | Functional |
| Suggested fix | Decide which views remain supported, add the supported routes/components to navigation/composition, and remove obsolete implementations. Add a route-to-navigation consistency test. |

## KI-006: Settings Describes Authentication as a Single Environment Account

| Field | Detail |
|---|---|
| Location | `frontend/src/pages/Settings.jsx:74`; [Settings page](PAGES.md#settings) |
| Description | The UI says “Single environment-managed account” and “Environment configuration,” but active authentication uses database-backed `app_users` and the Users & Access page supports multiple accounts. This can mislead administrators and client reviewers. |
| Severity | Cosmetic |
| Suggested fix | Replace the copy with the reported authentication mode and database-user count or a neutral link to Users & Access. |

## KI-007: Collapsed Health Warning Cannot Be Expanded

| Field | Detail |
|---|---|
| Location | `frontend/src/components/ui/HeaderStatusChip.jsx:14-15`; [HeaderStatusChip reference](COMPONENTS.md#headerstatuschip) |
| Description | After collapse, the health warning becomes a noninteractive `<span>`. The session-storage flag remains set for the browser session, so the user cannot reopen the warning to read the affected dependencies. |
| Severity | Functional |
| Suggested fix | Render the collapsed state as a labeled button that clears the flag and expands the status. |

## KI-008: Unknown Severity Values Are Displayed as Low

| Field | Detail |
|---|---|
| Location | `frontend/src/components/ui/SeverityBadge.jsx:3-8`; [SeverityBadge reference](COMPONENTS.md#severitybadge) |
| Description | Any unrecognized value—including `informational`, an empty string, or a future server category—is normalized to `low` and the visible label is changed to “low.” This can understate or mislabel evidence. |
| Severity | Functional |
| Suggested fix | Add an `informational`/`unknown` neutral state, preserve a safe display label, and test all server-supported severities. |

## KI-009: Count-Up Animation Ignores Reduced Motion

| Field | Detail |
|---|---|
| Location | `frontend/src/components/ui/KpiTile.jsx:12-25`; [KpiTile reference](COMPONENTS.md#kpitile) |
| Description | The 300ms JavaScript `requestAnimationFrame` animation runs without checking `prefers-reduced-motion`. CSS media queries cannot disable it. |
| Severity | Functional |
| Suggested fix | Read `matchMedia('(prefers-reduced-motion: reduce)')` through a shared hook and render the final value immediately when reduction is requested. |

## KI-010: Underline Tabs Lack Required Arrow-Key Behavior

| Field | Detail |
|---|---|
| Location | `frontend/src/components/ui/UnderlineTabs.jsx:6-22`; [UnderlineTabs reference](COMPONENTS.md#underlinetabs) |
| Description | The component applies `tablist`/`tab` roles and roving `tabIndex`, but implements only click handling. With only the active tab tabbable, keyboard users cannot move among tabs using Left/Right/Home/End as expected by the ARIA tabs pattern. No `aria-controls` relationship is exposed. |
| Severity | Functional |
| Suggested fix | Implement roving focus and keyboard selection, provide tab IDs/panel relationships, and add keyboard tests. |

## KI-011: Decision Quality Dialog Does Not Manage Focus

| Field | Detail |
|---|---|
| Location | `frontend/src/components/DecisionQualityPanel.jsx:40-45`, `frontend/src/components/DecisionQualityPanel.jsx:75-87`; [DecisionQualityPanel reference](COMPONENTS.md#decisionqualitypanel) |
| Description | The modal has `role="dialog"`, `aria-modal`, Escape, and backdrop-close behavior, but it neither moves focus into the dialog, traps Tab navigation, nor restores focus to the trigger. Background content remains keyboard-reachable. |
| Severity | Functional |
| Suggested fix | Use a shared accessible dialog primitive or implement initial focus, focus containment, background inertness, and focus restoration. |

## KI-012: InfoTip Uses a Non-Native Button Without Button Keyboard Semantics

| Field | Detail |
|---|---|
| Location | `frontend/src/components/InfoTip.jsx:29-35`; [InfoTip reference](COMPONENTS.md#infotip) |
| Description | The trigger is a focusable `<span role="button">`. Focus displays the tooltip, but the element has no Enter/Space handler and does not inherit native button behavior. The role communicates an activation contract that is only partially implemented. |
| Severity | Functional |
| Suggested fix | Use `<button type="button">` with reset styles and explicit `aria-expanded`, or remove button semantics if focus/hover description is the intended pattern. |

## KI-013: Card Silently Drops a Caption When No Title or Action Exists

| Field | Detail |
|---|---|
| Location | `frontend/src/components/ui/Card.jsx:6-14`; [Card reference](COMPONENTS.md#card) |
| Description | Header rendering is gated by `(title || action)`, so `caption` by itself is accepted as a prop but never rendered. This makes the component contract conditional in a way its signature does not communicate. |
| Severity | Functional |
| Suggested fix | Gate the header with `(title || caption || action)` or reject/document caption-only usage through an explicit runtime/type contract. |

## KI-014: Icon-Only Button Discards the Requested Variant

| Field | Detail |
|---|---|
| Location | `frontend/src/components/ui/Button.jsx:3-11`; [Button reference](COMPONENTS.md#button) |
| Description | Setting `iconOnly` always applies the `ghost` class, even if the caller requests `primary` or `secondary`. This creates a prop combination whose visual result contradicts `variant`. |
| Severity | Cosmetic |
| Suggested fix | Apply the requested variant and add the icon sizing class independently, or remove `variant` from the documented icon-only contract. |

## KI-015: JavaScript Domain and Component Contracts Are Not Statically Checked

| Field | Detail |
|---|---|
| Location | `frontend/src`, `api/src`; [Data model reference](API_AND_DATA.md#data-model-reference) |
| Description | The codebase contains no TypeScript interfaces and shared components do not declare PropTypes. Domain shapes are distributed across SQL, AJV schemas, JSDoc, normalization helpers, and call sites. A server field rename can therefore reach runtime before a consumer fails. |
| Severity | Functional |
| Suggested fix | Generate/shared-schema contracts or migrate high-risk domain models and public component props to TypeScript incrementally, beginning with alerts, incidents, actions, responses, and API results. |

## KI-016: Frontend CSS and Chart Chunks Are Large

| Field | Detail |
|---|---|
| Location | Vite production output; `frontend/src/index.css`, Recharts consumers |
| Description | The audited build emitted approximately `395.83 kB` CSS (`66.02 kB` gzip) and an AreaChart/Recharts chunk of approximately `371.77 kB` (`98.93 kB` gzip). The build passes and emits no size error, but the CSS reflects the accumulated legacy/product layers and the chart bundle is a material first-load cost on analytics routes. |
| Severity | Functional |
| Suggested fix | Establish route performance budgets, remove unreachable/backup-era CSS, confirm lazy chunk boundaries, and evaluate narrower chart imports only after measuring browser coverage and load timing. |

## KI-017: Polling Is Implemented Independently Per Page

| Field | Detail |
|---|---|
| Location | `frontend/src/App.jsx:103`; `Dashboard.jsx:62`; `LiveMonitoring.jsx:183`; `DigitalTwin.jsx:95`; `Incidents.jsx:173`; `SOCAnalytics.jsx:108`; admin status pages |
| Description | Each mounted page owns timers and request state without a shared cache or request-deduplication layer. The shell and a page can probe related dependency/collector endpoints independently; revisiting routes discards cached results. Current pages usually pause when hidden, which limits but does not remove redundant requests. |
| Severity | Functional |
| Suggested fix | Introduce a small shared query/cache layer with freshness, cancellation, visibility, and retry policies. Keep page-specific polling intervals explicit. |

## KI-018: Timestamped Backup Source Files Pollute Repository Search and Graph Output

| Field | Detail |
|---|---|
| Location | 34 archived files: 14 under `api/src.before-elastic-connector-20260713-101839`, 14 beside active `api/src` files, 4 beside frontend pages, and 2 root Compose snapshots |
| Description | Historical copies are stored beside or under active source roots. They are not imported by the application, but repository-wide searches and Graphify queries return obsolete functions/routes and can cause reviewers to document or modify inactive code. |
| Severity | Functional |
| Suggested fix | Rely on Git history, move required forensic snapshots outside active source roots, and exclude archival patterns from Graphify if they must remain. |

## KI-019: Connector Management Is Separated from the Integrations Page

| Field | Detail |
|---|---|
| Location | `frontend/src/pages/Integrations.jsx`; `frontend/src/pages/Settings.jsx:65`; [Integrations](PAGES.md#integrations), [Settings](PAGES.md#settings) |
| Description | Integrations displays connection status and navigation only, while `ConnectorManager` is mounted under Settings. Administrators reasonably expect to configure the telemetry connectors on the Integrations page, so setup/troubleshooting requires switching between pages. |
| Severity | Cosmetic |
| Suggested fix | Mount connector management under Integrations or rename the pages and links to make the split between status and configuration explicit. |

## KI-020: Security Analytics Uses Text Below the Shared Typography Scale

| Field | Detail |
|---|---|
| Location | `frontend/src/index.css:1186-1193`; [Security Analytics](PAGES.md#security-analytics) |
| Description | Dense metrics and ranking styles use `7px`, `8px`, and `9px` text, below the shared product component range. This is a readability and visual-consistency risk, especially on scaled or high-density displays. Contrast/readability could not be measured visually because the browser runtime was unavailable. |
| Severity | Cosmetic |
| Suggested fix | Raise supporting text to an agreed minimum (normally at least the shared `12px` metadata size), then validate responsive density and contrast in a browser. |

## KI-021: No Automated Accessibility or Visual Regression Checks Exist

| Field | Detail |
|---|---|
| Location | `frontend/package.json`, frontend test suite |
| Description | Component and route tests exist, but no axe, accessibility-tree, screenshot-diff, Lighthouse, or equivalent automated browser check was found. Theme drift, focus containment, responsive clipping, and contrast regressions can pass the current suite. |
| Severity | Functional |
| Suggested fix | Add browser-based smoke coverage for login and one route per role, then add axe and targeted screenshot assertions for shared shell, alerts, incidents, Digital Twin, MITRE, and administration flows. |

## KI-022: Compose Advertises AI Provider Variables the API Does Not Read

| Field | Detail |
|---|---|
| Location | `docker-compose.yml:79-86`; `api/src/config.js:40-94` |
| Description | Compose declares `LLM_PROVIDER` and `NOUS_*` variables and calls Nous an OpenAI-compatible fallback, but the active API configuration and AI services do not read those variables. All implemented model operations route through Hermes. `ELASTIC_SPACE_ID` is also passed by Compose but has no active API consumer. Setting these values has no effect. |
| Severity | Functional |
| Suggested fix | Remove stale variables/comments or restore an explicitly tested provider abstraction. Do not describe Nous as a fallback until startup validation and workflow tests prove it is active. |

## KI-023: Wazuh Custom CA Configuration Is Not Forwarded by Compose

| Field | Detail |
|---|---|
| Location | `api/src/services/wazuh.js:157`; `.env.example`; `docker-compose.yml` |
| Description | The Wazuh adapter reads `WAZUH_CA_CERT`, but `.env.example` does not declare it and the API service does not receive it from Compose or mount a Wazuh CA file. Wazuh servers using a private CA cannot be configured for verified TLS through the committed Compose path. |
| Severity | Functional |
| Suggested fix | Add `WAZUH_CA_HOST_PATH`/`WAZUH_CA_CERT` to the environment contract, create a certificate mount overlay, forward the container path to the API, and add a TLS configuration test. |

---

Last updated: 2026-08-26 — generated by source, route, dependency, accessibility, TODO/FIXME, lint, test, build, and local runtime audit
