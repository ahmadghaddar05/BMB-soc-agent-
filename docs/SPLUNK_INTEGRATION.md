# Splunk integration

## Purpose

BMB reads security detections from Splunk Enterprise through Splunk's management REST API. It does not send events to Splunk and therefore does not use the HTTP Event Collector endpoint.

```text
Splunk Enterprise <client-host>:8089
  -> authenticated export search
  -> BMB canonical alert normalization
  -> PostgreSQL deduplication
  -> enrichment, triage, correlation, and incidents
```

Elastic, Wazuh, mock, and Splunk remain separate selectable alert sources. Selecting Splunk does not delete previously collected Elastic evidence.

## Required Splunk access

Create a dedicated read-only Splunk user and token. Its role must be able to:

- search the configured index;
- use the search jobs export endpoint;
- read its own authentication context.

Do not use an administrator token. BMB never returns the token to the browser. Dashboard-managed credentials are stored in PostgreSQL only as AES-256-GCM authenticated ciphertext.

## Recommended dashboard setup

Open **Security Administrator → Settings → Security source connectors**, select **Splunk Enterprise**, and provide:

- the Splunk management hostname or IP and port `8089`;
- a read-only JWT bearer token, or a Splunk session key when required;
- the index and base generating search;
- certificate verification and, for a private PKI, the issuing CA certificate.

Save and test the connector, review the result, then activate it. No BMB rebuild is required. `10.1.1.160` is only an example client address and is not hardcoded into BMB.

## Environment fallback

```dotenv
ALERT_SOURCE=splunk
SPLUNK_URL=https://splunk.example.internal:8089
SPLUNK_TOKEN=replace-with-the-read-only-token
SPLUNK_AUTH_SCHEME=Bearer
SPLUNK_INDEX=main
SPLUNK_SEARCH=search index=main
SPLUNK_VERIFY_TLS=true
SPLUNK_CA_HOST_PATH=/etc/splunk/certs/splunk-ca.pem
SPLUNK_CA_CERT=/run/secrets/splunk_ca.pem
```

Use `Bearer` for a Splunk JWT authentication token. Use `Splunk` only when the supplied credential is a Splunk session key or the deployment explicitly requires that scheme.

`SPLUNK_SEARCH` is the base generating search. For Splunk Enterprise Security notable events it may need to target the deployment's notable/risk index or saved-search output. Confirm the correct index in Splunk rather than assuming `main`.

## TLS

Production and enterprise deployments should keep certificate verification enabled. The certificate must be valid for the configured hostname or IP. Dashboard-managed connectors accept the private CA PEM directly; the environment fallback can mount the issuing CA with `docker-compose.splunk.yml`.

`SPLUNK_VERIFY_TLS=false` is supported only for a temporary isolated-lab connectivity test. It is surfaced as a configuration warning.

## Validation

From the BMB server, first verify that the management port is reachable:

```bash
timeout 5 bash -c '</dev/tcp/10.1.1.160/8089' && echo reachable
```

After deploying the API container, validate authentication and retrieve at most five recent samples:

```bash
docker exec soc_api node src/scripts/test-splunk.js
```

The diagnostic output contains endpoint, TLS state, authenticated username, index, sample count, normalized severity, and BMB alert references. It never prints the token or raw event bodies.

Then inspect dependency health:

```bash
SOC_KEY="$(sed -n 's/^SOC_API_KEY=//p' .env | tail -n1)"
curl -fsS -H "Authorization: Bearer $SOC_KEY" http://127.0.0.1:3000/api/health/dependencies | python3 -m json.tool
unset SOC_KEY
```

Only enable the scheduler after both checks succeed.

## Collection semantics

- Time bounds are sent as Splunk export parameters, not inserted into SPL text.
- Results use JSON streaming and malformed records fail the collection visibly.
- Stable identifiers use source index, Splunk event identifiers, timestamp, source metadata, and raw evidence.
- Common Splunk CIM fields are mapped into BMB users, hosts, IPs, processes, datasets, actions, MITRE techniques, risk scores, and severity.
- Critical/high/medium/low/informational severities map deterministically into BMB rule levels.
- PostgreSQL deduplication prevents the same Splunk event from being stored repeatedly.

## Troubleshooting

- `401`: token missing, expired, or using the wrong authentication scheme.
- `403`: the token role cannot access the endpoint or configured index.
- Certificate error: mount the correct CA and verify that the certificate matches the URL.
- Zero samples with healthy authentication: verify `SPLUNK_INDEX`, `SPLUNK_SEARCH`, and that recent events exist.
- Search export error: inspect the returned error and validate the SPL directly in Splunk Search.
