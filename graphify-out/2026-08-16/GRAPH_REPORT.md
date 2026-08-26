# Graph Report - BMB-soc-agent--main  (2026-08-16)

## Corpus Check
- 282 files · ~207,714 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2415 nodes · 4440 edges · 194 communities (170 shown, 24 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 446 edges (avg confidence: 0.61)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `eeb98c66`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- enrich_event_evidence
- AIConfiguration.jsx
- devDependencies
- src/routes/index.js
- services/alert-retention.js
- autonomous.js
- triage.js
- src/workers/scheduler.js
- dependencies
- hermes/correlation.js
- api/src/index.js
- Cases.jsx
- App.jsx
- BMB Security Operations: Current Project and Technical Summary
- simulation_engine.py
- Dashboard.jsx
- client.js
- admin.js
- ad_generator.py
- activityTitle
- Part 3 — Function Documentation
- soc-tools.js
- src/workers/pipeline.js
- analyst.js
- src.before-elastic-connector-20260713-101839/services/reports.js
- src/services/reports.js
- store.js
- hermes.test.js
- enrichment/src/index.js
- roles.js
- src.before-elastic-connector-20260713-101839/index.js
- auth.js
- chat.js
- services/actions.js
- hermes.js
- ui/index.js
- llm.js
- splunk.js
- How AI Triage, Correlation, Incidents, and Investigations Work
- src.before-elastic-connector-20260713-101839/workers/pipeline.js
- enrichment/package.json
- src.before-elastic-connector-20260713-101839/services/dbtools.js
- migrate.test.js
- schemas.js
- elastic.js
- auth.test.js
- ChatWidget.jsx
- database_generator.py
- 002_hermes_agent_audit.sql
- Phase 7 - Add controlled AI workflow actions
- evaluate.js
- Incidents.jsx
- Alerts.jsx
- BMB SOC Agent: Complete Architecture and Phase Guide
- Phase 3 - Turn chat into a grounded SOC analyst
- src/services/dbtools.js
- src.before-elastic-connector-20260713-101839/routes/index.js
- src.before-elastic-connector-20260713-101839/services/wazuh.js
- src.before-elastic-connector-20260713-101839/workers/correlation.js
- securityVisualization.js
- DigitalTwin.jsx
- Phase 5 - Correlate alerts into incidents
- Phase 0 — Current-State Audit
- App.test.jsx
- Phase 5 — Security Administration Experience
- BMB SOC Agent
- What changed
- api
- src.before-elastic-connector-20260713-101839/services/tools.js
- services/connectors.js
- src/services/tools.js
- check-syntax.js
- export_predictions.js
- src/Reports.jsx
- __init__.py
- choose_user
- BMB SOC Agent: Phase 0 to Phase 4 Project History
- Phase 6 - Make investigations and cases durable
- Phase 0 — Hermes Migration Map
- Required implementation scope
- src/services/wazuh.js
- src.before-elastic-connector-20260713-101839/workers/scheduler.js
- 001_current_schema.sql
- Phase 4 - Hermes Triage Acceptance Gate
- Phase 9 Acceptance Gate
- 006_durable_workflows.sql
- 6. End-to-end system behavior
- 7. Phase-by-phase evolution
- 9. Phase 4 - Hermes-only automated triage
- Phase 2 - Hermes Agent Foundation Acceptance Gate
- Phase 3 — Executive Experience
- Phase 3 - Grounded Hermes Analyst Acceptance Gate
- Splunk integration
- 01_schema.sql
- nginx.test.js
- Phase 0 — Prioritized Issue Backlog
- 10. Operational deployment and troubleshooting completed
- 8. Phase 3 - Grounded Hermes analyst
- Phase 7 Completion Report
- Phase 8 Acceptance Gate
- Phase 8 Completion Report
- Phase 9 Completion Report
- BMB Alert Retention Policy
- 10. Security and reliability model
- 7. Phase 2 - Hermes agent foundation
- Phase 1 — Workflow Provenance Foundation
- Phase 2 — Role-aware frontend foundation
- Phase 4 — Durable Analyst Review
- Phase 5 — Decision Assurance
- Phase 6 — Interface Polish and Workflow Clarity
- ExampleCorp telemetry generators
- linux_generator.py
- 6. Phase 1 - Stabilize and secure the foundation
- Phase 1 Completion Record
- Phase 2 — Explainable AI Triage
- Phase 2 - Completion Record
- Phase 3 — Explainable Correlation and Incident Decisions
- Phase 3 - Completion Record
- Phase 5 Completion — Hermes Correlation
- Phase 6 Acceptance Gate
- Phase 6 Completion Report
- Phase 7 Acceptance Gate
- 8. What the AI can do now
- Phase 0 — Feature Completion Matrix
- 5. Phase 0 - Audit and roadmap
- Phase 4 Completion Record
- Phase 5 Acceptance Gate
- autonomous_runs
- 011_executive_metrics.sql
- 14. How to explain the project
- Phase 0 - Audit reality before adding automation
- scenario_engine.py
- Phase 2 - Establish Hermes as the shared AI boundary
- executive.js
- Phase 4 - Move automated alert triage to Hermes
- health.js
- NetworkTopologyCanvas.jsx
- scenario_runner.py
- 11. End-to-end logic at Phase 4
- 13. Security and trust model
- SOC Analytics and Entity Relationship Map
- 15. What is real, what remains limited
- 19. Next work
- AGENTS.md
- 012_database_rbac_users.sql
- 016_alert_retention.sql
- 018_analyst_decision_reviews.sql
- postgres/03_triage_cache.sql
- init/03_triage_cache.sql
- alerts
- incidents
- incidents
- alerts
- alerts
- incidents
- alerts
- alerts
- incidents
- alerts
- fetch_runs
- triage_cache
- webapp_generator.py
- Investigations.jsx
- email_generator.py
- Dashboard-managed security connectors
- Phase 8 - Add the proactive autonomous SOC worker
- behavior_engine.py
- src/db/index.js
- pages/Reports.jsx
- Phase 9 - Add approval-gated response simulation
- 020_managed_connectors.sql
- HeaderStatusChip.jsx

## God Nodes (most connected - your core abstractions)
1. `choose_user()` - 59 edges
2. `api()` - 57 edges
3. `fmtTs()` - 35 edges
4. `cx()` - 28 edges
5. `enrich_event_evidence()` - 26 edges
6. `runtimeConfig()` - 25 edges
7. `activityTitle()` - 25 edges
8. `humanize()` - 24 edges
9. `alertReference()` - 22 edges
10. `add_endpoint_context()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `EntityRelationshipGraph()` --indirect_call--> `incident()`  [INFERRED]
  frontend/src/components/EntityRelationshipGraph.jsx → api/test/correlation-worker.test.js
- `IncidentSelection()` --indirect_call--> `incident()`  [INFERRED]
  frontend/src/pages/Incidents.jsx → api/test/correlation-worker.test.js
- `createAgentStore()` --indirect_call--> `beginTriage()`  [INFERRED]
  api/src/services/hermes/store.js → api/test/hermes-triage.test.js
- `add_endpoint_context()` --calls--> `related_for_user_host()`  [INFERRED]
  generators/edr_generator.py → generators/common_inventory.py
- `createApp()` --indirect_call--> `requireAuth()`  [INFERRED]
  api/src/index.js → api/src/middleware/auth.js

## Import Cycles
- None detected.

## Communities (194 total, 24 thin omitted)

### Community 0 - "enrich_event_evidence"
Cohesion: 0.16
Nodes (16): _artifact_hex(), enrich_event_evidence(), _ensure_ad(), _ensure_database(), _ensure_edr(), _ensure_email(), _ensure_hashes(), _ensure_linux() (+8 more)

### Community 1 - "AIConfiguration.jsx"
Cohesion: 0.05
Nodes (44): ConnectorManager(), connectorTone(), ConnectorWizard(), initialForm(), PLATFORMS, StatusBadge(), fmtDuration(), AIConfiguration() (+36 more)

### Community 2 - "devDependencies"
Cohesion: 0.04
Nodes (46): autoprefixer, clsx, date-fns, eslint, eslint-plugin-react, dependencies, clsx, date-fns (+38 more)

### Community 3 - "src/routes/index.js"
Cohesion: 0.05
Nodes (45): actions, { activeConnector }, admin, ANALYST_READ_PREFIXES, ANALYST_REVIEW_DECISIONS, ANALYTICS_WINDOWS, BOOLEAN_SETTINGS, boundedPressure() (+37 more)

### Community 4 - "services/alert-retention.js"
Cohesion: 0.16
Nodes (21): db, main(), { runRetention }, assertMode(), boundedInteger(), db, eligibilitySql(), finishRun() (+13 more)

### Community 5 - "autonomous.js"
Cohesion: 0.08
Nodes (35): actionSummary(), alertNote(), boundedConfidence(), boundedInt(), compact(), { createActionService }, crypto, db (+27 more)

### Community 6 - "triage.js"
Cohesion: 0.09
Nodes (33): combinedSignal(), validateCitations(), publicAlert(), sanitize(), { combinedSignal }, { createAgentStore }, { createSocToolkit, publicAlert, sanitize }, crypto (+25 more)

### Community 7 - "src/workers/scheduler.js"
Cohesion: 0.24
Nodes (13): collectionIntervalMs(), cron, cronExpr(), db, executeCollection(), executeProcessing(), executeRetention(), publicError() (+5 more)

### Community 8 - "dependencies"
Cohesion: 0.05
Nodes (37): ajv, dependencies, ajv, cors, express, express-rate-limit, helmet, morgan (+29 more)

### Community 9 - "hermes/correlation.js"
Cohesion: 0.09
Nodes (30): combinedSignal(), connectedGroup(), correlateHermes(), correlationInput(), { createAgentStore }, crypto, { defaultHermesClient }, derivedSeverity() (+22 more)

### Community 10 - "api/src/index.js"
Cohesion: 0.10
Nodes (24): app, { authRouter, requireAuth, requireCsrf }, { bootstrapUserDirectory }, cors, createApp(), crypto, db, express (+16 more)

### Community 11 - "Cases.jsx"
Cohesion: 0.20
Nodes (16): AssetBrief(), DeepDiveDrawer(), drawerCopy(), impactOf(), impactTone(), IncidentBrief(), RiskDirectory(), riskSummary() (+8 more)

### Community 12 - "App.jsx"
Cohesion: 0.06
Nodes (27): AIConfiguration, AITriage, Alerts, Approvals, Assets, AttackSimulator, AuditGovernance, Cases (+19 more)

### Community 13 - "BMB Security Operations: Current Project and Technical Summary"
Cohesion: 0.06
Nodes (30): 10. Retention and operational controls, 11. What is real and what remains limited, 12. Current verification status, 13. Simple explanation for a demonstration, 1. Project overview, 2. Architecture, 3. Authentication and role separation, 4. Alert lifecycle (+22 more)

### Community 14 - "simulation_engine.py"
Cohesion: 0.10
Nodes (26): choose_event(), main(), choose_event(), main(), choose_event(), main(), alert_probability(), burst_multiplier() (+18 more)

### Community 15 - "Dashboard.jsx"
Cohesion: 0.09
Nodes (19): ExecutiveAiValue(), ExecutiveBriefing(), ExecutiveDataTrust(), status(), ExecutiveDecisionQueue(), display(), ExecutiveKpiGrid(), MetricCard() (+11 more)

### Community 16 - "client.js"
Cohesion: 0.08
Nodes (28): authAccounts(), boundedInt(), fs, runtimeConfig(), validateStartupConfig(), validHttpUrl(), crypto, { defaultHermesClient } (+20 more)

### Community 17 - "admin.js"
Cohesion: 0.10
Nodes (24): AUTH_ROLES, { activeConnector, managerAvailable }, AUDIT_OUTCOMES, {
  CONFIRMATION: RETENTION_CONFIRMATION,
  policyFromSettings,
  previewRetention,
  recentRetentionRuns,
  runRetention,
}, connectorRoutes, db, { defaultHermesClient }, {
  displayNameError,
  hashPassword,
  passwordError,
  publicUser,
  roleError,
  usernameError,
} (+16 more)

### Community 18 - "ad_generator.py"
Cohesion: 0.21
Nodes (20): account_lockout(), add_user_context(), base_event(), campaign(), dcsync(), failed_logon(), kerberoasting(), kerberos_authentication() (+12 more)

### Community 19 - "activityTitle"
Cohesion: 0.18
Nodes (26): EntityRelationshipGraph(), incidentReference(), normalized(), RELATION_FIELDS, relationToIndicator(), sharedRelations(), activityTitle(), alertReference() (+18 more)

### Community 20 - "Part 3 — Function Documentation"
Cohesion: 0.06
Nodes (34): 1.1 Services, 1.2 Pipeline lifecycle (per cron cycle), 1.3 Alert state machine, 1.4 Where the LLM is used today, 1.5 What already works well (keep), 1.6 Weaknesses (drive the roadmap), 3.10 `api/src/workers/scheduler.js` — cron & manual execution, 3.11 `api/src/routes/index.js` — REST API surface (+26 more)

### Community 21 - "soc-tools.js"
Cohesion: 0.07
Nodes (19): HermesError, publicHermesError(), { ActionError, createActionService, stableKey }, { activeConnector }, Ajv, createSocToolkit(), db, elastic (+11 more)

### Community 22 - "src/workers/pipeline.js"
Cohesion: 0.09
Nodes (29): alertSignature(), crypto, { activeConnector }, { alertSignature }, { correlatePending }, crypto, db, enrichAlert() (+21 more)

### Community 23 - "analyst.js"
Cohesion: 0.29
Nodes (12): ALERT_VIEW_STORAGE_KEY, createInitialAlertView(), DEFAULT_ALERT_FILTERS, normalizeCitations(), normalizeTextList(), readBrowserAlertView(), sanitizeFilters(), text() (+4 more)

### Community 24 - "src.before-elastic-connector-20260713-101839/services/reports.js"
Cohesion: 0.25
Nodes (22): alertAggregates(), alertsDetailed(), alertsSummary(), COLORS, db, finalize(), fmt(), footer() (+14 more)

### Community 25 - "src/services/reports.js"
Cohesion: 0.25
Nodes (22): alertAggregates(), alertsDetailed(), alertsSummary(), COLORS, db, finalize(), fmt(), footer() (+14 more)

### Community 26 - "store.js"
Cohesion: 0.17
Nodes (6): crypto, db, { HermesError }, assert, { createAgentStore }, test

### Community 27 - "hermes.test.js"
Cohesion: 0.13
Nodes (19): createAgentStore(), assert, attachHermesRun(), beginChat(), beginToolCall(), { chatHermes, specsForAuthorization }, completeChat(), completeToolCall() (+11 more)

### Community 28 - "enrichment/src/index.js"
Cohesion: 0.10
Nodes (17): AD_GROUPS, AD_USERS, app, CMDB_HOST, CMDB_IP, CMDB_LIST, DATA, EDR_AGENTS (+9 more)

### Community 29 - "roles.js"
Cohesion: 0.22
Nodes (14): Shell(), PermissionGuard(), ICONS, RoleAwareSidebar(), canAccessRoute(), getRoleLanding(), getRoleNavigation(), normalizeRole() (+6 more)

### Community 30 - "src.before-elastic-connector-20260713-101839/index.js"
Cohesion: 0.22
Nodes (9): app, cors, db, express, main(), morgan, routes, scheduler (+1 more)

### Community 31 - "auth.js"
Cohesion: 0.20
Nodes (20): { authenticateUser, currentSessionUser, publicUser }, authRouter(), clearSessionCookie(), cookieOptions(), crypto, digest(), equalSecret(), parseCookies() (+12 more)

### Community 32 - "chat.js"
Cohesion: 0.18
Nodes (18): authoritativeRuntimeTurn(), chatHermes(), { createAgentStore }, { createSocToolkit, compactText, sanitize }, crypto, { defaultHermesClient }, evidenceKey(), groupedEvidence() (+10 more)

### Community 33 - "services/actions.js"
Cohesion: 0.05
Nodes (35): requireRoles(), { ActionError, POLICY, POLICY_VERSION, createActionService }, actions, db, { requireRoles }, { Router }, STATUSES, { ActionError, createActionService } (+27 more)

### Community 34 - "hermes.js"
Cohesion: 0.13
Nodes (19): listAiModelProfiles(), modelIdentity(), PROFILE_DEFINITIONS, profileDefinition(), publicProfile(), resolveAiModelProfile(), routingOptions(), { runtimeConfig } (+11 more)

### Community 35 - "ui/index.js"
Cohesion: 0.10
Nodes (26): connectionState(), MitreKillChain(), StageConnection(), tacticIcon(), SimulationResponse(), Card(), clamp(), ConfidenceGauge() (+18 more)

### Community 36 - "llm.js"
Cohesion: 0.22
Nodes (16): chatAgent(), chatJSON(), compactAlert(), correlateAlerts(), extractJSON(), investigateAlert(), normalizeStage(), parseArgs() (+8 more)

### Community 37 - "splunk.js"
Cohesion: 0.09
Nodes (55): changed(), db, loadCandidates(), main(), { normalizeAlert }, updateAlert(), { checkHealth, fetchAlerts, validateConfiguration }, main() (+47 more)

### Community 38 - "How AI Triage, Correlation, Incidents, and Investigations Work"
Cohesion: 0.06
Nodes (30): 10. When investigations are created, 11. What “autonomous investigation” does and does not mean, 12. How we know the AI is actually analyzing evidence, 13. What is deterministic and what is AI-generated, 14. Simple example, 15. How analysts should verify a result, 1. When AI triage starts, 2. What the AI receives during triage (+22 more)

### Community 39 - "src.before-elastic-connector-20260713-101839/workers/pipeline.js"
Cohesion: 0.22
Nodes (14): alertSignature(), crypto, { alertSignature }, { correlatePending, promoteSingletons }, db, enrichAlert(), enrichPending(), { fetchAlerts } (+6 more)

### Community 40 - "enrichment/package.json"
Cohesion: 0.12
Nodes (15): dependencies, express, description, engines, node, express, main, name (+7 more)

### Community 41 - "src.before-elastic-connector-20260713-101839/services/dbtools.js"
Cohesion: 0.13
Nodes (5): db, { Pool }, CHAT_TOOLS, db, HANDLERS

### Community 42 - "migrate.test.js"
Cohesion: 0.16
Nodes (10): fs, migrationFiles(), MIGRATIONS_DIR, path, runMigrations(), assert, fs, { migrationFiles, runMigrations } (+2 more)

### Community 43 - "schemas.js"
Cohesion: 0.21
Nodes (14): Ajv, CORRELATION_SEVERITIES, EVIDENCE_TYPES, { HermesError }, parseAnalystTurn(), parseChatOutput(), parseCorrelationOutput(), parseJsonOutput() (+6 more)

### Community 44 - "elastic.js"
Cohesion: 0.09
Nodes (35): {
  buildGroupKey,
}, db, main(), main(), {
  searchAlerts,
}, {
  buildGroupKey,
}, checkHealth(), connectionConfig() (+27 more)

### Community 45 - "auth.test.js"
Cohesion: 0.15
Nodes (10): assert, authApp(), {
  bootstrapUserDirectory,
  hashPassword,
  verifyPassword,
}, { createApp }, db, installDirectory(), login(), request (+2 more)

### Community 46 - "ChatWidget.jsx"
Cohesion: 0.20
Nodes (9): ChatWidget(), conversationStorageKey(), DEFAULT_SUGGESTIONS, PAGE_SUGGESTIONS, readConversationId(), suggestionsFor(), settle(), submit() (+1 more)

### Community 47 - "database_generator.py"
Cohesion: 0.35
Nodes (14): add_database_context(), base_event(), campaign(), choose_event(), database_login(), destructive_action(), large_data_export(), main() (+6 more)

### Community 48 - "002_hermes_agent_audit.sql"
Cohesion: 0.16
Nodes (15): action_approvals, action_requests, action_requests_updated_at, agent_conversations, agent_conversations_updated_at, agent_evidence_links, agent_messages, agent_runs (+7 more)

### Community 49 - "Phase 7 - Add controlled AI workflow actions"
Cohesion: 0.50
Nodes (4): Phase 7 - Add controlled AI workflow actions, Problem, What the phase did, Why it mattered

### Community 50 - "evaluate.js"
Cohesion: 0.26
Nodes (12): buildReport(), { classifyMetrics, pairwiseClusterMetrics, efficiencyMetrics }, demoData(), fs, loadJSON(), main(), pct(), printReport() (+4 more)

### Community 51 - "Incidents.jsx"
Cohesion: 0.18
Nodes (15): AnalystDecisionReview(), decisionLabel(), OPTIONS, InfoTip(), Button(), compactTime(), correlatedCount(), entityCounts() (+7 more)

### Community 52 - "Alerts.jsx"
Cohesion: 0.16
Nodes (23): confidence(), displayExecutor(), displayValue(), latestByStage(), object(), RecordedDetails(), STAGES, STATUS_ICON (+15 more)

### Community 53 - "BMB SOC Agent: Complete Architecture and Phase Guide"
Cohesion: 0.12
Nodes (16): 11. Lab data and demonstration scenarios, 12. What appears in each main dashboard area, 13. Current limitations and truthful final state, 15. Final architecture outcome, 1. Purpose, 2. The project in one minute, 3. Architecture at a glance, 4. Main components and responsibilities (+8 more)

### Community 54 - "Phase 3 - Turn chat into a grounded SOC analyst"
Cohesion: 0.50
Nodes (4): Phase 3 - Turn chat into a grounded SOC analyst, Problem, What the phase did, Why it mattered

### Community 55 - "src/services/dbtools.js"
Cohesion: 0.17
Nodes (3): CHAT_TOOLS, db, HANDLERS

### Community 56 - "src.before-elastic-connector-20260713-101839/routes/index.js"
Cohesion: 0.20
Nodes (7): { chatAgent }, db, r, reports, { Router }, { runCycle, enrichPending, triagePending, correlatePending }, scheduler

### Community 57 - "src.before-elastic-connector-20260713-101839/services/wazuh.js"
Cohesion: 0.31
Nodes (9): extractEntities(), extractMitre(), fetchAlerts(), fetchFromWazuh(), GROUP_TECHNIQUE, https, makeMock(), normalizeAlert() (+1 more)

### Community 58 - "src.before-elastic-connector-20260713-101839/workers/correlation.js"
Cohesion: 0.29
Nodes (9): { correlateAlerts }, correlatePending(), crypto, db, incidentKey(), maxSeverity(), promoteSingletons(), SEV_ORDER (+1 more)

### Community 59 - "securityVisualization.js"
Cohesion: 0.12
Nodes (37): createSynchronizedEventController(), immutableSnapshot(), initialSnapshot(), useSynchronizedEventStream(), ATTACK_SCENARIOS, attackScenarioById(), deriveMitreProgress(), deriveSimulationResponse() (+29 more)

### Community 60 - "DigitalTwin.jsx"
Cohesion: 0.18
Nodes (12): EmptyState(), alertId(), DigitalTwin(), EMPTY_TOPOLOGY, EVENT_ICONS, eventTime(), bucketLabel(), compactNumber() (+4 more)

### Community 61 - "Phase 5 - Correlate alerts into incidents"
Cohesion: 0.50
Nodes (4): Phase 5 - Correlate alerts into incidents, Problem, What the phase did, Why it mattered

### Community 62 - "Phase 0 — Current-State Audit"
Cohesion: 0.12
Nodes (16): API inventory, Confirmed findings, Critical, Current architecture, Data inventory, Enrichment datasets, Executive verdict, Hermes audit (+8 more)

### Community 63 - "App.test.jsx"
Cohesion: 0.25
Nodes (3): App(), renderAt(), settle()

### Community 64 - "Phase 5 — Security Administration Experience"
Cohesion: 0.12
Nodes (16): Administrator information architecture, AI Configuration, Audit & Governance, Collector Health, Configuration integrity, Data Retention, Integrations, Intentional limitations (+8 more)

### Community 65 - "BMB SOC Agent"
Cohesion: 0.12
Nodes (16): Alert-source modes, Authentication and security, BMB SOC Agent, Database lifecycle, Elastic Security, Health and metrics, Hermes grounded analyst, triage, and correlation setup, Important UI behavior (+8 more)

### Community 66 - "What changed"
Cohesion: 0.12
Nodes (15): Authorization boundary, Cases, Deferred backend work, Existing contracts preserved, Human Review Queue, Incident Command, Investigations, Monitoring (+7 more)

### Community 68 - "api"
Cohesion: 0.11
Nodes (26): AuthenticatedApp(), DECISION_LABELS, DecisionQualityPanel(), metric(), confidence(), IncidentCorrelationTrace(), label(), latest() (+18 more)

### Community 69 - "src.before-elastic-connector-20260713-101839/services/tools.js"
Cohesion: 0.60
Nodes (5): dispatch(), enrichmentUrl(), get(), post(), TRIAGE_TOOLS

### Community 70 - "services/connectors.js"
Cohesion: 0.10
Nodes (32): actor(), audit(), db, { Router }, {
  SELECT_COLUMNS,
  configHash,
  decryptSecrets,
  encryptSecrets,
  listConnectors,
  managerAvailable,
  publicConnector,
  safeConnectorError,
  testConnection,
  validateConnectorInput,
}, unavailable(), boundedPort(), boundedText() (+24 more)

### Community 71 - "src/services/tools.js"
Cohesion: 0.60
Nodes (5): dispatch(), enrichmentUrl(), get(), post(), TRIAGE_TOOLS

### Community 72 - "check-syntax.js"
Cohesion: 0.40
Nodes (3): fs, path, { spawnSync }

### Community 73 - "export_predictions.js"
Cohesion: 0.67
Nodes (3): BASE, getJSON(), main()

### Community 80 - "choose_user"
Cohesion: 0.30
Nodes (25): choose_user(), add_endpoint_context(), add_policy_context(), add_process(), authorized_admin_maintenance(), base_event(), c2_connection(), campaign() (+17 more)

### Community 81 - "BMB SOC Agent: Phase 0 to Phase 4 Project History"
Cohesion: 0.17
Nodes (11): 12. Data model evolution, 14. Code areas changed across the phases, 16. Why the phases were separated, 17. Verification progression, 18. Current branch and milestone history, 1. Purpose of this document, 20. Final outcome, 2. Executive summary (+3 more)

### Community 82 - "Phase 6 - Make investigations and cases durable"
Cohesion: 0.50
Nodes (4): Phase 6 - Make investigations and cases durable, Problem, What the phase did, Why it mattered

### Community 83 - "Phase 0 — Hermes Migration Map"
Cohesion: 0.18
Nodes (10): Configuration removal map, Current-to-target call map, Existing tools that can be adapted, Hermes capability handshake required, Migration acceptance conditions, Phase 0 — Hermes Migration Map, Required end state, Target agent records (+2 more)

### Community 84 - "Required implementation scope"
Cohesion: 0.18
Nodes (10): Acceptance tests, API correctness, Configuration, Database lifecycle, Frontend reliability, Health and observability, Immediate safety, Phase 1 — Entry Scope and Acceptance Gate (+2 more)

### Community 85 - "src/services/wazuh.js"
Cohesion: 0.23
Nodes (14): checkHealth(), connectionConfig(), extractEntities(), extractMitre(), fetchAlerts(), fetchFromWazuh(), fs, GROUP_TECHNIQUE (+6 more)

### Community 86 - "src.before-elastic-connector-20260713-101839/workers/scheduler.js"
Cohesion: 0.29
Nodes (8): cron, cronExpr(), db, _execute(), restart(), { runCycle }, start(), triggerNow()

### Community 87 - "001_current_schema.sql"
Cohesion: 0.22
Nodes (8): alerts, alerts_updated_at, fetch_runs, incidents, incidents_updated_at, settings, set_updated_at, triage_cache

### Community 88 - "Phase 4 - Hermes Triage Acceptance Gate"
Cohesion: 0.20
Nodes (9): Automated gate, Completion rule, Live server deployment gate, Persistence and cache safety, Phase 4 - Hermes Triage Acceptance Gate, Runtime cutover, Safety policy, Schema, evidence, and tools (+1 more)

### Community 89 - "Phase 9 Acceptance Gate"
Cohesion: 0.20
Nodes (9): 1. Deploy the branch, 2. Verify the policy and default, 3. Exercise a chatbot proposal, 4. Exercise autonomous proposal generation, 5. Exercise rollback, 6. Database reconciliation, 7. External no-change assertion, Acceptance result (+1 more)

### Community 90 - "006_durable_workflows.sql"
Cohesion: 0.28
Nodes (8): case_notes, investigation_alerts, investigation_notes, investigations, investigations_updated_at, alerts, incidents, set_updated_at

### Community 91 - "6. End-to-end system behavior"
Cohesion: 0.22
Nodes (9): 6.1 Alert collection and storage, 6.2 Enrichment, 6.3 Hermes triage, 6.4 Correlation, 6.5 Autonomous investigation work, 6.6 Approval and Response Lab, 6.7 Analyst chatbot, 6.8 Non-alert raw-event investigation (+1 more)

### Community 92 - "7. Phase-by-phase evolution"
Cohesion: 0.22
Nodes (9): 7. Phase-by-phase evolution, Final lab extension - Realistic coordinated telemetry and raw evidence, Phase 1 - Secure and stabilize the foundation, Problem, Problem, What the extension did, What the phase did, Why it mattered (+1 more)

### Community 93 - "9. Phase 4 - Hermes-only automated triage"
Cohesion: 0.22
Nodes (9): 9. Phase 4 - Hermes-only automated triage, Evidence and session isolation, Exact cache identity, Non-technical explanation, Safety outcome, Technical/code changes, The three triage modes, Verification (+1 more)

### Community 94 - "Phase 2 - Hermes Agent Foundation Acceptance Gate"
Cohesion: 0.22
Nodes (8): Automated verification gate, Configuration gate, Deployment verification gate, Durable records, Phase 2 - Hermes Agent Foundation Acceptance Gate, Required contract, Scope, UI contract

### Community 95 - "Phase 3 — Executive Experience"
Cohesion: 0.22
Nodes (8): API contract extension, Deferred backend improvements, Frontend architecture, Outcome, Phase 3 — Executive Experience, Trust boundaries, Validation, What the executive sees

### Community 96 - "Phase 3 - Grounded Hermes Analyst Acceptance Gate"
Cohesion: 0.22
Nodes (8): Automated gate, Completion rule, Grounding and persistence, Live server deployment gate, Phase 3 - Grounded Hermes Analyst Acceptance Gate, Scope, Streaming and cancellation, Tool boundary

### Community 97 - "Splunk integration"
Cohesion: 0.20
Nodes (9): Collection semantics, Environment fallback, Purpose, Recommended dashboard setup, Required Splunk access, Splunk integration, TLS, Troubleshooting (+1 more)

### Community 98 - "01_schema.sql"
Cohesion: 0.25
Nodes (7): alerts, alerts_updated_at, fetch_runs, incidents, incidents_updated_at, settings, set_updated_at

### Community 101 - "Phase 0 — Prioritized Issue Backlog"
Cohesion: 0.25
Nodes (7): Phase 0 — Prioritized Issue Backlog, Phase 1 — Stabilize and secure the foundation, Phase 2 — Hermes-only client foundation, Phase 3 — Grounded Hermes analyst, Phase 4 — Hermes triage, Phase 5 — Hermes correlation, Phase 6 onward — Durable workflows and design completion

### Community 102 - "10. Operational deployment and troubleshooting completed"
Cohesion: 0.25
Nodes (8): 10. Operational deployment and troubleshooting completed, API startup credentials, Chatbot validation, Dashboard visibility problem, Hermes installation and gateway, PostgreSQL authentication, Real Elastic Security connection, Unsafe Hermes tools

### Community 103 - "8. Phase 3 - Grounded Hermes analyst"
Cohesion: 0.25
Nodes (8): 8. Phase 3 - Grounded Hermes analyst, BMB-owned read-only tools, Logical changes, Non-technical explanation, Security controls, Technical/code changes, Verification, Why we did it

### Community 104 - "Phase 7 Completion Report"
Cohesion: 0.25
Nodes (7): Action policy, API surface, Deliberately deferred beyond Phase 7, Failure behavior, Outcome, Phase 7 Completion Report, Technical implementation

### Community 105 - "Phase 8 Acceptance Gate"
Cohesion: 0.25
Nodes (7): Automated gate, Controlled first run, Deploy without enabling automation, Evidence checks, Pass criteria, Phase 8 Acceptance Gate, Readiness check

### Community 106 - "Phase 8 Completion Report"
Cohesion: 0.25
Nodes (7): API and UI, Autonomous decision policy, Durable records, Operational flow, Outcome, Phase 8 Completion Report, Retry and failure safety

### Community 107 - "Phase 9 Completion Report"
Cohesion: 0.25
Nodes (7): API surface, Local verification, Outcome, Phase 9 Completion Report, Safety boundary, Technical implementation, Why this phase exists

### Community 108 - "BMB Alert Retention Policy"
Cohesion: 0.29
Nodes (6): Active lifecycle, BMB Alert Retention Policy, Evidence protection, One-time cleanup, Purpose, Safety boundary

### Community 109 - "10. Security and reliability model"
Cohesion: 0.29
Nodes (7): 10. Security and reliability model, Authentication, Failure behavior, Grounding and prompt-injection resistance, Read-only Elastic access, Safe Hermes profile, Safe writes

### Community 110 - "7. Phase 2 - Hermes agent foundation"
Cohesion: 0.29
Nodes (7): 7. Phase 2 - Hermes agent foundation, Logical changes, Non-technical explanation, Technical/code changes, Verification, Why Hermes remained tool-less, Why we did it

### Community 111 - "Phase 1 — Workflow Provenance Foundation"
Cohesion: 0.29
Nodes (6): Phase 1 — Workflow Provenance Foundation, Purpose, Read-only analyst contracts, Recording behavior, What is intentionally deferred, What is stored

### Community 112 - "Phase 2 — Role-aware frontend foundation"
Cohesion: 0.29
Nodes (6): Implemented, Navigation currently exposed, Phase 2 — Role-aware frontend foundation, Preserved contracts, Purpose, Security boundary

### Community 113 - "Phase 4 — Durable Analyst Review"
Cohesion: 0.29
Nodes (6): Backend contract, Phase 4 — Durable Analyst Review, Review decisions, Safety boundary, What changed, Why this matters

### Community 114 - "Phase 5 — Decision Assurance"
Cohesion: 0.29
Nodes (6): Analyst experience, API, Calculation boundary, Phase 5 — Decision Assurance, Purpose, Safety

### Community 115 - "Phase 6 — Interface Polish and Workflow Clarity"
Cohesion: 0.29
Nodes (6): AI limitations, Backend compatibility, Correlation backlog repair, Correlation honesty, Phase 6 — Interface Polish and Workflow Clarity, What changed

### Community 116 - "ExampleCorp telemetry generators"
Cohesion: 0.29
Nodes (6): AI investigation of non-alert events, Evidence-rich telemetry, ExampleCorp telemetry generators, Send a coordinated exercise, Validate without sending, What changed

### Community 117 - "linux_generator.py"
Cohesion: 0.35
Nodes (14): add_linux_context(), base_event(), campaign(), choose_linux_host(), credential_access_linux(), cron_persistence(), now_iso(), package_install() (+6 more)

### Community 118 - "6. Phase 1 - Stabilize and secure the foundation"
Cohesion: 0.33
Nodes (6): 6. Phase 1 - Stabilize and secure the foundation, Logical changes, Non-technical explanation, Technical/code changes, Verification, Why we did it

### Community 119 - "Phase 1 Completion Record"
Cohesion: 0.33
Nodes (5): Environment-only release verification, Phase 1 Completion Record, Repository scope completed, Scope boundary, Verified gates

### Community 120 - "Phase 2 — Explainable AI Triage"
Cohesion: 0.33
Nodes (5): Phase 2 — Explainable AI Triage, Progressive disclosure, Scope boundary, Trust behavior, What analysts can now see

### Community 121 - "Phase 2 - Completion Record"
Cohesion: 0.33
Nodes (5): Completed application scope, Honest deployment boundary, Later-phase boundary, Phase 2 - Completion Record, Verified automated gates

### Community 122 - "Phase 3 — Explainable Correlation and Incident Decisions"
Cohesion: 0.33
Nodes (5): Backend contract, Decision boundary, Historical behavior, Phase 3 — Explainable Correlation and Incident Decisions, What analysts can now see

### Community 123 - "Phase 3 - Completion Record"
Cohesion: 0.33
Nodes (5): Completed application scope, Honest deployment boundary, Later-phase boundary, Phase 3 - Completion Record, Verified automated gates

### Community 124 - "Phase 5 Completion — Hermes Correlation"
Cohesion: 0.33
Nodes (5): Implemented, Outcome, Phase 5 Completion — Hermes Correlation, Safety boundary, Verification

### Community 125 - "Phase 6 Acceptance Gate"
Cohesion: 0.33
Nodes (5): Phase 6 Acceptance Gate, Required outcomes, Safety boundary, Scope, Verification gate

### Community 126 - "Phase 6 Completion Report"
Cohesion: 0.33
Nodes (5): API surface, Deliberately deferred, Phase 6 Completion Report, What changed, Why

### Community 127 - "Phase 7 Acceptance Gate"
Cohesion: 0.33
Nodes (5): Automated gate, Pass criteria, Phase 7 Acceptance Gate, Server deployment check, UI and chatbot acceptance

### Community 128 - "8. What the AI can do now"
Cohesion: 0.40
Nodes (5): 8. What the AI can do now, Automated pipeline capabilities, Capabilities the AI does not have, Human-only decisions, Interactive analyst capabilities

### Community 129 - "Phase 0 — Feature Completion Matrix"
Cohesion: 0.40
Nodes (4): Backend capabilities, Browser-local state that must move server-side, Frontend, Phase 0 — Feature Completion Matrix

### Community 130 - "5. Phase 0 - Audit and roadmap"
Cohesion: 0.40
Nodes (5): 5. Phase 0 - Audit and roadmap, How we documented it, Non-technical explanation, What we found, Why we did it

### Community 131 - "Phase 4 Completion Record"
Cohesion: 0.40
Nodes (4): External validation boundary, Implemented, Local verification - 2026-07-16, Phase 4 Completion Record

### Community 132 - "Phase 5 Acceptance Gate"
Cohesion: 0.40
Nodes (4): Automated gate, Deployment gate, Phase 5 Acceptance Gate, Rollback

### Community 133 - "autonomous_runs"
Cohesion: 0.67
Nodes (3): autonomous_operations, autonomous_runs, fetch_runs

### Community 134 - "011_executive_metrics.sql"
Cohesion: 0.50
Nodes (3): business_service_mappings, business_service_mappings_updated_at, set_updated_at

### Community 135 - "14. How to explain the project"
Cohesion: 0.50
Nodes (4): 14. How to explain the project, The key sentence to remember, Thirty-second explanation, Two-minute explanation

### Community 136 - "Phase 0 - Audit reality before adding automation"
Cohesion: 0.50
Nodes (4): Phase 0 - Audit reality before adding automation, Problem, What the phase did, Why it mattered

### Community 137 - "scenario_engine.py"
Cohesion: 0.18
Nodes (10): workstation_host_doc(), build_scenario(), _correlate(), find_user(), _iso(), _policy_record(), Build one finite scenario and return ``[(source, event), ...]``., Return an existing inventory user without changing the inventory. (+2 more)

### Community 138 - "Phase 2 - Establish Hermes as the shared AI boundary"
Cohesion: 0.50
Nodes (4): Phase 2 - Establish Hermes as the shared AI boundary, Problem, What the phase did, Why it mattered

### Community 139 - "executive.js"
Cohesion: 0.13
Nodes (29): AgentPerformanceHub(), sourceLabel(), STAGES, BusinessAssetList(), ACTION_LABELS, affectedEntity(), asNumber(), businessAssetLabel() (+21 more)

### Community 140 - "Phase 4 - Move automated alert triage to Hermes"
Cohesion: 0.50
Nodes (4): Phase 4 - Move automated alert triage to Hermes, Problem, What the phase did, Why it mattered

### Community 141 - "health.js"
Cohesion: 0.24
Nodes (9): activeConnector(), { activeConnector }, { checkHermesHealth }, db, dependencyHealth(), elastic, splunk, timedCheck() (+1 more)

### Community 142 - "NetworkTopologyCanvas.jsx"
Cohesion: 0.29
Nodes (8): edgePath(), LEGEND, NetworkTopologyCanvas(), NODE_ICONS, shorten(), nodes, TopologyLegend(), TopologyNode()

### Community 144 - "scenario_runner.py"
Cohesion: 0.24
Nodes (11): _background_alert(), _background_normal(), compose_run(), is_alert(), main(), parse_args(), Compose scenario records plus realistic background noise., send_records() (+3 more)

### Community 145 - "11. End-to-end logic at Phase 4"
Cohesion: 0.50
Nodes (4): 11. End-to-end logic at Phase 4, Alert collection flow, Analyst-chat flow, Automated-triage flow

### Community 146 - "13. Security and trust model"
Cohesion: 0.50
Nodes (4): 13. Security and trust model, Explicitly prohibited capabilities, Trusted components, Untrusted inputs

### Community 147 - "SOC Analytics and Entity Relationship Map"
Cohesion: 0.50
Nodes (3): Entity Intelligence, Security Analytics, SOC Analytics and Entity Relationship Map

### Community 148 - "15. What is real, what remains limited"
Cohesion: 0.67
Nodes (3): 15. What is real, what remains limited, Real at Phase 4, Still intentionally limited

### Community 149 - "19. Next work"
Cohesion: 0.67
Nodes (3): 19. Next work, Before enabling Phase 4 triage broadly, Later phases

### Community 187 - "webapp_generator.py"
Cohesion: 0.44
Nodes (14): add_http(), add_web_context(), admin_panel_access(), base_event(), campaign(), large_data_export(), login_bruteforce(), login_success() (+6 more)

### Community 188 - "Investigations.jsx"
Cohesion: 0.27
Nodes (10): actionReference(), friendlyEvidenceText(), investigationReference(), Approvals(), LABELS, statusLabel(), statusTone(), Investigations() (+2 more)

### Community 189 - "email_generator.py"
Cohesion: 0.38
Nodes (12): add_email_context(), base_event(), bec_attack(), campaign(), choose_event(), main(), malicious_link(), malware_attachment() (+4 more)

### Community 190 - "Dashboard-managed security connectors"
Cohesion: 0.18
Nodes (10): Dashboard-managed security connectors, Elastic, Environment fallback, Purpose, Security boundaries, Server prerequisite, Source-specific access, Splunk (+2 more)

### Community 191 - "Phase 8 - Add the proactive autonomous SOC worker"
Cohesion: 0.50
Nodes (4): Phase 8 - Add the proactive autonomous SOC worker, Problem, What the phase did, Why it mattered

### Community 192 - "behavior_engine.py"
Cohesion: 0.36
Nodes (8): calculate_risk(), check_device(), check_ip(), check_privilege(), check_server_access(), check_working_hours(), current_hour(), enrich_event()

### Community 193 - "src/db/index.js"
Cohesion: 0.20
Nodes (8): db, { Pool }, app(), assert, { createApp }, db, request, test

### Community 196 - "Phase 9 - Add approval-gated response simulation"
Cohesion: 0.50
Nodes (4): Phase 9 - Add approval-gated response simulation, Problem, What the phase did, Why it mattered

## Knowledge Gaps
- **956 isolated node(s):** `name`, `version`, `description`, `main`, `start` (+951 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **24 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `incident()` connect `autonomous.js` to `hermes/correlation.js`, `activityTitle`, `Incidents.jsx`?**
  _High betweenness centrality (0.138) - this node is a cross-community bridge._
- **Why does `EntityRelationshipGraph()` connect `activityTitle` to `Cases.jsx`, `DigitalTwin.jsx`, `autonomous.js`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **Why does `runAutonomousAgent()` connect `autonomous.js` to `src/routes/index.js`, `src/workers/pipeline.js`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Are the 58 inferred relationships involving `choose_user()` (e.g. with `account_lockout()` and `dcsync()`) actually correct?**
  _`choose_user()` has 58 INFERRED edges - model-reasoned connections that need verification._
- **Are the 23 inferred relationships involving `enrich_event_evidence()` (e.g. with `main()` and `main()`) actually correct?**
  _`enrich_event_evidence()` has 23 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _956 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `AIConfiguration.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.05048076923076923 - nodes in this community are weakly interconnected._