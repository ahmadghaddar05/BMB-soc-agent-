# Phase 1 — Entry Scope and Acceptance Gate

Phase 1 changes platform foundations. It does not yet migrate triage/correlation to Hermes; it makes that migration safe and testable.

## Required implementation scope

### Reproducible builds

- Commit lockfiles for all Node projects.
- Use deterministic dependency installation in Docker.
- Add supported Node engine versions.
- Add `test`, `lint`, and build/check scripts.

### Configuration

- Validate required environment variables at startup without printing secrets.
- Align `.env.example`, Compose, README, and active code.
- Document mock, Elastic, Wazuh, and Hermes modes separately.
- Remove or label unused configuration.
- Make certificate mounting configurable.

### Database lifecycle

- Add a migration/version table and migration runner.
- Prove fresh-database and existing-database upgrade paths.
- Add AI/pipeline metric columns needed for a real baseline.
- Add constraints/indexes required by corrected route behavior.

### API correctness

- Fix and test `/alerts?search=`.
- Make `/alerts/:id/retriage` triage exactly that ID.
- Return 404 for missing alerts/incidents.
- Validate and cap page, limit, time, status, severity, and body inputs.
- Standardize error envelopes and request IDs.
- Make grouped and individual filter semantics explicit.

### Health and observability

- Add service-specific checks for PostgreSQL, enrichment, Elastic/Wazuh, and Hermes.
- Distinguish configured, reachable, degraded, and disabled.
- Persist fetched/stored/enriched/triaged, AI call/token/latency, correlation, and failure counters.
- Fix evaluation export to use actual counters.

### Immediate safety

- Disable or clearly label non-executing containment/block controls.
- Protect sensitive/write API routes with an enforced access boundary.
- Restrict CORS and add baseline security headers/rate limits.
- Keep Elastic writeback and automatic closure disabled.

### Frontend reliability

- Show API errors instead of silently converting them to empty data.
- Drive agent/collector/integration status from real health data.
- Remove hardcoded analyst identity until authentication supplies it.
- Add tests for core routing, search, alert detail, incident status, and failure states.

## Acceptance tests

- [ ] Clean install succeeds from lockfiles.
- [ ] Backend unit/API tests pass.
- [ ] Frontend tests and production build pass.
- [ ] Fresh PostgreSQL migration succeeds.
- [ ] Upgrade from the current schema succeeds without data loss.
- [ ] Mock pipeline completes collection → enrichment with AI disabled.
- [ ] Search returns correct individual and grouped results.
- [ ] Retrieging ID A cannot triage ID B.
- [ ] Missing records return 404.
- [ ] Unauthorized write requests are rejected.
- [ ] Named integration health checks test the named service.
- [ ] AI counters persist accurately in `fetch_runs` or successor tables.
- [ ] Evaluation export contains real calls, tokens, and latency.
- [ ] UI never labels a local toggle as an executed containment action.
- [ ] README quick start matches the tested commands and ports.

Phase 1 is complete only when every applicable box passes in the target development environment. External-service tests may use documented mocks in CI, but a live pre-production Elastic/Wazuh/Hermes verification remains required before production release.
