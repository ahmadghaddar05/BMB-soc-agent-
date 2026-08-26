# BMB Alert Retention Policy

## Purpose

BMB stores a PostgreSQL copy of Elastic alerts so analysts can monitor, triage, correlate, and investigate them. Keeping every historical copy indefinitely creates an unnecessary triage backlog. This policy keeps the operational queue current without deleting the original Elastic source data.

## Active lifecycle

After activation, BMB runs retention once per day at 02:17 UTC:

| Stored alert severity | Dashboard lifetime |
| --- | ---: |
| Critical | 14 days |
| High | 10 days |
| Medium, low, or unclassified | 7 days |

Age is measured from the alert's last observed time, falling back to its alert timestamp and then its fetch time.

## Evidence protection

An expired alert is not deleted when it is referenced by:

- an incident;
- an investigation;
- an active or reverted safe-response simulation.

These records remain available as durable workflow evidence even after their normal operational lifetime expires.

## One-time cleanup

The `initial_7_day_purge` mode deletes eligible BMB alert copies older than seven days, regardless of severity. This is intentionally separate from the ongoing 14/10/7-day policy and is used to clear the existing historical backlog.

Before executing it:

1. stop optional AI processing while leaving live Elastic collection available;
2. create a PostgreSQL backup;
3. run the preview and review candidate, protected, and deletable counts;
4. type the exact confirmation phrase `PURGE DASHBOARD ALERTS`;
5. execute the purge;
6. activate automatic retention.

## Safety boundary

- BMB never deletes Elastic indices, data streams, or source records through this lifecycle.
- Cleanup is processed in bounded batches.
- Only one retention run can execute at a time.
- Preview and execution results are stored in `alert_retention_runs`.
- Completed destructive runs create an application audit event.
- Enabling, disabling, or changing retention settings uses the existing audited settings path.
