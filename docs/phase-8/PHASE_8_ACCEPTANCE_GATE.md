# Phase 8 Acceptance Gate

## Automated gate

Run from the repository root:

```bash
cd api
npm run lint
npm test

cd ../frontend
npm run lint
npm test
npm run build
```

Expected branch baseline:

- API: 95 tests passing.
- Frontend: 15 tests passing.
- Frontend production build succeeds. The existing chunk-size optimization warning is non-fatal.

## Deploy without enabling automation

```bash
docker compose up -d --build api frontend
docker compose ps
docker compose logs --since=5m api
```

Migration `008_autonomous_soc_agent.sql` is applied automatically. It installs the settings with `autonomous_agent_enabled=false`.

## Readiness check

```bash
SOC_KEY="$(sed -n 's/^SOC_API_KEY=//p' .env | tail -n1)"
curl -fsS http://127.0.0.1:3000/api/agent/status \
  -H "Authorization: Bearer $SOC_KEY" | python3 -m json.tool
```

Before enabling, `readiness.scheduler`, `readiness.triage`, and `readiness.correlation` should be true and dependency health should report Hermes safe and online.

## Controlled first run

Enable the bounded policy:

```bash
curl -fsS -X PUT http://127.0.0.1:3000/api/settings \
  -H "Authorization: Bearer $SOC_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "autonomous_agent_enabled":"true",
    "autonomous_lookback_hours":"24",
    "autonomous_max_items":"20",
    "autonomous_min_confidence":"0.70",
    "autonomous_assignment_enabled":"true",
    "autonomous_default_owner":"SOC Analyst"
  }'

curl -fsS -X POST http://127.0.0.1:3000/api/agent/run-now \
  -H "Authorization: Bearer $SOC_KEY" | python3 -m json.tool
```

The manual agent endpoint orchestrates evidence already stored in PostgreSQL. Use `/api/scheduler/run-now` when the acceptance test must also collect fresh Elastic alerts.

## Evidence checks

```bash
curl -fsS http://127.0.0.1:3000/api/agent/status \
  -H "Authorization: Bearer $SOC_KEY" | python3 -m json.tool

curl -fsS 'http://127.0.0.1:3000/api/actions?status=pending&limit=100' \
  -H "Authorization: Bearer $SOC_KEY" | python3 -m json.tool

unset SOC_KEY
```

In the UI, verify:

1. Dashboard shows the latest autonomous run and recent operations.
2. A qualifying case/alert creates one investigation with linked evidence.
3. Grounded notes appear on the investigation and correlated case.
4. Re-running orchestration does not duplicate completed operations.
5. A critical unowned case creates a pending owner proposal in `/approvals`.
6. No owner changes until an analyst approves it.
7. No containment, closure, false-positive, or Elastic writeback action appears.

## Pass criteria

- Run status is `completed` or an explainable `partial`, never silently successful after failures.
- Every operation has source evidence, target/result, attempts, and timing.
- Retries do not duplicate investigations or notes.
- Sensitive assignment remains pending until explicit approval.
- The scheduler can execute the full pipeline repeatedly without corrupting workflow state.
