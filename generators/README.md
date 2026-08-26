# ExampleCorp telemetry generators

This directory is a preserved working copy of `generators.zip`. The original ZIP is not modified. Existing people, employee IDs, hosts, IP addresses, servers, datasets, and UDP inputs remain in place.

## What changed

The six standalone generators still produce their original AD, database, EDR, email, Linux, and web-application telemetry. Their Security-alert probabilities are now centrally constrained to **13–15%**; ordinary logs remain the large majority.

EDR also emits uncommon, non-alert acceptable-use records:

- unauthorized game software;
- an interactive PowerShell session, with role-aware authorization context;
- access to a prohibited web category (safe `.example` domains only);
- approved PowerShell maintenance carrying a change ID.

These use `event.kind: event` and `policy.security_alert: false`. A policy violation is therefore evidence for an HR/acceptable-use investigation, not automatically malware. This distinction tests whether the AI can reason carefully and avoid declaring every unusual event malicious.

`scenario_runner.py` adds finite multi-source stories. Alerts in a story share an existing username, source IP, and `attack.campaign_id`, which gives the dashboard real correlation pivots without changing the original inventory. Normal background telemetry is automatically padded so every finite run finishes between 13% and 15% alerts.

## Validate without sending

From this directory:

```bash
python3 scenario_runner.py --scenario mixed_enterprise --dry-run
python3 -m unittest -v test_generators.py
```

The dry-run summary must report an `alert_ratio` between `0.13` and `0.15`.

## Evidence-rich telemetry

Every runtime generator and finite scenario passes its event through
`evidence_context.py` before transmission. The shared layer preserves each
source's existing ECS document and adds the evidence an analyst normally needs:

- EDR and Linux process ancestry, command lines, executable paths, hashes,
  signatures, sessions, and sensor/audit state.
- AD logon type, authentication protocol, session, source workstation, failure
  status, and directory-replication rights.
- Email sender authentication, delivery action, message and attachment
  identifiers, attachment hashes, and sandbox observations.
- Web request/response sizes, status, full URL, session, TLS, and WAF action.
- Database query, operation, transaction, duration, rows, client, and export
  artifact context.

The layer never emits `expected_verdict`, `ground_truth`, `true_positive`, or
`false_positive` answer fields. Hermes must determine a verdict from the
observed evidence. Policy activity remains non-alert telemetry, and the
standalone and finite-run alert ratios remain between 13% and 15%.

## MITRE Coverage and incident-path contract

Every generated security alert now carries canonical, observed ATT&CK data in
both ECS-style `threat.*` fields and the generator's `attack.*` context:

- tactic ID, tactic name, stable tactic order, and normalized stage;
- technique/sub-technique ID and name;
- an observation-specific campaign ID for standalone random alerts;
- a shared campaign and correlation session only for coordinated scenarios;
- sensor-observed control disposition (`detected` or `blocked`) without an AI
  verdict or ground-truth label.

The `full_attack_chain` scenario follows a real ordered path across Initial
Access, Execution, Persistence, Credential Access, Discovery, Lateral
Movement, Collection, Command and Control, Exfiltration, and Impact. Its alert
records share `correlation.session_id` and include `path_position` /
`path_length`, while sparse scenarios still contain only two or three relevant
alerts. The BMB backend remains responsible for deciding whether those linked
observations qualify as an incident.

## Send a coordinated exercise

Point `--host` at the server receiving the existing UDP inputs:

```bash
python3 scenario_runner.py \
  --host 127.0.0.1 \
  --scenario mixed_enterprise \
  --user maya.georges \
  --source-ip 198.51.100.24
```

Available scenarios:

- `account_compromise`: repeated failed AD logons, successful logon, and phishing;
- `endpoint_persistence`: credential dumping followed by scheduled-task persistence;
- `exfiltration`: large web and database exports;
- `full_attack_chain`: the correlated security stages above;
- `policy_violations`: game, PowerShell, and prohibited-site non-alert telemetry;
- `benign_admin`: approved PowerShell maintenance for the existing database admin;
- `mixed_enterprise`: attack chain, policy records, approved activity, and normal noise.

Existing input ports are unchanged: EDR `5601`, email `5604`, Linux `5605`, AD `5606`, web app `5607`, and database `5608`, all UDP.

## AI investigation of non-alert events

The BMB API now exposes the Hermes analyst to a bounded read-only `search_raw_events` application tool. It accepts exact pivots only, returns at most 25 allowlisted fields, omits `_source`, and cannot accept an index name, arbitrary Elastic query, script, SQL, or write operation.

Set this backend-only variable on the server:

```env
ELASTIC_EVENT_INDICES=logs-*
```

The Elastic API key used by BMB needs `read` and `view_index_metadata` on that pattern in addition to its existing read access to the Security alert alias. Keep the key read-only.

Example analyst questions after the events are indexed:

- `Find non-alert policy violations for maya.georges in the last 24 hours. Separate observed facts from security inference.`
- `Was the PowerShell activity for tony.azar authorized? Cite the raw event and change record.`
- `Correlate the recent maya.georges Security alerts, then check raw events for supporting endpoint activity.`

Raw policy events do not enter the Security-alert dashboard unless an Elastic detection rule intentionally promotes them. They remain searchable evidence for the AI analyst by design.
