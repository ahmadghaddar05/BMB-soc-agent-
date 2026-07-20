# Phase 3 — Executive Experience

## Outcome

Phase 3 turns the executive landing page into a decision-focused security posture view. It reuses stored alerts, incidents, workflow runs, action requests, and source health. It does not create a second data system and does not invent missing business or response data.

## What the executive sees

- A plain-language security briefing and the current leadership decision.
- Five defined metrics: Cyber Risk Exposure, Critical Business Services at Risk, Open Critical Incidents, Mean Time to Respond, and Analyst Workload Reduced.
- Current values, targets where valid, previous-period comparison where supportable, confidence, definitions, freshness, and evidence drill-downs.
- Risk exposure, critical-incident, and response-time trends. Missing series remain visibly unavailable.
- Top open risks with impact proxy, owner, required decision, and incident evidence.
- A decision queue for unassigned high-impact incidents, pending approvals, failed internal actions, and degraded collection.
- A compact AI-assisted value view that separates triage coverage from end-to-end automation.
- Source coverage for Elastic, enrichment, technical asset mapping, and AI service health.

## Trust boundaries

- Cyber Risk Exposure is derived from severe activity, severity-weighted open incidents, and pending triage. Lower is better and the weighting is returned by the API.
- Business impact is currently a severity proxy. A durable business-service/CMDB relationship is not stored, so the business-service metric is intentionally blank.
- Mean Time to Respond is intentionally blank because reliable acknowledgement and response milestone timestamps are not stored.
- Analyst Workload Reduced is an estimate based on completed workflow outputs and explicit task-time assumptions. Token usage is not treated as human time.
- Historical posture snapshots are not stored, so the page does not fabricate a period-over-period exposure direction.
- External actions executed remains zero. Existing response capability is simulation-only and human-approved.

## API contract extension

`GET /api/executive/overview?days=7|30|90` retains its existing fields and adds:

- `briefing`
- `executive_metrics`
- `decision_queue`
- `source_coverage`
- Critical/high incident counts in `risk_trend`
- AI agreement and external-action availability flags in `automation`
- Previous-period estimated time in `time_saved`

No existing endpoint was removed or renamed. Authentication, CSRF enforcement, role routing, alert collection, triage, correlation, incident, investigation, case, approval, and response contracts were not changed.

## Frontend architecture

The executive page is composed from focused components:

- `ExecutiveBriefing`
- `ExecutiveKpiGrid`
- `RiskTrendChart`
- `ExecutiveRiskPanel`
- `ExecutiveDecisionQueue`
- `ExecutiveAiValue`
- `ExecutiveDataTrust`
- Existing `BusinessAssetList` and `DeepDiveDrawer`

The drawer remains URL-backed, read-only, keyboard dismissible, and connected to supporting evidence.

## Deferred backend improvements

These are visible limitations, not hidden placeholders:

1. Persist business-service ownership and criticality mappings.
2. Persist incident acknowledgement, response-start, containment, and recovery milestones.
3. Persist periodic posture snapshots for trustworthy previous-period exposure comparisons.
4. Add source-specific threat-intelligence and vulnerability freshness timestamps.
5. Persist AI-versus-analyst decisions before calculating agreement.
6. Add durable due dates before reporting overdue actions.

## Validation

- API syntax check: passed.
- Frontend lint: passed.
- API tests: 109 passed.
- Frontend tests: 33 passed.
- Frontend production build: passed.
- Browser screenshot validation: not claimed because no browser runtime was available in the development environment.

