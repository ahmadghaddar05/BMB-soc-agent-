# SOC Analytics and Entity Relationship Map

## Entity Intelligence

The Entity Intelligence relationship map now separates four evidence levels:

1. **Investigated observable** — the username, IP address, hash, domain, or other value entered by the analyst.
2. **Alert evidence** — individual stored alerts that matched the observable.
3. **Alert-to-alert relationships** — exact shared values such as identity, host, source IP, destination, process, database, or dataset.
4. **Incident membership** — stored incident records containing the displayed alerts.

The map does not infer missing relationships. Source-field equality and incident membership are displayed as observed facts. Clicking an alert opens Technical Triage; clicking an incident opens Incident Command.

The pivot response was extended additively with ATT&CK fields, technical entities, grouping context, and incident alert membership. No existing pivot field was removed.

## Security Analytics

The SOC Analyst navigation now includes **Analytics**. It provides:

- alert activity trends;
- severity distribution;
- top source IPs;
- most targeted hosts, databases, or destination addresses;
- telemetry dataset distribution;
- ATT&CK tactic coverage;
- most exposed identities;
- most frequent detection types;
- triage and correlation coverage indicators.

The analyst can select 24 hours, 7 days, or 30 days. The page refreshes every 60 seconds while visible.

All values come from stored BMB alert records through:

```text
GET /api/analytics/security?hours=24
```

Accepted windows are `24`, `168`, and `720` hours. The endpoint is read-only and restricted to SOC analysts and administrators. Missing entity fields produce honest empty states rather than estimated chart values.
