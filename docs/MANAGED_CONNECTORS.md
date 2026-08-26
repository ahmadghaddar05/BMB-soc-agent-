# Dashboard-managed security connectors

## Purpose

BMB can connect to a client's Elastic, Splunk, or Wazuh deployment from **Security Administrator → Settings**. The client does not need to edit source code, rebuild images, or choose a source on the login page.

The workflow is deliberately separated into four decisions:

1. **Save** validates the fields and encrypts the credential on the API server.
2. **Test** authenticates and performs one bounded read-only sample query.
3. **Activate** switches new collection passes to that tested connector.
4. **Disable** stops using it and returns collection to another active connector or the environment fallback.

Switching sources does not remove previously collected alerts, incidents, investigations, or cases.

## Server prerequisite

Generate one stable 32-byte encryption key and put it in the BMB `.env` file:

```bash
openssl rand -base64 32
```

```dotenv
CONNECTOR_ENCRYPTION_KEY=paste-the-generated-value
```

Back up this value in the deployment secret store. It is not a Splunk, Elastic, or Wazuh credential. It protects the credentials that administrators enter in the dashboard. If it changes, existing connector credentials cannot be decrypted and must be entered again.

## Security boundaries

- Only an authenticated Security Administrator can access connector APIs.
- Credentials and CA certificate contents are AES-256-GCM encrypted before PostgreSQL persistence.
- The browser receives status and endpoint metadata, never the credential, ciphertext, authentication header, or CA contents.
- Create, edit, test, activate, disable, and delete actions are written to the audit ledger.
- Activation requires a successful test of the exact current configuration within 30 minutes.
- Connector errors are redacted before storage and display.
- Loopback, unspecified, and link-local target addresses are rejected.
- Source access remains read-only; connector activation does not enable Elastic writeback or external response actions.

## Source-specific access

### Elastic

Use a read-only API key that can read the configured alert alias and raw-event indices. Each managed Elastic connector keeps its own collection cursor so switching clients cannot reuse another connector's ingestion position.

### Splunk

Use port `8089`, the management REST API, with a dedicated read-only JWT bearer token where available. The role needs permission to use the search export endpoint, search the configured index, and read its own authentication context. Port `8000` is only the Splunk web UI; port `8088` is HEC ingestion and is not used by this read connector.

The connector supports two collection methods:

- **Triggered alerts and their search results** first runs the configured bounded base search (for this deployment, `search index=alerts`) to identify the alert names and SIDs that are allowed into BMB. It then reads Splunk's `alerts/fired_alerts` REST resource and retrieves `search/jobs/{sid}/results` only for matching alerts. The owner/app namespace controls where BMB looks for matching jobs; it does not expand collection beyond the configured `alerts` index. Unrelated entries visible on Splunk's Triggered Alerts page are ignored.
- **Index search** runs the configured bounded SPL base search through `search/jobs/export`. It remains useful for notable-event indexes, custom alert indexes, fallback collection, and analyst evidence pivots.

Triggered-result access is read-only and bounded by the configured `alerts` index, BMB collection lookback, per-cycle alert limit, fired-alert pagination ceiling, and four concurrent job-result requests. The Splunk role must be allowed to search `index=alerts`, list fired alerts, and read the associated matching search jobs. If matching fired alerts are visible but every referenced job is unreadable, connector testing fails visibly rather than ingesting context-free placeholders.

### Wazuh

Use the Wazuh indexer/OpenSearch-compatible endpoint and a least-privilege account that can read the configured alert index pattern.

## TLS

Keep certificate verification enabled in production. If the source uses a private CA, paste the PEM certificate into the wizard. Disabling verification is visibly reported and should be limited to an isolated lab test.

## Environment fallback

Existing `ALERT_SOURCE`, Elastic, Splunk, and Wazuh environment variables remain supported. They are used only when no enabled dashboard connector is active. This provides a safe bootstrap and recovery path without making client endpoints part of the application code.
