# AI-SOC — Architecture Review, Rewrite Roadmap & Function Documentation

**Document version:** 1.0 · July 2026
**Scope:** Full codebase review of the AI-SOC analyst agentic solution (api, enrichment, frontend, postgres, eval), a roadmap to shift triage and analysis from LLM-driven to code-first deterministic logic, and complete function-level documentation.

---

## Part 1 — Architecture Overview

### 1.1 Services

| Service | Stack | Role |
|---|---|---|
| `api` | Node 20 / Express, `pg`, `node-cron`, `pdfkit` | Pipeline orchestration, workers, LLM integration, REST API, PDF reports, chat agent |
| `enrichment` | Node / Express, static JSON datasets | Mock AD / CMDB / EDR / TIP / vulnerability context provider |
| `frontend` | React 18 / Vite / Tailwind | Dashboard, Alerts, Incidents, Pivot, Reports, Settings, embedded chat widget |
| `postgres` | PostgreSQL | `alerts`, `incidents`, `triage_cache`, `settings`, `fetch_runs`, MITRE reference tables |
| `eval` | Node CLI | Offline evaluation harness: verdict classification, pairwise correlation clustering, efficiency metrics |

### 1.2 Pipeline lifecycle (per cron cycle)

```
Wazuh Indexer (OpenSearch _search, rule.level >= min, lookback window)
        │  fetchAlerts() → normalizeAlert() → extractEntities() + extractMitre()
        ▼
Ingest — INSERT ... ON CONFLICT (id) DO NOTHING          [dedup by Wazuh _id]
        ▼
Enrich — POST /enrich per alert → JSONB context           [deterministic, mock data]
        ▼
Triage — cluster by alertSignature() → cache lookup →
         LLM verdict per cluster (pipeline or agentic mode) → apply to members
         → optional auto-close (verdict + confidence + severity gates)
        ▼
Correlate — LLM receives up to 60 compact triaged alerts → proposes incidents
            → upsertIncident() merge-by-overlap / incident_key upsert
        ▼
Promote — significant standalone alerts → single-alert incidents (type='triage')
```

### 1.3 Alert state machine

- `enrichment_status`: `pending → enriched | enrichment_failed | skipped`
- `triage_status`: `pending → triaged | triage_failed | skipped`
- `auto_closed`: boolean, set at triage time when auto-close gates pass
- Incident `status`: `open | closed | false_positive` (closed incidents are never silently reopened; new related activity creates a fresh incident)

### 1.4 Where the LLM is used today

| # | Call site | Frequency | Output |
|---|---|---|---|
| 1 | `triageAlert()` — pipeline mode | 1 call per new signature cluster per cycle | severity, verdict, confidence, attack_stage, findings, actions, narrative |
| 2 | `investigateAlert()` — agentic mode | Up to 5 tool-loop iterations per cluster | Same verdict schema + investigation trace |
| 3 | `correlateAlerts()` | 1 call per cycle over ≤ 60 alerts (24 h window) | Incident groupings, titles, narratives, actions |
| 4 | `chatAgent()` | Per analyst question | Grounded answer via read-only DB tools |

**Critical observation:** severity, verdict, and — most importantly — *confidence* are LLM-generated, and the auto-close decision is gated on that confidence value. The model has no calibrated basis for the number it emits; the system's only autonomous action is therefore driven by a fabricated statistic. Correlation is likewise fully delegated: incident membership, severity, and narrative are re-decided by the LLM every cycle over the same lookback window.

### 1.5 What already works well (keep)

- **Signature clustering** (`rule_id | src_ip | dst_ip | username | hostname | target_db` hash) — triage once, apply to all members. Main existing cost lever.
- **Triage cache** keyed by signature with hit counting.
- **JSON repair loop + 429 backoff** in `chatJSON()` / `postChat()`.
- **Hallucination guard** in `correlateAlerts()` — model-supplied alert IDs filtered against the input set.
- **Incident merge-by-overlap** and deterministic `incident_key` hashing.
- **Read-only, parameterized chat tools** — no model-authored SQL path.
- **Eval harness** (`eval/`) — macro-F1 verdict classification, pairwise clustering F1 / Adjusted Rand Index, efficiency metrics. This is the regression anchor for the rewrite.

### 1.6 Weaknesses (drive the roadmap)

1. **LLM decides instead of explains.** Verdict, severity, confidence, and incident membership are all model outputs. Non-deterministic, non-reproducible, non-defensible in audit.
2. **Cache staleness.** `triage_cache` entries never expire; a verdict cached while enrichment *failed* is reused indefinitely. No prompt-version or enrichment-hash in the key.
3. **Signature evasion.** Rotating source IPs defeat clustering — a distributed brute force produces one signature (and one LLM call) per source IP. No time bucketing.
4. **Correlation churn.** LLM correlation re-runs each cycle over the same window; `ON CONFLICT DO UPDATE` rewrites titles/narratives every run; `incident_key` is derived from the member-ID set, so it changes as incidents grow.
5. **Hardcoded, demo-oriented extraction.** `target_db` database name list, hostname prefix regex (`DC|SQL|COREBANK|SWIFT|...`), group→technique heuristics are embedded in code, not configuration.
6. **No deterministic scoring layer.** Nothing sits between raw `rule_level` and the LLM. Enrichment data (crown-jewel flags, TI hits, logon anomalies, EDR corroboration, CVSS exposure) is collected but never *computed on* — it is only forwarded as prompt context.
7. **Throughput.** Per-alert sequential `await` for both insert and enrichment. No batch insert, no concurrency pool.
8. **Token waste.** Pretty-printed JSON payloads (`JSON.stringify(_, null, 2)`), null fields included, 400-char raw `full_log` slices sent instead of extracted fields.
9. **Security posture.** `NODE_TLS_REJECT_UNAUTHORIZED=0` set process-wide when Wazuh TLS verification is disabled — affects every outbound TLS connection including the LLM API.
10. **Truncation risk.** Correlation response capped at `max_tokens: 2000` while describing up to 60 alerts' worth of incidents.

---

## Part 2 — Rewrite Roadmap: Code-First Triage, LLM-Last

**Design principle:** deterministic feature extraction → deterministic risk scoring → deterministic verdict rules → LLM only for the gray zone and for narration. The end state inverts today's flow: *code produces the verdict and the incident; the LLM explains them and answers questions about them.* Every auto-close traces to a named rule and a score breakdown.

### Phase 0 — Baseline & instrumentation (≈ 1 week)

- Build a labeled ground-truth set from existing alert data (the `eval/sample_ground_truth.json` format is already defined).
- Run `eval/evaluate.js` against the current LLM pipeline; record: verdict accuracy, macro-F1, pairwise correlation F1 / ARI, LLM calls per 100 alerts, tokens per 100 alerts, cycle latency.
- Add per-stage token/latency counters to `fetch_runs` so every subsequent phase is measured on the same harness. **Gate: no phase ships unless it matches or beats the baseline.**

### Phase 1 — Deterministic feature extraction + risk engine (≈ 2–3 weeks)

Enrichment already returns structured data; today the pipeline merely forwards the blob to the LLM. Instead, compute typed features in code at enrichment time:

| Feature | Source | Type |
|---|---|---|
| `asset_criticality`, `is_crown_jewel` | CMDB | enum / bool |
| `user_privilege_tier`, `user_criticality` | AD | enum |
| `ti_hit`, `ti_category`, `ti_confidence` | TIP | bool / enum / float |
| `logon_anomaly_count` (off-hours, foreign subnet, disabled account) | AD logon-check | int |
| `edr_corroboration` (detections on host, window) | EDR | int + severity split |
| `vuln_exposure` (max CVSS, exploitable count) | Vuln | float / int |

**Risk score (transparent, tunable, auditable):**

```
risk = base(rule_level) × asset_multiplier × identity_multiplier + Σ signal_weights
```

Weight table stored in a DB table, editable from the Settings UI. This is risk-based alerting (RBA) implemented natively.

**Deterministic verdict rules on top of the score:**

- TI-confirmed malicious indicator + crown-jewel asset → `true_positive`
- Match against a **suppression/allowlist table** (`rule_id` + entity pattern + reason + expiry) → `false_positive` / `benign_anomaly`
- Score ≥ upper threshold → `true_positive`
- Score ≤ lower threshold → auto-close eligible
- Middle band → **gray zone** (the only population the LLM sees in Phase 3)

Confidence becomes meaningful — derived from which rules fired — and auto-close becomes defensible. `recommended_actions` come from a **playbook table keyed by MITRE technique**, not from generation.

### Phase 2 — Deterministic correlation (≈ 2 weeks)

Replace LLM grouping with **entity-graph correlation**:

1. Build edges between alerts sharing user / host / src_ip / dst_ip within a sliding time window.
2. Take connected components as incident candidates.
3. Score each component for **kill-chain progression** using the existing tactic ordering (recon → initial_access → … → impact). Multi-tactic progression on shared entities — exactly what the current correlation prompt asks the LLM to find — is found deterministically, identically every run, at zero token cost.
4. Derive `incident_key` from **root entities + time bucket** (not the member-ID set), giving stable identity as incidents grow. Kills the churn problem.

This mirrors how commercial SOAR/SIEM correlation (FortiSOAR, Splunk ES) works under the hood.

### Phase 3 — LLM usage, minimized and optimized (≈ 1–2 weeks)

Remaining LLM responsibilities after Phases 1–2:

- **(a) Gray-zone triage only** — alerts the rule engine cannot decide.
- **(b) One-time incident narration** — one call when an incident is *created* or *materially changes* (new tactic or new entity); cached on a content hash; never re-narrated on merge.
- **(c) Chat assistant** — unchanged; it is a legitimate LLM use.

Optimizations for what remains:

- **Batch gray-zone triage:** 5–10 alerts per call, per-alert IDs in a JSON array response — instead of one call per cluster.
- **Compact payloads:** drop null fields and pretty-printing (≈ 30–40 % of current prompt tokens); extract fields from `full_log` in code and send only extracted fields.
- **Cache versioning:** key = `prompt_version + enrichment_hash + signature`, with TTL; never cache verdicts produced while enrichment failed.
- **Model tiering:** small/cheap model for gray-zone classification; escalate to a stronger model only when its answer conflicts with the risk score.
- **Signature hardening:** add time bucketing and optional field wildcarding (e.g. src_ip class-C collapse for distributed brute force).

**Expected outcome:** 80–95 % fewer LLM calls per cycle — a well-tuned rule engine leaves only 10–20 % of alerts in the gray zone.

### Phase 4 — Rethink the log/data layer (≈ 2–3 weeks, parallelizable)

- **Config-driven normalization:** per-decoder / per-source field mappings (OCSF-style schema discipline) stored as configuration rather than code, so onboarding a new log source never touches `wazuh.js`. Replaces the hardcoded `target_db` lists and hostname regexes.
- **Observables table:** `(alert_id, type, value, role)` — pivot and correlation become indexed joins instead of `ILIKE` over columns.
- **Ingest-side flood control:** identical signatures within a time bucket increment a counter on one representative row instead of storing thousands of near-duplicates. Dedup before the DB, not after.
- **Throughput:** batch inserts via `unnest` arrays; enrichment through a bounded concurrency pool (easy ~10× over per-row awaits). Partition `alerts` by month when volume warrants.

### Phase 5 — Hardening & operations

- Scope the TLS bypass to the Wazuh fetch agent (custom `https.Agent`) instead of `NODE_TLS_REJECT_UNAUTHORIZED=0` globally.
- `/metrics` endpoint (Prometheus format) exposing pipeline counters.
- Wire the eval harness into CI: any change to weights, suppression rules, prompts, or correlation logic runs against the labeled set before merge.

### Target architecture

```
Wazuh → Normalize (config-driven, OCSF-style) → Ingest (batched, flood-controlled)
      → Enrich (deterministic features)       → Risk Engine (weighted score)
      → Verdict Rules (TI / suppression / thresholds)
             ├── decided  → auto-close or queue          [no LLM]
             └── gray zone → batched LLM classification  [tiered models]
      → Graph Correlation (entity components + kill-chain scoring)
             └── incident created/changed → single LLM narration call (cached)
      → Chat assistant (read-only tools)                 [unchanged]
```

---

## Part 3 — Function Documentation

### 3.1 `api/src/index.js` — service entrypoint

| Function | Signature | Description |
|---|---|---|
| `waitForDb` | `(retries=15, delayMs=3000) → Promise<void>` | Polls `SELECT 1` until the database answers or retries are exhausted; throws on failure. |
| `main` | `() → Promise<void>` | Boot sequence: wait for DB → start scheduler → listen on `PORT` (default 3000). Mounts `cors`, `express.json` (5 MB limit), `morgan`, and the router at `/api`. |

### 3.2 `api/src/db/index.js` — database module

Single `pg.Pool` (max 10 connections, 5 s connect timeout).

| Function | Signature | Description |
|---|---|---|
| `query` | `(text, params) → Promise<Result>` | Thin passthrough to `pool.query`. |
| `getSetting` | `(key, fallback=null) → Promise<string\|null>` | Read one settings row; returns fallback if absent. |
| `getAllSettings` | `() → Promise<Object>` | All settings as a flat `{key: value}` object (all values are strings). |
| `setSetting` | `(key, value) → Promise<void>` | Upsert one setting (`ON CONFLICT DO UPDATE`), value coerced to string. |
| `getAlertStats` | `() → Promise<Object>` | Single aggregate query: totals plus `FILTER`-ed counts per enrichment/triage state, auto-closed count, oldest/newest timestamps. |
| `startFetchRun` | `(trigger, mode) → Promise<number>` | Inserts a `fetch_runs` row with `status='running'`; returns the run id. |
| `updateFetchRun` | `(id, updates) → Promise<void>` | Dynamic `SET` builder over the supplied fields. ⚠ Field names are interpolated into SQL — internal-use only; never expose to request input. |
| `finishFetchRun` | `(id, stats, status='ok', error=null) → Promise<void>` | Writes final per-stage counters (fetched/stored/duplicates/enriched/triaged/failures/incidents) and `finished_at`. |

### 3.3 `api/src/services/wazuh.js` — alert acquisition & normalization

Module side effect: if `WAZUH_VERIFY_TLS === 'false'`, sets `NODE_TLS_REJECT_UNAUTHORIZED=0` **process-wide** (Phase 5 fix: scope to a dedicated agent).

| Function | Signature | Description |
|---|---|---|
| `extractEntities` | `(src) → {src_ip, dst_ip, username, hostname, process, target_db}` | Pulls entities from `data.*` and `data.win.eventdata.*` with a first-non-empty helper. Hostname falls back to agent name only when it looks host-like (contains a dot or matches a hardcoded prefix regex: `DC|SQL|WS|COREBANK|SWIFT|...`). `target_db` extracted via `USE`/`DATABASE:` regex over `full_log`, else membership in a hardcoded bank database list. **Roadmap Phase 4 replaces this with config-driven mappings.** |
| `extractMitre` | `(src) → {mitre_techniques[], mitre_tactics[]}` | Prefers Wazuh's own `rule.mitre.{id,tactic}` tags. Fallback: `GROUP_TECHNIQUE` regex table over rule groups/description infers one technique; tactics backfilled from `TECHNIQUE_TACTIC` map. Output normalized to uppercase technique IDs and snake_case tactics, deduplicated. |
| `normalizeAlert` | `(hit) → alert` | Maps one OpenSearch hit to the internal alert shape: id (`_id`), timestamp, rule fields, decoder, agent, `full_log`, entities, MITRE, and full `raw` source. |
| `fetchFromWazuh` | `({minutes, minLevel, limit}) → Promise<alert[]>` | POSTs an OpenSearch `_search` (bool filter: `@timestamp >= now-Nm`, `rule.level >= minLevel`, sort desc, size=limit) to `WAZUH_INDEXER_URL/WAZUH_INDEX` with Basic auth. Wraps network and HTTP errors with cause codes. |
| `makeMock` | `() → alert[]` | Four staged mock alerts (SSH brute force → success → LSASS dump on one user/host, plus one benign AV event) with stable IDs so re-fetch dedups. Exercises correlation, promotion, and MITRE paths. |
| `fetchAlerts` | `(opts) → Promise<alert[]>` | Dispatcher: mock mode (`WAZUH_MODE=mock`) or live indexer. |

### 3.4 `api/src/services/signature.js` — noise-reduction fingerprint

| Function | Signature | Description |
|---|---|---|
| `alertSignature` | `(alert) → string` | SHA-256 over `rule_id|src_ip|dst_ip|username|hostname|target_db`, truncated to 16 hex chars. Alerts with identical signatures are triaged once. **Known gap:** exact-match on src_ip means rotating-source attacks fragment into many signatures; no time component means a signature (and its cached verdict) lives forever. |

### 3.5 `api/src/services/llm.js` — all LLM integration

**Constants:** `VALID_STAGES` (15 MITRE tactics + `unknown`), `STAGE_ALIASES` (common model synonyms → canonical), `SEVERITIES`, `VERDICTS`.

| Function | Signature | Description |
|---|---|---|
| `normalizeStage` | `(v) → string` | Lowercase/underscore a model-supplied stage; map through aliases; default `unknown`. |
| `resolveProvider` | `(settings) → {provider, baseUrl, model, apiKey, jsonMode}` | Resolves Groq (JSON mode on), Anthropic via the OpenAI-compatible endpoint (JSON mode off — relies on prompt + repair loop), or Ollama. Settings override env; throws if the required API key is absent. |
| `chatJSON` | `({messages, settings, maxTokens=600}) → Promise<{parsed, usage, model, provider, processing_ms}>` | Low-level JSON chat call shared by triage and correlation. Up to 3 attempts: honors `retry-after` on 429 (min 8 s escalating), throws on other HTTP errors, and on invalid JSON appends the bad output plus a repair instruction and retries. `temperature: 0.1`. |
| `triageAlert` | `(alert, enrichmentCtx, settings) → Promise<verdict>` | **Pipeline-mode triage.** Builds a compact alert view (entities, MITRE, `full_log` sliced to 400 chars) + enrichment blob; sends with `TRIAGE_SYSTEM_PROMPT` (senior-SOC-analyst persona, JSON-only schema). Post-validates: stage normalized, severity defaulted to `medium`, verdict to `needs_investigation`, confidence clamped 0–1, arrays/strings coerced. Returns verdict + model/provider/token/latency metadata. **Roadmap: only gray-zone alerts reach this path (batched).** |
| `correlateAlerts` | `(alerts[], settings) → Promise<incident[]>` | **LLM cross-alert correlation.** Compacts each alert via `compactAlert()`, sends up to 60 with `CORRELATION_SYSTEM_PROMPT` (`maxTokens: 2000`). Guards: model-supplied `alert_ids` filtered against the input set (drops hallucinations); incidents with 0 valid ids dropped; single-alert incidents dropped unless severity `critical`; severity/confidence/stages/entities validated and normalized. **Roadmap Phase 2 replaces this with graph correlation; LLM retained only for narration.** |
| `compactAlert` | `(a) → object` | Token-lean alert projection: id, time, level, desc, triage severity/stage/verdict, entities, MITRE techniques, first key finding. |
| `parseArgs` | `(s) → object` | Safe parse of tool-call argument strings; `{}` on failure. |
| `postChat` | `(body, conn) → Promise<json>` | Raw chat-completions POST used by the tool loop; same 429 backoff/retry contract as `chatJSON` without JSON parsing. |
| `runToolLoop` | `({messages, tools, dispatch, settings, maxTokens=700, maxIterations=5}) → Promise<{content, trace, usage, model, provider}>` | Generic agentic driver. Per iteration: call model with `tool_choice:'auto'` (forced `'none'` on the final iteration so it must answer); execute every returned tool call through `dispatch`; push results back as `role:'tool'` messages (result truncated to 4 000 chars, trace entry to 600). Accumulates token usage; returns the audit `trace`. |
| `extractJSON` | `(s) → object\|null` | Strips markdown fences, attempts direct parse, falls back to first `{...}` block. |
| `investigateAlert` | `(alert, settings) → Promise<verdict>` | **Agentic-mode triage.** `TRIAGE_SYSTEM_PROMPT` extended with investigator instructions; tools from `services/tools.js`; up to 5 iterations. Final content parsed via `extractJSON` and validated identically to `triageAlert`. Adds `investigation` (trace) and `tools_used` to the verdict. |
| `chatAgent` | `(question, history, settings) → Promise<{answer, tools_used, tokens}>` | SOC assistant chatbot. Keeps the last 8 sanitized turns, question capped at 2 000 chars; runs the tool loop over the read-only `dbtools` set (`maxTokens: 900`). System prompt enforces grounding ("never invent IDs"), prioritization guidance, and read-only posture. |

### 3.6 `api/src/services/tools.js` — agentic triage tools (enrichment-backed)

`TRIAGE_TOOLS` — seven OpenAI-style function schemas exposed to `investigateAlert`:

| Tool | Backing endpoint | Purpose |
|---|---|---|
| `get_ad_user` | `GET /ad/users/:sam` | Privilege tier, criticality, MFA, logon hours, home subnet, enabled state. |
| `check_logon` | `POST /ad/logon-check` | Off-hours / foreign-subnet / disabled-account anomaly check for a logon. |
| `get_asset_by_host` | `GET /cmdb/by-hostname/:h` | Asset criticality, environment, owner, crown-jewel flag. |
| `get_asset_by_ip` | `GET /cmdb/by-ip/:ip` | CMDB lookup by IP. |
| `get_edr_detections` | `GET /edr/detections/:h?hours=N` | Recent EDR detections on a host (default 48 h). |
| `check_threat_intel` | `GET /tip/:indicator` | TI verdict for IP/domain/hash. |
| `get_vuln_risk` | `GET /vuln/:h/risk` | Open vuln count, max CVSS, exploitable count. |

| Function | Signature | Description |
|---|---|---|
| `get` / `post` | `(path[, body]) → Promise<json>` | Fetch helpers with 8 s `AbortSignal` timeout; non-OK responses returned as `{error, status}` objects rather than thrown (keeps the tool loop alive). |
| `dispatch` | `(name, args) → Promise<json>` | Switch mapping tool name → endpoint with URL-encoding; unknown names return `{error}`. |

### 3.7 `api/src/services/dbtools.js` — chat assistant tools (read-only, parameterized)

`CHAT_TOOLS` — seven schemas. Every handler uses parameterized SQL; there is **no path for model-authored SQL**. `limit` values are parsed and capped in code.

| Function | Description |
|---|---|
| `search_alerts(a)` | Filtered search over triaged alerts (severity, verdict, username/hostname ILIKE, src_ip, last-N-hours). Compact rows, limit ≤ 50. |
| `get_alert(a)` | Full alert row by id, including enrichment and verdict (with investigation trace when present). |
| `top_critical_alerts(a)` | Open (non-auto-closed) `true_positive`/`needs_investigation` alerts ranked by severity → rule level → recency. Limit ≤ 30. |
| `list_incidents(a)` | Incidents filtered by status/severity, newest `last_seen` first, with member count. Limit ≤ 50. |
| `get_incident(a)` | One incident plus a compact projection of its member alerts. |
| `pivot_indicator(a)` | Sweep alerts (`src_ip`/`username` exact, `hostname` LIKE) and incidents (member id or `common_entities` ILIKE) touching an indicator. **Roadmap Phase 4: replace with observables-table joins.** |
| `get_stats()` | Pipeline totals (`getAlertStats`), severity split, incident status counts. |
| `dispatch(name, args)` | Handler-map dispatcher; catches and returns errors as `{error}` objects. |

### 3.8 `api/src/workers/pipeline.js` — orchestration

| Function | Signature | Description |
|---|---|---|
| `getEnrichmentUrl` | `() → string` | `ENRICHMENT_URL` env (default `http://enrichment:3001`), trailing slash stripped. |
| `safeError` | `(err) → string` | Guarantees a string message from anything thrown (Error, string, object, other). |
| `enrichAlert` | `(alert) → Promise<context>` | POST the alert's entities + timestamp to `/enrich` (10 s timeout); throws with truncated body on non-OK. |
| `ingestAlerts` | `(alerts[], runId) → Promise<{stored, duplicates}>` | Per-alert `INSERT ... ON CONFLICT (id) DO NOTHING` with initial `pending` statuses; row-count distinguishes new vs duplicate; per-row failures logged, not fatal. **Roadmap Phase 4: batch via `unnest`.** |
| `enrichPending` | `(limit=100) → Promise<{enriched, failed}>` | Selects `enrichment_status='pending'` newest-first (catches backlog across runs); stores context as JSONB on success; on failure sets `enrichment_failed` + truncated error and continues. Sequential — Phase 4 adds a concurrency pool. |
| `triagePending` | `(settings, limit=50) → Promise<{triaged, failed, llm_calls, cache_hits, clusters}>` | **Core triage.** Selects pending-triage alerts whose enrichment finished (either outcome), ordered by rule level then recency. Groups rows into clusters by `alertSignature`. Per cluster: (1) cache lookup by signature (hit → reuse verdict, increment `hits`); (2) miss → `investigateAlert` (agentic) or `triageAlert` (pipeline), then cache upsert; (3) apply the verdict to every member, evaluating **auto-close gates** per alert (verdict in `autoclose_verdicts` list, confidence ≥ `autoclose_confidence`, severity ≤ `autoclose_max_severity`). Cluster failure marks every member `triage_failed`. **Roadmap Phase 1 replaces steps 1–2 with the risk engine; LLM only for the gray zone.** |
| `runCycle` | `(trigger='scheduler') → Promise<{runId, stats}>` | Full cycle: read settings → `startFetchRun` → fetch → ingest → `enrichPending(100)` → `triagePending(_,50)` → optional `correlatePending` + `promoteSingletons` → `finishFetchRun` with per-stage stats (status `error` on throw). |

### 3.9 `api/src/workers/correlation.js` — incident construction

| Function | Signature | Description |
|---|---|---|
| `maxSeverity` | `(a, b) → string` | Higher of two severities via `SEV_ORDER`. |
| `incidentKey` | `(ids[]) → string` | SHA-256 of the sorted member-ID set, first 32 hex chars — detects the "same" incident across non-deterministic LLM runs. **Roadmap Phase 2: derive from root entities + time bucket instead (stable as incidents grow).** |
| `upsertIncident` | `(inc, firstSeen, lastSeen, runId, incidentType='correlation') → Promise<'created'\|'updated'>` | If any **open** incident shares an alert id: merge — union member ids and stages, take max severity, overwrite title/narrative/actions, widen first/last seen, recompute key; a promoted singleton absorbed by correlation graduates to type `correlation`. Otherwise insert with `ON CONFLICT (incident_key) DO UPDATE`; `(xmax = 0)` distinguishes fresh insert from update. Closed/false-positive incidents are never reopened — related new activity becomes a fresh incident. |
| `correlatePending` | `(settings, runId) → Promise<{incidents_created, incidents_updated, considered}>` | Selects triaged, non-auto-closed alerts in the last `correlation_lookback_hours` (default 24) capped at `correlation_max_alerts` (default 60), highest level first; short-circuits below 2 rows. Sends to `correlateAlerts`; computes first/last seen from member timestamps; upserts each incident. |
| `promoteSingletons` | `(settings, runId) → Promise<{promoted}>` | Promotes significant standalone alerts (verdict in `incident_promote_verdicts`, severity ≥ `incident_promote_min_severity`, not already in an open incident) into single-alert incidents of type `triage`, carrying the triage verdict's narrative/actions/stages. Makes the Incidents page a triage queue, not just correlation output. |

### 3.10 `api/src/workers/scheduler.js` — cron & manual execution

Module state: `_task`, `_running` (overlap guard), `_lastRun`, `_lastResult`, `_lastError`.

| Function | Signature | Description |
|---|---|---|
| `cronExpr` | `(minutes) → string` | `*/N * * * *`, floored at 1. |
| `_execute` | `(trigger) → Promise<result>` | Overlap-guarded cycle runner: skips with `{skipped:true}` if a cycle is active; records last run/result/error; never throws to cron. |
| `start` | `() → Promise<void>` | Reads settings; schedules the cron only if `scheduler_enabled==='true'` at `interval_minutes`. |
| `restart` | `() → Promise<void>` | Stop + start; called by the settings route when scheduler keys change. |
| `triggerNow` | `() → Promise<result>` | Manual run (trigger `'manual'`), awaits the full cycle. |
| `status` | `() → object` | `{running, cycle_active, last_run, last_result, last_error}`. |

### 3.11 `api/src/routes/index.js` — REST API surface

All handlers wrap in try/catch → `500 {error}`. Mounted at `/api`.

| Route | Description |
|---|---|
| `GET /health` | Liveness. |
| `GET /settings` | All settings + alert stats. |
| `PUT /settings` | Allow-listed key updates only (scheduler, fetch, LLM provider/models, triage mode, auto-close, correlation, caching, promotion). Restarts cron when scheduler keys change. |
| `GET /scheduler/status` | Scheduler state + last 20 `fetch_runs`. |
| `POST /scheduler/run-now` | Synchronous manual cycle. |
| `POST /scheduler/enrich-pending` | Manual enrichment pass (limit 50). |
| `POST /scheduler/triage-pending` | Manual triage pass (limit 20). |
| `POST /scheduler/correlate-now` | Manual correlation pass. |
| `GET /alerts` | Paged list with filters: severity, verdict, both statuses, src_ip, username/hostname ILIKE, level range, time range, free-text search over rule_desc/full_log. All parameterized. |
| `GET /alerts/critical` | Top open critical/high alerts. |
| `GET /alerts/:id` | Full alert detail. |
| `POST /alerts/:id/retriage` | Reset one alert to pending triage and re-run. |
| `GET /incidents`, `GET /incidents/:id` | Incident list / detail with member alerts. |
| `PATCH /incidents/:id` | Analyst status/disposition update (`open`/`closed`/`false_positive`). |
| `GET /pivot?indicator=` | Indicator sweep across alerts + incidents. |
| `GET /reports/alerts`, `/reports/incidents`, `/reports/incidents/:id` | Streamed PDF reports (summary/detailed via query param). |
| `POST /chat` | Chat assistant: `{question, history}` → grounded answer + tool trace. |
| `GET /stats`, `GET /runs` | Dashboard stats; fetch-run history. |

### 3.12 `enrichment/src/index.js` — context provider

Datasets loaded once at startup into keyed maps: AD users (by `samAccountName`), AD groups, CMDB (by hostname and by IP), EDR agents, EDR detections, TIP indicators (by value), vuln findings.

| Endpoint / function | Description |
|---|---|
| `GET /health` | Dataset counts. |
| `GET /ad/users/:sam` | AD user record or 404. |
| `POST /ad/logon-check` | Anomaly evaluation: outside `logonHours` (UTC hour window), source outside `homeSubnet` (bitwise IPv4 mask check), disabled account; MFA warning as detail. Verdict: `suspicious` (≥ 2 anomalies) / `low_risk` (1) / `normal` (0); includes privilege/criticality tiers. |
| `GET /cmdb/by-hostname/:h`, `GET /cmdb/by-ip/:ip` | Asset record or 404. |
| `GET /edr/agent/:h` | EDR agent presence/state. |
| `GET /edr/detections/:h?hours=N` | Detections within window, newest first, severity histogram, `agent_present` flag. |
| `GET /tip/:value` | TI record or `{found:false, verdict:'no_known_threat'}` (soft miss — never 404s, so the LLM tool loop reads a clean negative). |
| `POST /tip/bulk` | Batch TI lookup. |
| `GET /vuln/:hostname/risk` | Open/in-remediation findings: total, severity histogram, exploitable count, max CVSS. |
| `POST /enrich` | **Composite endpoint the pipeline calls.** One pass: AD user + inline logon check; src-IP TI + src asset; target host resolution (hostname, else CMDB-by-dst_ip) → dst asset, EDR agent, 48 h detections (top 5), vuln risk summary. Returns `{ok, context}`. **Roadmap Phase 1: this is where typed features are computed.** |

### 3.13 `api/src/services/reports.js` — PDF generation (pdfkit)

Layout primitives: `newDoc` (A4, buffered pages, metadata), `header` (branded title block + rule), `sectionTitle` (with page-break guard), `kvGrid` (two-column key/value grid), `table` (fixed-column table with header repaint on page break), `footer` (page numbers over buffered pages), `finalize` (footer + end → Buffer promise), `hoursClause` (safe interval WHERE fragment from a parsed int).

| Function | Description |
|---|---|
| `alertAggregates(hours)` | Severity/verdict/status counts for the window. |
| `alertsSummary(hours)` | One-page KPI + severity/verdict breakdown report. |
| `alertsDetailed(hours, limit=1000)` | Tabular alert dump with verdict columns. |
| `incidentRows(status)` / `membersFor(inc)` | Incident query helpers. |
| `incidentsSummary()` / `incidentsDetailed()` | Incident overview / full narratives + members. |
| `renderIncidentBody(doc, inc, alerts)` | Shared renderer: metadata grid, attack stages, narrative, recommended actions, member table. |
| `singleIncident(id)` | One-incident report for handoff/ticket attachment. |

### 3.14 `eval/` — evaluation harness

| File / function | Description |
|---|---|
| `metrics.js → classifyMetrics(pairs, labels)` | Verdict classification: per-class precision/recall/F1, support, confusion matrix, macro-F1, accuracy. Pure function, unit-testable. |
| `metrics.js → pairwiseClusterMetrics(truthGroups, predGroups)` | Correlation quality as pairwise clustering: precision/recall/F1 over same-incident pairs + Adjusted Rand Index. |
| `metrics.js → efficiencyMetrics(e)` | LLM-calls-per-alert, auto-close rate, tokens, wall time. |
| `evaluate.js` | CLI: `--demo` (built-in synthetic data) or `--truth gt.json --pred preds.json`. Builds and prints the triage/correlation/efficiency report with coverage. |
| `export_predictions.js` | Pulls predictions (verdict + incident membership + efficiency counters) from a live API instance into the `preds.json` format. |
| `sample_ground_truth.json` | Reference ground-truth format: `{alerts: [{id, verdict, incident}]}`. |

**This harness is the acceptance gate for every roadmap phase.**

### 3.15 `frontend/src` — UI (component summary)

| Component | Role |
|---|---|
| `App.jsx` | Router/shell, navigation between pages. |
| `pages/Dashboard.jsx` | KPI tiles + pipeline stats from `/stats` and `/runs`. |
| `pages/Alerts.jsx` | Filterable/paged alert table over `GET /alerts`; detail view with enrichment, verdict, investigation trace; retriage action. |
| `pages/Incidents.jsx` | Incident queue over `GET /incidents`; detail with narrative, stages, members; status disposition via `PATCH`. |
| `pages/Pivot.jsx` | Indicator sweep UI over `GET /pivot`. |
| `pages/Reports.jsx` / `Reports.jsx` | PDF report selection and download. |
| `pages/Settings.jsx` | Full settings editor (scheduler, fetch, LLM provider/model, triage mode, auto-close, correlation, promotion, caching) + manual pipeline triggers. |
| `components/ChatWidget.jsx` | Embedded SOC assistant over `POST /chat` with history. |
| `lib/api.js` | Fetch wrapper for the REST API. |

### 3.16 Settings reference (`settings` table)

| Key | Default | Consumed by |
|---|---|---|
| `scheduler_enabled` / `interval_minutes` | `false` / `5` | scheduler |
| `lookback_minutes` / `min_level` / `limit` | `15` / `7` / `200` | fetch |
| `llm_provider` / `groq_model` / `ollama_model` / `anthropic_model` | `groq` / `llama-3.3-70b-versatile` / `llama3.1:8b` / — | `resolveProvider` |
| `triage_mode` | `pipeline` | `triagePending` (pipeline vs agentic) |
| `caching_enabled` | `true` | triage cache |
| `autoclose_enabled` / `autoclose_confidence` / `autoclose_max_severity` / `autoclose_verdicts` | `false` / `0.85` / `medium` / `false_positive,benign_anomaly` | auto-close gates |
| `correlation_enabled` / `correlation_lookback_hours` / `correlation_max_alerts` | `true` / `24` / `60` | correlation |
| `incident_promote_enabled` / `incident_promote_verdicts` / `incident_promote_min_severity` | `true` / `true_positive,needs_investigation` / `high` | singleton promotion |

---

## Appendix — Known issues quick list

1. `triage_cache` has no TTL, no prompt-version/enrichment-hash in key; failed-enrichment verdicts are cached.
2. LLM confidence gates auto-close (uncalibrated).
3. LLM correlation churns incident titles/narratives every cycle; `incident_key` unstable as membership grows.
4. Signature fragmentation under rotating source IPs; no time bucketing.
5. Hardcoded entity extraction (`target_db` list, hostname prefixes, group→technique regexes).
6. Sequential per-alert insert and enrichment; no batching or concurrency.
7. `NODE_TLS_REJECT_UNAUTHORIZED=0` process-wide.
8. Correlation output token cap (2 000) vs up to 60 input alerts — truncation risk.
9. Pretty-printed JSON prompts and raw `full_log` slices inflate tokens ~30–40 %.
10. `pivot_indicator` relies on `ILIKE` over columns and JSON text — replace with observables table.
