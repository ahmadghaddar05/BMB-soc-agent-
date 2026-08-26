# Components

## Scope and Typing

This reference covers every component exported by `frontend/src/components/ui/index.js`, plus shell and reusable domain visualizations used by route pages. Page-private helper functions and dashboard-only composition fragments are documented in [PAGES.md](PAGES.md), not as shared-library APIs.

The project is JavaScript, not TypeScript, and declares neither PropTypes nor JSDoc props for these components. Accordingly, `Type` records the runtime expectation visible in the implementation, while `Required` is `Not declared`; no compile-time or runtime required-prop metadata exists.

## Layout & Navigation

### RoleAwareSidebar

**File location:** `frontend/src/components/RoleAwareSidebar.jsx`

**Purpose:** Renders the role-filtered primary navigation, platform health, mobile close control, and desktop collapse control.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `role` | Undeclared; role string | Not declared | None | Selects groups from `getRoleNavigation`. |
| `collapsed` | Undeclared; boolean | Not declared | None | Uses compact desktop rendering. |
| `mobileOpen` | Undeclared; boolean | Not declared | None | Applies the mobile-open class. |
| `health` | Undeclared; object/null | Not declared | None | Supplies status and source for the footer. |
| `brand` | Undeclared; React node | Not declared | None | Brand element rendered at the top. |
| `onCloseMobile` | Undeclared; function | Not declared | None | Called by links and the mobile close button. |
| `onToggleCollapsed` | Undeclared; function | Not declared | None | Called by the collapse button. |

**Usage example:**

```jsx
<RoleAwareSidebar
  role={role}
  collapsed={collapsed}
  mobileOpen={mobileOpen}
  health={platformHealth}
  brand={<BmbLogo compact={collapsed} />}
  onCloseMobile={() => setMobileOpen(false)}
  onToggleCollapsed={() => setCollapsed(value => !value)}
/>
```

**Variants/states:** Expanded/collapsed desktop, closed/open mobile, healthy/degraded/checking footer; all are driven by props.

**Used in:** `frontend/src/App.jsx`.

**Notes:** Route visibility comes from `frontend/src/lib/roles.js`. Valid analyst routes `/ai-triage` and `/playbooks` are absent from that navigation configuration.

### PermissionGuard

**File location:** `frontend/src/components/PermissionGuard.jsx`

**Purpose:** Prevents a role from rendering a route that is not in the static frontend access map.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `role` | Undeclared; role string | Not declared | None | Role checked by `canAccessRoute`. |
| `children` | Undeclared; React node | Not declared | None | Authorized route content. |

**Usage example:**

```jsx
const protect = element => <PermissionGuard role={role}>{element}</PermissionGuard>;
```

**Variants/states:** Authorized renders `children`; denied redirects with `Navigate` to the role landing route.

**Used in:** `frontend/src/App.jsx` for every protected route.

**Notes:** This is a UI boundary only. API middleware independently enforces role access and is the security boundary.

### LoginPage

**File location:** `frontend/src/components/LoginPage.jsx`

**Purpose:** Collects credentials and returns the server-assigned authenticated session to the application shell.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `onAuthenticated` | Undeclared; function | Not declared | None | Called with `{ user, csrf }` after login. |

**Usage example:**

```jsx
<Route path="/login" element={<LoginPage onAuthenticated={authenticate} />} />
```

**Variants/states:** Credential form, busy submission, and API error.

**Used in:** `frontend/src/App.jsx`.

**Notes:** The browser does not choose a role; the API assigns it from `app_users`.

### ChatWidget

**File location:** `frontend/src/components/ChatWidget.jsx`

**Purpose:** Provides the authenticated grounded-analyst panel and consumes the streamed chat endpoint.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `role` | Undeclared; role string | Not declared | None | Selects role-appropriate welcome/context behavior. |
| `accountKey` | Undeclared; string | Not declared | None | Scopes the sessionStorage conversation key. |
| `pageContext` | Undeclared; object/null | Not declared | `null` | Supplies current path, title, and subtitle to the request. |

**Usage example:**

```jsx
<ChatWidget
  role={role}
  accountKey={`${session.user.id || session.user.username}:${role}`}
  pageContext={{ path: `${location.pathname}${location.search}`, title, subtitle }}
/>
```

**Variants/states:** Closed/open panel, welcome/conversation, sending/progress/result/error, and cancelable streamed run.

**Used in:** `frontend/src/App.jsx`.

**Notes:** Only the conversation ID is browser-session state; messages, sub-runs, tool traces, citations, and usage are persisted by the API.

### SelectionAssistant

**File location:** `frontend/src/components/SelectionAssistant.jsx`

**Purpose:** Shows an “ask SOC assistant” action for bounded selected page text.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| — | — | — | — | This component accepts no declared props. |

**Usage example:**

```jsx
<SelectionAssistant />
```

**Variants/states:** Hidden without a 3–800 character selection; positioned action when a valid selection exists.

**Used in:** `frontend/src/App.jsx`.

**Notes:** Dispatches the same custom event consumed by `ChatWidget`; selected text is treated as the analyst's prompt context.

### DeepDiveDrawer

**File location:** `frontend/src/components/executive/DeepDiveDrawer.jsx`

**Purpose:** Presents URL-backed, role-safe executive detail for a selected metric, risk, incident, or technology category.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `state` | Undeclared; drawer state object | Not declared | None | Supplies `status`, `selection`, `data`, and `error`; `status='closed'` hides the drawer. |
| `onClose` | Undeclared; function | Not declared | None | Closes the drawer and is called by Escape, backdrop, close, and return controls. |
| `onRetry` | Undeclared; function | Not declared | None | Retries a failed drawer load. |
| `onOpen` | Undeclared; function | Not declared | None | Opens a related drill-down from the risk directory. |

**Usage example:**

```jsx
<DeepDiveDrawer state={drawer.state} onClose={drawer.close} onRetry={drawer.retry} onOpen={(selection, trigger) => drawer.open(selection, trigger)} />
```

**Variants/states:** Closed, loading, error, and ready; ready content varies for `risk-summary`, `incident`, `asset`, and `metric` selections.

**Used in:** Executive Dashboard.

**Notes:** Implements initial focus, Escape, Tab containment, body-scroll locking, and focus restoration through the owning `useDeepDiveDrawer` hook.

## Data Display

### Card

**File location:** `frontend/src/components/ui/Card.jsx`

**Purpose:** Provides the canonical bordered surface with an optional title, caption, action, and compact density.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `title` | Undeclared; React node/string | Not declared | None | Header title. |
| `caption` | Undeclared; React node/string | Not declared | None | Supporting header text. |
| `action` | Undeclared; React node | Not declared | None | Right-side header content. |
| `compact` | Undeclared; boolean | Not declared | `false` | Uses compact padding. |
| `className` | Undeclared; string | Not declared | None | Additional class names. |
| `children` | Undeclared; React node | Not declared | None | Card body. |
| `as` | Undeclared; element/component | Not declared | `'section'` | Root element type. |
| `...props` | Undeclared; DOM/component props | Not declared | Empty | Forwarded to the root. |

**Usage example:**

```jsx
<Card title="Evidence" caption="Observed activity" compact><p>Stored record</p></Card>
```

**Variants/states:** Standard and `compact`; root element can change through `as`.

**Used in:** Attack Simulator, Assets, Cases, Digital Twin, Investigations, MITRE Coverage, Security Analytics, Threat Intelligence, `EntityRelationshipGraph`, replay components, and `KpiTile`.

**Notes:** A caption alone does not render because the header condition checks only `title || action`.

### KpiTile

**File location:** `frontend/src/components/ui/KpiTile.jsx`

**Purpose:** Displays one numeric or textual KPI with optional formatter and sparkline.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `label` | Undeclared; React node/string | Not declared | None | KPI label. |
| `value` | Undeclared; number/React-renderable | Not declared | None | Value; finite numbers count up on first render. |
| `formatter` | Undeclared; function | Not declared | None | Formats the animated/current value. |
| `sparkline` | Undeclared; number array | Not declared | None | Values converted to a small SVG polyline. |
| `className` | Undeclared; string | Not declared | None | Additional class names. |

**Usage example:**

```jsx
<KpiTile key={item.label} {...item} />
```

**Variants/states:** Numeric 300 ms count-up, static nonnumeric value, with/without sparkline.

**Used in:** Security Analytics.

**Notes:** The count-up does not consult `prefers-reduced-motion`; see [KNOWN_ISSUES.md](KNOWN_ISSUES.md#ki-009-count-up-animation-ignores-reduced-motion).

### SeverityBadge

**File location:** `frontend/src/components/ui/SeverityBadge.jsx`

**Purpose:** Renders a normalized alert/incident severity label.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `severity` | Undeclared; string | Not declared | `'low'` | Lowercased and checked against supported levels. |
| `className` | Undeclared; string | Not declared | None | Additional classes. |

**Usage example:**

```jsx
<SeverityBadge severity="critical" />
```

**Variants/states:** `critical`, `high`, `medium`, and `low`; unknown values silently render as `low`.

**Used in:** Alerts, Assets, Cases, Incidents, Investigations, Live Monitoring, MITRE Coverage, Threat Intelligence, entity graph, and replay components.

**Notes:** Mapping unknown or `informational` severities to `low` loses source meaning.

### StatusChip

**File location:** `frontend/src/components/ui/StatusChip.jsx`

**Purpose:** Displays a compact semantic workflow/status label.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `status` | Undeclared; string | Not declared | `'neutral'` | Appended to the `ui-status-*` class. |
| `children` | Undeclared; React node | Not declared | `status` | Visible label. |
| `className` | Undeclared; string | Not declared | None | Additional classes. |

**Usage example:**

```jsx
<StatusChip status="active">Live</StatusChip>
```

**Variants/states:** Styled classes exist for neutral, active/live, degraded/attention, error, and resolved.

**Used in:** Most analyst pages, `AnalystDecisionReview`, `EntityRelationshipGraph`, decision traces, and replay components.

**Notes:** Arbitrary status strings are accepted; unsupported values receive only the base styling.

### StatusBadge

**File location:** `frontend/src/components/StatusBadge.jsx`

**Purpose:** Compatibility wrapper that maps administrator-page tones onto shared `StatusChip` classes.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `tone` | Undeclared; string | Not declared | `'neutral'` | Maps `success→resolved`, `attention→degraded`, and `critical→error`. |
| `children` | Undeclared; React node | Not declared | None | Visible label. |
| `className` | Undeclared; string | Not declared | `''` | Additional classes. |

**Usage example:**

```jsx
<StatusBadge tone="success">Active</StatusBadge>
```

**Variants/states:** `success`, `attention`, `critical`, `neutral`, or any pass-through tone.

**Used in:** AI Configuration, Audit & Governance, Collector Health, Data Retention, Settings, Users & Access, and Connector Manager.

**Notes:** Duplicates part of `StatusChip`'s API and indicates an unfinished component migration.

### Timeline

**File location:** `frontend/src/components/ui/Timeline.jsx`

**Purpose:** Renders chronological workflow, case, simulation, or attack events with optional live semantics and auto-scroll.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `items` | Undeclared; item object array | Not declared | `[]` | Items may include ID, title, detail, metadata, time, tone/severity, icon, and disclosure content. |
| `className` | Undeclared; string | Not declared | None | Additional classes. |
| `ariaLabel` | Undeclared; string | Not declared | `'Event timeline'` | Accessible list label. |
| `live` | Undeclared; boolean | Not declared | `false` | Enables polite log semantics. |
| `autoScroll` | Undeclared; boolean | Not declared | `false` | Scrolls the last event into view. |

**Usage example:**

```jsx
<Timeline items={timelineItems} className="cases-analyst-timeline" />
```

**Variants/states:** Severity tones, success tone, final item, expandable recorded details, live log, and auto-scroll.

**Used in:** Assets, Attack Simulator, Cases, Digital Twin, Investigations, MITRE Coverage, and triage workflow components.

**Notes:** Item shape is implicit JavaScript and is not validated.

### EntityRelationshipGraph

**File location:** `frontend/src/components/EntityRelationshipGraph.jsx`

**Purpose:** Shows exact stored observable-to-alert-to-incident relationships without inferring new correlations.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `indicator` | Undeclared; string | Not declared | None | Active pivot value. |
| `observableType` | Undeclared; object | Not declared | None | Selects icon and label. |
| `alerts` | Undeclared; alert array | Not declared | `[]` | Matching alert evidence; latest ten are shown. |
| `incidents` | Undeclared; incident array | Not declared | `[]` | Stored incidents containing matching alerts. |
| `navigate` | Undeclared; function | Not declared | None | Opens alert and incident routes. |

**Usage example:**

```jsx
<EntityRelationshipGraph indicator={indicator} observableType={model.observableType} alerts={model.alerts} incidents={incidents} navigate={navigate} />
```

**Variants/states:** Identity/network/database anchor icons; empty/nonempty alert and incident lanes.

**Used in:** Entity Intelligence.

**Notes:** Equality uses normalized substring matching for the pivot but exact equality for peer relationships; the component states this provenance boundary in its footer.

### AnalystDecisionReview

**File location:** `frontend/src/components/AnalystDecisionReview.jsx`

**Purpose:** Records an append-only human confirmation, challenge, or evidence request against an alert or incident decision.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `entityType` | Undeclared; `'alert'`/`'incident'` string | Not declared | None | Review target category. |
| `entityId` | Undeclared; string/number | Not declared | None | Review target ID. |
| `reviews` | Undeclared; review array | Not declared | `[]` | Existing reviews, newest first. |
| `onRecorded` | Undeclared; function | Not declared | None | Receives a saved review. |
| `openSignal` | Undeclared; number | Not declared | `0` | Changing value opens the form. |

**Usage example:**

```jsx
<AnalystDecisionReview entityType="alert" entityId={alert.id} reviews={journey?.analyst_reviews || []} openSignal={reviewSignal} onRecorded={review => onJourneyChange?.(current => ({ ...(current || {}), analyst_reviews:[review, ...(current?.analyst_reviews || [])] }))} />
```

**Variants/states:** Awaiting/reviewed summary; closed/open form; confirmed/challenged/needs-more-evidence; busy/error.

**Used in:** Alert Triage and Incidents.

**Notes:** The minimum 10-character reason is enforced in the form and API.

### TriageDecisionSummary

**File location:** `frontend/src/components/TriageDecisionTrace.jsx`

**Purpose:** Summarizes recorded triage provenance and links to the full workflow trace.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `journey` | Undeclared; object/null | Not declared | None | Recorded alert journey. |
| `loading` | Undeclared; boolean | Not declared | None | Shows loading state. |
| `error` | Undeclared; boolean/error marker | Not declared | None | Shows unavailable state. |
| `verdict` | Undeclared; object/null | Not declared | None | Current verdict summary. |
| `onOpenWorkflow` | Undeclared; function | Not declared | None | Opens the workflow tab. |

**Usage example:**

```jsx
<TriageDecisionSummary journey={journey} loading={journeyLoading} error={journeyError} verdict={verdict} onOpenWorkflow={() => setTab('workflow')} />
```

**Variants/states:** Loading, missing/error, recorded decision, cache/AI/system executor detail.

**Used in:** Alert Triage.

**Notes:** Missing workflow stages are displayed as missing rather than inferred.

### TriageWorkflow

**File location:** `frontend/src/components/TriageDecisionTrace.jsx`

**Purpose:** Renders the full collected-to-triaged provenance stages for an alert.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `journey` | Undeclared; object/null | Not declared | None | Stage events and recorded details. |
| `loading` | Undeclared; boolean | Not declared | None | Loading state. |
| `error` | Undeclared; boolean/error marker | Not declared | None | Unavailable state. |

**Usage example:**

```jsx
{tab === 'workflow' && <TriageWorkflow journey={journey} loading={journeyLoading} error={journeyError} />}
```

**Variants/states:** Pending, running, completed, failed, skipped, and absent stages.

**Used in:** Alert Triage.

**Notes:** Stage ordering is defined locally by the component's `STAGES` constant.

### IncidentCorrelationTrace

**File location:** `frontend/src/components/IncidentCorrelationTrace.jsx`

**Purpose:** Explains how stored alerts and shared entities became an incident.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `incident` | Undeclared; incident object | Not declared | None | Selected incident. |
| `alerts` | Undeclared; alert array | Not declared | None | Member evidence. |
| `journey` | Undeclared; journey object/null | Not declared | None | Correlation provenance. |
| `loading` | Undeclared; boolean | Not declared | None | Journey loading state. |
| `error` | Undeclared; boolean/error marker | Not declared | None | Journey failure state. |

**Usage example:**

```jsx
<IncidentCorrelationTrace incident={detail} alerts={model.alerts} journey={journey} loading={journeyLoading} error={journeyError} />
```

**Variants/states:** Loading, unavailable, recorded correlation, and deterministic shared-entity evidence.

**Used in:** Incidents.

**Notes:** Counts and relationships are recomputed from supplied evidence rather than model narrative.

### AgentPerformanceHub

**File location:** `frontend/src/components/executive/AgentPerformanceHub.jsx`

**Purpose:** Summarizes collector-to-workflow stage readiness and recent completed autonomous operations for an executive audience.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `agent` | Undeclared; agent-status object | Not declared | `{}` | Supplies readiness, enabled state, latest run, approvals, and recent operations. |
| `collector` | Undeclared; collector-status object | Not declared | `{}` | Contributes collector stage status. |
| `loading` | Undeclared; boolean | Not declared | `false` | Shows a checking state. |
| `error` | Undeclared; error value | Not declared | `null` | Shows unavailable state. |
| `onReview` | Undeclared; function | Not declared | None | Receives `(operation, triggerElement)` for a detail action. |

**Usage example:**

```jsx
<AgentPerformanceHub />
```

**Variants/states:** Loading, unavailable, enabled, disabled, active pipeline stage, completed-operation list, and empty state.

**Used in:** No active page or parent component.

**Notes:** The component is exported but not imported. Its first stage copy says Elastic even though the platform supports other sources.

### BusinessAssetList

**File location:** `frontend/src/components/executive/BusinessAssetList.jsx`

**Purpose:** Ranks leadership-safe technology exposure categories from executive overview data.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `assets` | Undeclared; asset summary array | Not declared | `[]` | Items are ranked and limited to five. |
| `onSelect` | Undeclared; function | Not declared | None | Receives `(asset, triggerElement)` for drill-down. |

**Usage example:**

```jsx
<BusinessAssetList assets={overview.top_assets || []} onSelect={(asset, trigger) => drawer.open({ type:'asset', id:asset.asset_key || asset.id || asset.name, seed:{ ...asset, window_days:overview.window_days || period } }, trigger)} />
```

**Variants/states:** Populated ranked list and asset-context-unavailable empty state.

**Used in:** Executive Dashboard.

**Notes:** The copy explicitly states that categories are not mapped business services.

### ExecutiveAiValue

**File location:** `frontend/src/components/executive/ExecutiveAiValue.jsx`

**Purpose:** Displays AI workflow coverage, internal output counts, approvals, failures, and estimated time saved.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `automation` | Undeclared; automation summary object | Not declared | `{}` | Supplies coverage, workflow, approval, and failure counts. |
| `timeSaved` | Undeclared; estimate object | Not declared | `{}` | Supplies hours and methodology. |
| `onOpen` | Undeclared; function | Not declared | None | Opens methodology/assumption detail. |

**Usage example:**

```jsx
<ExecutiveAiValue automation={overview.automation} timeSaved={overview.time_saved} onOpen={openMetric('ai-value', 'AI-assisted value assumptions', overview.time_saved?.methodology, 'automation')} />
```

**Variants/states:** Values fall back to zero; methodology falls back to the coded estimation statement.

**Used in:** Executive Dashboard.

**Notes:** Time saved is explicitly estimated, and the component states that external actions executed are zero.

### ExecutiveBriefing

**File location:** `frontend/src/components/executive/ExecutiveBriefing.jsx`

**Purpose:** Presents the current executive security summary and the recorded leadership decision request.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `briefing` | Undeclared; briefing object | Not declared | `{}` | Supplies summary, direction, direction reason, and required decision. |
| `onReview` | Undeclared; function | Not declared | None | Opens supporting risk detail. |

**Usage example:**

```jsx
<ExecutiveBriefing briefing={overview.briefing} onReview={openRisks} />
```

**Variants/states:** Calculating fallback, unavailable trend explanation, explicit/no-immediate-decision copy.

**Used in:** Executive Dashboard.

**Notes:** It is a presentation component; it does not write leadership decisions.

### ExecutiveDataTrust

**File location:** `frontend/src/components/executive/ExecutiveDataTrust.jsx`

**Purpose:** Makes dependency reachability and source/mapping coverage visible beside executive metrics.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `health` | Undeclared; dependency-health object | Not declared | `{}` | Supplies service reachability and active source. |
| `coverage` | Undeclared; mapping-coverage object | Not declared | `{}` | Supplies asset and business-service mapping percentages/availability. |
| `generatedAt` | Undeclared; timestamp value | Not declared | None | Displays snapshot refresh time. |

**Usage example:**

```jsx
<ExecutiveDataTrust health={dependencies || {}} coverage={overview.source_coverage} generatedAt={overview.generated_at} />
```

**Variants/states:** Each check is Healthy, Degraded, or Unknown.

**Used in:** Executive Dashboard.

**Notes:** The first check is labeled Elastic even when another alert source is active; freshness for threat intelligence and vulnerabilities is explicitly unavailable.

### ExecutiveDecisionQueue

**File location:** `frontend/src/components/executive/ExecutiveDecisionQueue.jsx`

**Purpose:** Aggregates unassigned incidents, pending approvals, failed internal actions, and degraded source status into a decision list.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `queue` | Undeclared; decision-queue object | Not declared | `{}` | Supplies decision counts and overdue-data availability. |
| `collectorDelayed` | Undeclared; boolean | Not declared | `false` | Adds one degraded-source decision when true. |
| `onReviewRisks` | Undeclared; function | Not declared | None | Handles incident-risk rows. |
| `onReviewControls` | Undeclared; function | Not declared | None | Handles approval/action/source rows. |

**Usage example:**

```jsx
<ExecutiveDecisionQueue queue={overview.decision_queue} collectorDelayed={collectorDelayed} onReviewRisks={openRisks} onReviewControls={openMetric('decision-controls', 'Decision queue controls', 'Approval requests, failed internal workflow actions, and degraded source status require review in their role-authorized operational workspaces.', 'automation')} />
```

**Variants/states:** Clear/needs-attention badge; per-row success/attention icon; overdue-data-unavailable note.

**Used in:** Executive Dashboard.

**Notes:** The example is the active Dashboard call site.

### ExecutiveKpiGrid

**File location:** `frontend/src/components/executive/ExecutiveKpiGrid.jsx`

**Purpose:** Renders five executive metric cards with availability, comparison, confidence, target, and evidence controls.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `overview` | Undeclared; executive overview object | Not declared | None | Supplies metrics plus fallback health/risk/time-saved fields. |
| `onOpenRisks` | Undeclared; function | Not declared | None | Evidence handler for critical incidents. |
| `onOpenServices` | Undeclared; function | Not declared | None | Evidence handler for service exposure. |
| `onOpenMethodology` | Undeclared; function | Not declared | None | Evidence handler for risk methodology. |
| `onOpenResponse` | Undeclared; function | Not declared | None | Evidence handler for response time. |
| `onOpenAutomation` | Undeclared; function | Not declared | None | Evidence handler for estimated time saved. |

**Usage example:**

```jsx
<ExecutiveKpiGrid
  overview={overview}
  onOpenRisks={openRisks}
  onOpenServices={openMetric(
    'business-service-risk',
    'Critical business services at risk',
    `${overview.business_services_at_risk?.total || 0} mapped critical or high-importance services are linked to open high-impact incidents. Mapping coverage is ${overview.business_services_at_risk?.coverage_percent ?? 0}%.`,
    'business-services'
  )}
  onOpenMethodology={openMetric('metric-methodology', 'Executive metric methodology', 'Risk exposure is derived from severe activity, open incident pressure, and the pending triage backlog.')}
  onOpenResponse={openMetric(
    'response-performance',
    'Mean time to respond',
    overview.response_performance?.mean_time_to_respond_hours == null
      ? 'No incident in the selected period has a recorded analyst response milestone.'
      : `The mean first-response time is ${overview.response_performance.mean_time_to_respond_hours} hours across ${overview.response_performance.incidents_with_response} of ${overview.response_performance.incidents_in_scope} incidents.`,
    'response-performance'
  )}
  onOpenAutomation={openMetric('workload-reduction', 'Estimated analyst time saved', overview.time_saved?.methodology, 'automation')}
/>
```

**Variants/states:** Available/unavailable, estimated/measured, favorable/unfavorable/no comparison, five color tones, and exposure-dependent tone.

**Used in:** Executive Dashboard.

**Notes:** `MetricCard` and `Delta` are private helpers. The example is the active Dashboard call site.

### ExecutiveRiskPanel

**File location:** `frontend/src/components/executive/ExecutiveRiskPanel.jsx`

**Purpose:** Displays up to three prioritized open incident risks for executive drill-down.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `risks` | Undeclared; risk summary object | Not declared | `{}` | Supplies total plus `items`. |
| `onSelect` | Undeclared; function | Not declared | None | Receives `(item, triggerElement)` for drill-down. |

**Usage example:**

```jsx
<ExecutiveRiskPanel risks={overview.business_risks} onSelect={(item, trigger) => drawer.open({ type:'incident', id:item.id, seed:item }, trigger)} />
```

**Variants/states:** Critical, high, and medium/default priority treatments plus an empty state.

**Used in:** Executive Dashboard.

**Notes:** Prioritization is incident-severity based; the copy discloses that business impact is a proxy until service criticality is mapped.

## Inputs & Controls

### Button

**File location:** `frontend/src/components/ui/Button.jsx`

**Purpose:** Provides shared primary, secondary, ghost, icon, button, and link styling.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `variant` | Undeclared; string | Not declared | `'secondary'` | Visual variant when not icon-only. |
| `icon` | Undeclared; React component | Not declared | None | Lucide-style icon component. |
| `iconOnly` | Undeclared; boolean | Not declared | `false` | Hides children and uses ghost/icon styling. |
| `className` | Undeclared; string | Not declared | None | Additional classes. |
| `children` | Undeclared; React node | Not declared | None | Visible label unless icon-only. |
| `type` | Undeclared; string | Not declared | `'button'` | Applied only when the root is `button`. |
| `as` | Undeclared; element/component | Not declared | `'button'` | Root element type. |
| `...props` | Undeclared; DOM/component props | Not declared | Empty | Forwarded to the root. |

**Usage example:**

```jsx
<Button variant="primary">Review</Button>
```

**Variants/states:** `primary`, `secondary`, `ghost`; icon+label; icon-only; disabled; link via `as="a"`.

**Used in:** Analyst pages, decision review/trace, topology, and replay workspaces.

**Notes:** `iconOnly` forces the ghost class regardless of `variant`; callers must provide an accessible label.

### Select

**File location:** `frontend/src/components/ui/Select.jsx`

**Purpose:** Wraps a native select with an optional visible label and chevron.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `label` | Undeclared; React node/string | Not declared | None | Visible label text. |
| `className` | Undeclared; string | Not declared | None | Wrapper classes. |
| `children` | Undeclared; option nodes | Not declared | None | Native options. |
| `...props` | Undeclared; select props | Not declared | Empty | Forwarded to `<select>`. |

**Usage example:**

```jsx
<Select label="Status" value={status} onChange={event => setStatus(event.target.value)}><option value="open">Open incidents</option><option value="closed">Closed incidents</option></Select>
```

**Variants/states:** Labeled/unlabeled, native disabled/focus/value states.

**Used in:** Alerts, Assets, Cases, Incidents, Investigations, Live Monitoring, MITRE Coverage, and replay workspace.

**Notes:** The wrapper is always a `<label>`, so an unlabeled select should receive `aria-label` from the caller.

### SegmentedControl

**File location:** `frontend/src/components/ui/SegmentedControl.jsx`

**Purpose:** Selects one value from a short set using pressed buttons.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `value` | Undeclared; string | Not declared | None | Active option value. |
| `options` | Undeclared; `{ value, label }[]` | Not declared | None | Rendered options. |
| `onChange` | Undeclared; function | Not declared | None | Receives the selected value. |
| `label` | Undeclared; string | Not declared | None | Accessible group label. |
| `className` | Undeclared; string | Not declared | None | Additional classes. |

**Usage example:**

```jsx
<SegmentedControl label="Range" value="24h" onChange={onChange} options={[{ value:'24h', label:'24 hours' }]} />
```

**Variants/states:** Pressed/unpressed option; no built-in disabled state.

**Used in:** Alerts, Attack Simulator, Live Monitoring, MITRE Coverage, and Security Analytics.

**Notes:** Options are not runtime-validated.

### UnderlineTabs

**File location:** `frontend/src/components/ui/UnderlineTabs.jsx`

**Purpose:** Renders the tab strip used by alert detail workspaces.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `value` | Undeclared; string | Not declared | None | Selected tab value. |
| `options` | Undeclared; `{ value, label }[]` | Not declared | None | Tab definitions. |
| `onChange` | Undeclared; function | Not declared | None | Receives selected value. |
| `label` | Undeclared; string | Not declared | `'Workspace sections'` | Tablist label. |
| `className` | Undeclared; string | Not declared | None | Additional classes. |

**Usage example:**

```jsx
<UnderlineTabs value="overview" onChange={onChange} options={[{ value:'overview', label:'Overview' }, { value:'evidence', label:'Evidence' }]} />
```

**Variants/states:** Selected/unselected with animated underline position.

**Used in:** Alert Triage.

**Notes:** Uses tab roles and roving `tabIndex` but does not implement arrow-key tab navigation.

### InfoTip

**File location:** `frontend/src/components/InfoTip.jsx`

**Purpose:** Shows a portal-based explanatory tooltip by pointer, focus, or click.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `text` | Undeclared; string | Not declared | None | Tooltip and accessible-label content. |
| `align` | Undeclared; `'left'`/`'center'`/`'right'` | Not declared | `'center'` | Anchor and portal alignment. |

**Usage example:**

```jsx
<InfoTip text="Chronological security events mapped to MITRE ATT&CK stages." />
```

**Variants/states:** Left/center/right, above/below viewport, hidden/visible.

**Used in:** Incidents.

**Notes:** Keyboard focus and Escape are supported; the trigger uses `span role="button"` rather than a native button.

### ConnectorManager

**File location:** `frontend/src/components/admin/ConnectorManager.jsx`

**Purpose:** Provides administrator CRUD, test, activation, disabling, and deletion controls for encrypted Elastic, Splunk, and Wazuh connectors.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| — | — | — | — | The exported component accepts no declared props. |

**Usage example:**

```jsx
<ConnectorManager />
```

**Variants/states:** Loading, manager locked, empty, active/tested/test-failed/needs-test/disabled connector cards, success/error notice, create/edit three-step wizard, and busy actions.

**Used in:** Settings.

**Notes:** Requires a valid 32-byte `CONNECTOR_ENCRYPTION_KEY`. Connector secrets are submitted but never returned; the component confirms deletion with `globalThis.confirm`.

## Feedback & Status

### EmptyState

**File location:** `frontend/src/components/ui/EmptyState.jsx`

**Purpose:** Provides a consistent no-data or unavailable-content state.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `icon` | Undeclared; React component | Not declared | None | Optional decorative icon. |
| `message` | Undeclared; React node/string | Not declared | `'No data in this range'` | Main message. |
| `action` | Undeclared; React node | Not declared | None | Optional action/content below the message. |

**Usage example:**

```jsx
<EmptyState icon={ShieldAlert} message="No data in this range" action={<a href="#filters">Adjust filters</a>} />
```

**Variants/states:** Icon/no icon and action/no action.

**Used in:** Alerts, Assets, Cases, Digital Twin, Incidents, Investigations, Live Monitoring, MITRE Coverage, Security Analytics, Threat Intelligence, entity graph, replay, and triage traces.

**Notes:** `action` accepts any React node; some MITRE error call sites pass plain text, so no interactive retry is produced.

### SkeletonLoader

**File location:** `frontend/src/components/ui/SkeletonLoader.jsx`

**Purpose:** Renders a configurable stack of loading placeholders.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `lines` | Undeclared; number | Not declared | `3` | Number of spans created with `Array.from`. |
| `className` | Undeclared; string | Not declared | None | Additional classes. |

**Usage example:**

```jsx
<SkeletonLoader lines={2} />
```

**Variants/states:** Line count and caller classes.

**Used in:** Shell and nearly every data-loading analyst page.

**Notes:** Has `role="status"` and an accessible label; motion is disabled by the shared reduced-motion media query.

### LiveIndicator

**File location:** `frontend/src/components/ui/LiveIndicator.jsx`

**Purpose:** Marks an active feed or playback with a pulsing dot and label.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `label` | Undeclared; React node/string | Not declared | `'Live'` | Visible label. |

**Usage example:**

```jsx
<LiveIndicator label="Running" />
```

**Variants/states:** Label only; visual pulse is fixed.

**Used in:** Attack Simulator, Digital Twin, Live Monitoring, and replay workspace.

**Notes:** The component itself does not set `role="status"`; callers must provide live-region semantics when needed.

### HeaderStatusChip

**File location:** `frontend/src/components/ui/HeaderStatusChip.jsx`

**Purpose:** Displays a dismissible top-bar warning when dependency health is degraded.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `health` | Undeclared; object/null | Not declared | None | Overall status and per-service status map. |

**Usage example:**

```jsx
<HeaderStatusChip health={platformHealth} />
```

**Variants/states:** Hidden when unknown/healthy, expanded degraded message, and collapsed icon.

**Used in:** `frontend/src/App.jsx`.

**Notes:** After collapse, it renders a noninteractive span and cannot be expanded again during the same browser session.

### ConfidenceGauge

**File location:** `frontend/src/components/ui/ConfidenceGauge.jsx`

**Purpose:** Shows pending or 0–100% model confidence as an accessible radial gauge.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `value` | Undeclared; numeric-compatible | Not declared | None | Rounded and clamped to 0–100; nonfinite is pending. |
| `label` | Undeclared; string | Not declared | `'Awaiting triage'` | Assessment label and accessible text. |
| `className` | Undeclared; string | Not declared | None | Additional classes. |

**Usage example:**

```jsx
<ConfidenceGauge value={84} label="Needs investigation" />
```

**Variants/states:** Pending; low `<40`; review `40–69`; confident `≥70`.

**Used in:** Alert Triage and real-alert replay components.

**Notes:** The value is read from stored verdict/replay data; it is not randomly generated.

### DecisionQualityPanel

**File location:** `frontend/src/components/DecisionQualityPanel.jsx`

**Purpose:** Opens review-coverage and analyst-agreement evidence for 7, 30, or 90 days.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| — | — | — | — | This component accepts no declared props. |

**Usage example:**

```jsx
<DecisionQualityPanel />
```

**Variants/states:** Closed/open dialog, 7/30/90-day range, loading/error/empty/data, and recent review outcomes.

**Used in:** Alert Triage.

**Notes:** Escape and backdrop close are implemented, but focus is neither trapped in nor restored from the modal.

## Charts & Visualizations

### RankedBarList

**File location:** `frontend/src/components/ui/RankedBarList.jsx`

**Purpose:** Renders ranked entities with proportional bars, a primary value, and optional secondary high-risk value.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `data` | Undeclared; object array | Not declared | `[]` | Items must provide `name` and value fields. |
| `valueKey` | Undeclared; string | Not declared | `'count'` | Primary numeric field. |
| `secondaryKey` | Undeclared; string | Not declared | `'high_risk'` | Optional secondary field. |
| `onSelect` | Undeclared; function | Not declared | None | Makes each row a filter button. |
| `ariaLabel` | Undeclared; string | Not declared | None | Ordered-list label. |
| `className` | Undeclared; string | Not declared | None | Additional classes. |

**Usage example:**

```jsx
<RankedBarList data={[{ name:'198.51.100.24', count:18, high_risk:7 }]} ariaLabel="Top source IPs" />
```

**Variants/states:** Static rows or selectable buttons; with/without secondary values.

**Used in:** Security Analytics.

**Notes:** Bar widths animate for 500 ms; reduced-motion CSS disables the transition.

### NetworkTopologyCanvas

**File location:** `frontend/src/components/digital-twin/NetworkTopologyCanvas.jsx`

**Purpose:** Renders validated network nodes and edges with zoom and pan controls.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `nodes` | Undeclared; `NetworkNode[]` | Not declared | `[]` | Positioned, typed, stateful topology nodes. |
| `edges` | Undeclared; `NetworkEdge[]` | Not declared | `[]` | Connections referencing known nodes. |

**Usage example:**

```jsx
<NetworkTopologyCanvas nodes={activeTopology.nodes} edges={activeTopology.edges} />
```

**Variants/states:** Node type/state, edge idle/active/traversed state, zoom `0.65–1.8`, panning, reset.

**Used in:** Digital Twin.

**Notes:** The page derives the topology from stored alerts; the canvas is not connected to a live network discovery system.

### TopologyLegend

**File location:** `frontend/src/components/digital-twin/NetworkTopologyCanvas.jsx`

**Purpose:** Explains compromised, active-path, and contained topology colors.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| — | — | — | — | This component accepts no declared props. |

**Usage example:**

```jsx
<Card title="Network Topology" caption={caption} action={<TopologyLegend />}>
```

**Variants/states:** Fixed legend; no variants.

**Used in:** Digital Twin.

**Notes:** Exported from the canvas module rather than the shared UI barrel.

### MitreKillChain

**File location:** `frontend/src/components/attack-simulator/MitreKillChain.jsx`

**Purpose:** Displays an ordered ATT&CK tactic/technique chain and state transitions.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `stages` | Undeclared; `MitreStage[]` | Not declared | `[]` | Ordered validated stage data. |

**Usage example:**

```jsx
<MitreKillChain stages={mitreStages} />
```

**Variants/states:** Upcoming, in-progress, completed, blocked, and cut link states.

**Used in:** Attack Simulator training and real-alert replay.

**Notes:** Training states come from scripted scenarios; replay states come from recorded mappings and replay progress.

### AlertReplayScene

**File location:** `frontend/src/components/attack-simulator/AlertReplayScene.jsx`

**Purpose:** Visualizes one reconstructed alert/AI phase within the real-alert replay workspace.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `replay` | Undeclared; replay object | Not declared | None | Replay entity, phases, confidence, and evidence context. |
| `event` | Undeclared; replay event | Not declared | None | Current phase/event. |

**Usage example:**

```jsx
<AlertReplayScene replay={replay} event={current || replay.scriptedEvents[0]} />
```

**Variants/states:** Ready plus source, normalization, enrichment, AI, decision, and unavailable phase visuals.

**Used in:** `AlertReplayWorkspace`.

**Notes:** Reconstructs stored provenance and explicitly marks absent phases; it does not rerun the model.

### SimulationResponse

**File location:** `frontend/src/components/attack-simulator/SimulationResponse.jsx`

**Purpose:** Summarizes the deterministic containment result of a training scenario.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `response` | Undeclared; response object | Not declared | None | Derived local simulation outcome and facts. |

**Usage example:**

```jsx
<SimulationResponse response={response} />
```

**Variants/states:** Loading skeleton, in-progress result, blocked/contained result, and confidence display.

**Used in:** Attack Simulator training mode.

**Notes:** This is not the durable Response Simulation page; it is a frontend training outcome derived by `frontend/src/lib/attackSimulation.js`.

### AlertReplayWorkspace

**File location:** `frontend/src/components/attack-simulator/AlertReplayWorkspace.jsx`

**Purpose:** Owns triaged-alert selection, detail/journey loading, replay derivation, URL state, and playback composition for Attack Simulator replay mode.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| — | — | — | — | The exported component accepts no declared props. |

**Usage example:**

```jsx
<AlertReplayWorkspace />
```

**Variants/states:** Selector loading/error/empty/list, detail loading/error, AI-pending alert, ready replay, running, paused, completed, autoplay URL state, and selected phase/event.

**Used in:** Attack Simulator replay mode.

**Notes:** Loads only 12 alerts with `triage_status=triaged`; it reconstructs recorded phases with `buildAlertReplay` and does not execute a new model call.

### RiskTrendChart

**File location:** `frontend/src/components/executive/RiskTrendChart.jsx`

**Purpose:** Renders executive risk exposure, critical-incident creation, and response-time trend cards with Recharts sparklines.

**Props table:**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `data` | Undeclared; daily trend array | Not declared | `[]` | Supplies date, risk score, incident count, and response-time series. |
| `windowDays` | Undeclared; number | Not declared | `30` | Reporting-window label. |
| `responsePerformance` | Undeclared; response summary object/null | Not declared | `null` | Supplies mean response time and measured incident counts. |

**Usage example:**

```jsx
<RiskTrendChart data={overview.risk_trend || []} windowDays={overview.window_days || period} responsePerformance={overview.response_performance} />
```

**Variants/states:** Trustworthy series, missing-series dashed placeholder, measured/unavailable response time, and fixed blue/red/yellow series tones.

**Used in:** Executive Dashboard.

**Notes:** Internal `Sparkline` and `TrendCard` helpers are not exported. Charts are `aria-hidden`; the same values and explanations remain as text.

### Confidence and Recharts Visuals

`ConfidenceGauge`, `KpiTile`, and `RankedBarList` are implemented as shared SVG/CSS primitives above. Security Analytics also defines page-private Recharts compositions; their data sources and behavior are documented in [Security Analytics](PAGES.md#security-analytics).

---

Last updated: 2026-08-26 — generated by direct component signature review, shared-barrel inspection, repository-wide JSX usage search, tests, and CSS audit.
