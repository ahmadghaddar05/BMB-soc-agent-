# Nous / hy3:free provider integration (Phase 4.5)

## Why
The OpenAI account is out of tokens, and the team wants to keep triaging and
correlating Elastic alerts while still being able to swap models from the
dashboard on the spot. This adds **Nous** (the Nous OpenAI-compatible chat
endpoint, model `hy3:free` by default) as a selectable provider *behind the same
Hermes contract* already used by triage and the grounded analyst chat.

## Architecture
- The application's AI boundary is chosen by `LLM_PROVIDER` (`hermes` | `nous`).
- `hermes` (default): unchanged — strict run-orchestration API at `HERMES_API_URL`.
- `nous`: a direct OpenAI-compatible `/chat/completions` call implemented in
  `api/src/services/hermes/nous.js`. It returns the **exact same shape**
  `{ runId, output, model, usage, attempts, latencyMs, capabilities }` that
  `triage.js` / `chat.js` already validate, so every strict guard is preserved:
  grounded-citation checks, JSON-schema validation, tool budgets, and audit
  records. `client.js` exposes a `createNousClient()` with the same interface
  (`handshake`, `runAgent`, `stopRun`) so `triageHermes` / `chatHermes` are
  provider-agnostic.

## What is NOT supported on Nous
- **Agentic / hybrid tool-calling modes.** hy3:free is unreliable for parallel
  function calling, and the BMB application owns the only permitted SOC tools.
  If a Nous run requests a tool in a tool-allowing mode, the existing screening
  policy rejects it (`HERMES_UNEXPECTED_TOOL_CALL`). Use **pipeline** mode with
  Nous — it is single-shot and matches hy3:free's strengths.
- **Correlation.** Still disabled in the codebase ("Phase 5 migration").

## Configuration
Environment (deployment defaults):
```
LLM_PROVIDER=hermes                 # or: nous
NOUS_BASE_URL=https://api.nousresearch.com/v1
NOUS_API_KEY=<your nous key>
NOUS_MODEL=hy3:free
NOUS_JSON_MODE=true                 # request json_object response_format
NOUS_REQUEST_TIMEOUT_MS=120000
```
The Hermes `HERMES_*` variables are still used when `LLM_PROVIDER=hermes`.

## Dashboard (change model on the spot)
Settings → **AI triage provider**:
- Provider = Hermes Agent  → uses `HERMES_MODEL`
- Provider = Nous (hy3:free / OpenAI-compatible) → uses the "Nous model" field
  (default `hy3:free`)

Saving persists `llm_provider` and `nous_model` into the `settings` table. The
next triage cycle reads them via `configFromSettings()` (no restart needed).
Validation rules: `llm_provider ∈ {hermes, nous}`, `nous_model` matches
`^[A-Za-z0-9._:/-]{1,200}$`.

## Triage cache
The cache key now incorporates the *effective* model (`effectiveModel()` in
`config.js`), so a verdict produced by `hy3:free` is never reused for
`hermes-agent` and vice-versa.

## Tests
`api/test/nous-provider.test.js` stubs the Nous chat endpoint and asserts:
1. a valid triage verdict passes the strict `parseTriageTurn` + `validateCitations`
   gate unchanged;
2. empty output is rejected as `HERMES_INVALID_OUTPUT`;
3. HTTP 429 surfaces as a retriable `HERMES_HTTP_ERROR`;
4. `createNousClient` is selected when `LLM_PROVIDER=nous` and returns the
   Hermes-compatible shape.

Run: `cd api && node --test --test-concurrency=1 test/nous-provider.test.js`

## Caveats / operational notes
- `hy3:free` is a free tier; the strict grounded-JSON + citation prompts are
  demanding. If verdicts come back malformed, the same fail-closed behaviour as
  the Hermes path applies (alert stays `triage_failed`, not silently wrong).
- Recommended starting mode with Nous: **Pipeline** (single call).
- This is an *additional* provider, not a replacement for the Hermes migration.
  The legacy `services/llm.js` (groq/anthropic/ollama) remains deprecated and is
  not wired into the live path.
