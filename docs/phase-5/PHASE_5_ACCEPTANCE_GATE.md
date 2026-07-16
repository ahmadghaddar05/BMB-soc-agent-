# Phase 5 Acceptance Gate

Run this gate on the internship server before enabling scheduled correlation.

## Automated gate

```bash
cd api && npm ci && npm run lint && npm test
cd ../enrichment && npm ci && npm run check && npm test
cd ../frontend && npm ci && npm test && npm run build
docker compose config --quiet
```

Expected: every command succeeds, the API tests include the Phase 5 correlation cases, and no active source imports `services/llm`.

## Deployment gate

1. Back up PostgreSQL and `.env`.
2. Keep `correlation_enabled=false` during deployment.
3. Rebuild and recreate the API/frontend containers so migration 005 applies.
4. Confirm `/api/health/dependencies` reports Hermes online and safe.
5. Confirm there are at least two triaged, non-auto-closed alerts with a real shared entity inside the configured window.
6. Run one manual pass:

```bash
SOC_KEY="$(sed -n 's/^SOC_API_KEY=//p' .env | tail -n1)"
curl -fsS -X POST http://127.0.0.1:3000/api/scheduler/correlate-now \
  -H "Authorization: Bearer $SOC_KEY"
```

7. Verify the cursor, incidents, and provenance:

```sql
SELECT key,value FROM settings WHERE key IN ('correlation_enabled','correlation_cursor_json');
SELECT id,incident_key,status,alert_ids,correlation_run_id FROM incidents ORDER BY id DESC LIMIT 10;
SELECT id,status,model,total_tokens,error_code FROM agent_runs WHERE purpose='correlation' ORDER BY created_at DESC LIMIT 10;
SELECT run_id,evidence_type,evidence_id,relation FROM agent_evidence_links WHERE run_id='<correlation-run-uuid>' ORDER BY relation,evidence_type,evidence_id;
```

8. Confirm every incident member was supplied to the run, closed/false-positive incidents were not reopened, and no unchanged incident had its narrative rewritten.
9. If accepted, enable `correlation_enabled=true` in Settings. Leave automatic closure and singleton promotion disabled.

## Rollback

Set `correlation_enabled=false`. Existing incidents and audit records remain available; do not delete or rewrite them during rollback. Revert the application deployment only after preserving the database backup and migration state.
