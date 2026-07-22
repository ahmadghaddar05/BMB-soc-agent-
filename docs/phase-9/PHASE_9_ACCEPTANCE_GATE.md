# Phase 9 Acceptance Gate

Run this gate on the Linux Docker server after the Phase 9 branch is approved. The laptop checks cannot prove that the live PostgreSQL migration, deployed nginx bundle, scheduler, or Hermes instance is healthy.

## 1. Deploy the branch

```bash
git switch phase-9-simulated-response
git pull --ff-only
docker compose build api frontend
docker compose up -d --no-deps --force-recreate api frontend
docker compose ps
docker compose logs --since=5m api
```

Expected: migration `009_simulated_response.sql` applies once, the API remains up, and the frontend serves the new Response Lab.

## 2. Verify the policy and default

```bash
SOC_KEY="$(sed -n 's/^SOC_API_KEY=//p' .env | tail -n1)"
API="http://127.0.0.1:3000/api"
curl -fsS "$API/action-policy" -H "Authorization: Bearer $SOC_KEY" | python3 -m json.tool
curl -fsS "$API/settings" -H "Authorization: Bearer $SOC_KEY" | python3 -m json.tool
```

Expected:

- policy version is `phase9-v1`;
- `response.simulate` and `response.rollback` both require approval;
- real action names such as `host.isolate` are absent;
- `simulated_response_proposals_enabled` is `false` until explicitly enabled.

## 3. Exercise a chatbot proposal

Choose one real stored alert ID and an exact host, username, or IP present in that alert. Ask:

> Using alert `<exact-alert-id>` as evidence, request a simulated endpoint isolation for `<exact-hostname>`. This is a BMB-only exercise and must wait for approval.

Expected: Hermes requests `response.simulate`, the API returns `pending`, and the chatbot says approval is required. It must not claim the endpoint was isolated.

Open **Approvals** and verify the preview says:

- mode `simulation_only`;
- connector `bmb-simulated-response`;
- external effects `None`;
- the exact target and evidence alert ID.

Approve with an explicit reason. Then open **Response Lab** and verify the state is active, verification is recorded, and the evidence ID is visible.

## 4. Exercise autonomous proposal generation

Only after Phase 8 triage/correlation acceptance has produced a qualifying critical case, enable **Propose response simulations** in Settings and run **Run orchestration now**.

Expected:

- the agent may create one pending `response.simulate` request for a shared case entity;
- it does not execute the request;
- the agent status metrics record `simulated_responses_proposed` and an approval request;
- replaying the same case/version does not create a duplicate proposal.

## 5. Exercise rollback

In Response Lab, select the active simulation, enter a rollback reason, and click **Request approved rollback**.

Expected: state remains active until the new `response.rollback` request is approved. After approval, state becomes reverted and the audit timeline contains a reverted event.

## 6. Database reconciliation

```bash
docker exec soc_postgres psql -U socagent -d socagent -P pager=off -c "SELECT response_type,target_value,state,executed_by,executed_at,verified_at,reverted_by,reverted_at FROM simulated_response_states ORDER BY created_at DESC LIMIT 10;"
docker exec soc_postgres psql -U socagent -d socagent -P pager=off -c "SELECT event_type,actor,details,created_at FROM simulated_response_events ORDER BY id DESC LIMIT 20;"
docker exec soc_postgres psql -U socagent -d socagent -P pager=off -c "SELECT action_type,status,requested_by,executed_by,preview,result FROM action_requests WHERE action_type IN ('response.simulate','response.rollback') ORDER BY created_at DESC LIMIT 10;"
```

Confirm that every execution has an approval record and `external_side_effects` is false in preview/result/event details.

## 7. External no-change assertion

Confirm no EDR, Active Directory, firewall, Elastic writeback, email, or ticketing credential was added to BMB and no outbound connector call appears in logs. The exercise passes only when the UI and database truthfully report a simulation, never real containment.

## Acceptance result

Record each live item as passed or failed. Do not report Phase 9 deployed merely because local tests pass; the live migration, API, browser workflow, Hermes proposal, approval, verification, rollback, and external no-change assertion must all be observed on the server.
