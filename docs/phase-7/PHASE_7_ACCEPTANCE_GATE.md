# Phase 7 Acceptance Gate

## Automated gate

Run from the repository root:

```bash
cd api
npm run lint
npm test

cd ../frontend
npm run lint
npm test -- --run
npm run build
```

Expected baseline for this branch:

- API: 91 tests passing.
- Frontend: 14 tests passing.
- Frontend production build succeeds.

## Server deployment check

After this branch is approved and deployed, rebuild the API and frontend so migration 007 and the Approval Queue are active:

```bash
docker compose up -d --build api frontend
docker compose ps
docker compose logs --since=5m api
```

Verify the policy without exposing credentials:

```bash
SOC_KEY="$(sed -n 's/^SOC_API_KEY=//p' .env | tail -n1)"
curl -fsS http://127.0.0.1:3000/api/action-policy \
  -H "Authorization: Bearer $SOC_KEY" | python3 -m json.tool
unset SOC_KEY
```

The response must list exactly five actions. `investigation.update` and `case.update` must report `approvalRequired: true`.

## UI and chatbot acceptance

1. Open `/approvals` and confirm the Phase 7 safety boundary is visible.
2. Ask the chatbot: `Add this note to case 7: Phase 7 controlled action test. Reason: preserve the analyst validation record.` Replace `7` with a real case ID.
3. Confirm the chatbot reports the note action as `executed` and that the note appears in the case timeline.
4. Ask: `Assign case 7 to Incident Lead. Reason: make the active investigation owner explicit.`
5. Confirm the chatbot reports the action as `pending`, not executed.
6. Open `/approvals`, inspect the target and parameters, enter a decision reason, and approve it.
7. Confirm the request becomes `executed` and the case owner changes.
8. Submit or simulate `host.isolate`; confirm the API returns `ACTION_FORBIDDEN` and no action request is created.

## Pass criteria

- Direct internal documentation is idempotent and audited.
- Sensitive workflow changes do not execute before explicit approval.
- Approval records show the deciding actor and reason.
- The chatbot never describes a pending action as executed.
- Forbidden external actions cannot reach the database or Hermes host tools.
