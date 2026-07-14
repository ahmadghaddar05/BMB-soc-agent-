'use strict';

const VALID_STAGES = new Set([
  'reconnaissance','resource_development','initial_access','execution',
  'persistence','privilege_escalation','defense_evasion','credential_access',
  'discovery','lateral_movement','collection','command_and_control',
  'exfiltration','impact','unknown',
]);

const STAGE_ALIASES = {
  'privilege-escalation': 'privilege_escalation',
  'lateral-movement':     'lateral_movement',
  'command-and-control':  'command_and_control',
  'data_exfiltration':    'exfiltration',
  'data-exfiltration':    'exfiltration',
  'credential_dumping':   'credential_access',
  'credential-dumping':   'credential_access',
  'credential_theft':     'credential_access',
  'command_execution':    'execution',
  'code_execution':       'execution',
  'c2':                   'command_and_control',
  'brute_force':          'credential_access',
  'network_scanning':     'reconnaissance',
  'web_exploitation':     'initial_access',
  'ransomware':           'impact',
  'defense-evasion':      'defense_evasion',
};

const SEVERITIES = ['critical','high','medium','low','informational'];
const VERDICTS   = ['true_positive','false_positive','needs_investigation','benign_anomaly'];

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : fallback));
}

// Keep prompt evidence useful while preventing oversized enrichment payloads from
// dominating every request. Security-relevant scalar values are preserved;
// only deep/very large collections and strings are bounded.
function compactForPrompt(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 500 ? value.slice(0, 500) + '…' : value;
  if (depth >= 5) return '[depth limited]';
  if (Array.isArray(value)) {
    const out = value.slice(0, 10).map(v => compactForPrompt(v, depth + 1));
    if (value.length > 10) out.push({ omitted_items: value.length - 10 });
    return out;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    const out = {};
    for (const [key, child] of entries.slice(0, 40)) out[key] = compactForPrompt(child, depth + 1);
    if (entries.length > 40) out._omitted_fields = entries.length - 40;
    return out;
  }
  return String(value);
}

function normalizeStage(v) {
  if (!v) return 'unknown';
  const l = String(v).toLowerCase().trim().replace(/\s+/g, '_');
  return VALID_STAGES.has(l) ? l : (STAGE_ALIASES[l] || 'unknown');
}

// ── Provider resolution (shared by triage + correlation) ───────────────────
function resolveProvider(settings = {}) {
  const provider = settings.llm_provider || process.env.LLM_PROVIDER || 'groq';
  if (provider === 'groq') {
    const apiKey = process.env.GROQ_API_KEY || '';
    if (!apiKey) throw new Error('GROQ_API_KEY environment variable is not set');
    return {
      provider,
      baseUrl: 'https://api.groq.com/openai/v1',
      model:   settings.groq_model || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      apiKey,
      jsonMode: true,
    };
  }
  if (provider === 'anthropic') {
    // Anthropic's OpenAI-compatible endpoint: same /chat/completions surface,
    // Anthropic API key as the bearer token, Claude model name. The compat layer
    // covers core chat + tool calling but not response_format json mode, so we
    // flag jsonMode:false and lean on the prompt + JSON-repair loop instead.
    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    return {
      provider,
      baseUrl: 'https://api.anthropic.com/v1',
      model:   settings.anthropic_model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      apiKey,
      jsonMode: false,
    };
  }
  return {
    provider,
    baseUrl: (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '') + '/v1',
    model:   settings.ollama_model || process.env.OLLAMA_MODEL || 'llama3.1:8b',
    apiKey:  'ollama',
    jsonMode: true,
  };
}

// ── Low-level JSON chat call with 429 backoff + JSON-repair retry ──────────
// Shared by triageAlert and correlateAlerts so both behave identically.
async function chatJSON({ messages, settings = {}, maxTokens = 600 }) {
  const { baseUrl, model, apiKey, provider, jsonMode } = resolveProvider(settings);
  const cumulativeUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  for (let attempt = 0; attempt <= 2; attempt++) {
    const t0 = Date.now();

    const body = { model, messages, temperature: 0.1, max_tokens: maxTokens };
    if (jsonMode) body.response_format = { type: 'json_object' };

    let res;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (netErr) {
      throw new Error(`LLM network error (${provider}): ${netErr.message || String(netErr)}`);
    }

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '8');
      const wait = Math.max(retryAfter * 1000, (attempt + 1) * 8000);
      console.warn(`[llm] rate limited, waiting ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`LLM HTTP ${res.status} from ${provider}: ${txt.slice(0, 300)}`);
    }

    const data = await res.json();
    const raw  = data.choices?.[0]?.message?.content;
    if (!raw) throw new Error('LLM returned empty response');

    const callUsage = data.usage || {};
    const estimatedPrompt = Math.ceil(JSON.stringify(messages).length / 4);
    const estimatedCompletion = Math.ceil(
      (typeof raw === 'string' ? raw.length : JSON.stringify(raw).length) / 4
    );
    cumulativeUsage.prompt_tokens += callUsage.prompt_tokens || estimatedPrompt;
    cumulativeUsage.completion_tokens += callUsage.completion_tokens || estimatedCompletion;
    cumulativeUsage.total_tokens += callUsage.total_tokens ||
      ((callUsage.prompt_tokens || estimatedPrompt) +
       (callUsage.completion_tokens || estimatedCompletion));

    let parsed;
    if (typeof raw === 'object' && raw !== null) {
      parsed = raw;
    } else {
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        if (attempt < 2) {
          messages.push(
            { role: 'assistant', content: String(raw) },
            { role: 'user', content: 'Your response was not valid JSON. Reply with only the JSON object, no markdown or explanation.' }
          );
          continue;
        }
        throw new Error(`LLM returned invalid JSON after ${attempt + 1} attempts: ${String(raw).slice(0, 200)}`);
      }
    }

    return { parsed, usage: cumulativeUsage, model, provider, processing_ms: Date.now() - t0 };
  }
  throw new Error('LLM call exhausted all retries');
}

// ═══════════════════════════════════════════════════════════════════════════
// TRIAGE — one alert at a time
// ═══════════════════════════════════════════════════════════════════════════
const TRIAGE_SYSTEM_PROMPT = `You are a senior SOC analyst at a bank. Given a Wazuh alert and enrichment context, produce a triage verdict.

Rules:
- Severity reflects business impact, not just rule level.
- Crown-jewel systems, privileged users, and known C2/TOR IPs always raise severity.
- Multiple stacked signals = high confidence true positive.
- Missing enrichment = lower confidence, use needs_investigation.
- recommended_actions must be specific (e.g. "Disable account X in AD"), not generic.

Respond ONLY with valid JSON (no markdown, no code blocks):
{
  "severity":            "critical"|"high"|"medium"|"low"|"informational",
  "verdict":             "true_positive"|"false_positive"|"needs_investigation"|"benign_anomaly",
  "confidence":          <number 0.0-1.0>,
  "attack_stage":        "<MITRE tactic e.g. credential_access>",
  "key_findings":        ["<finding>", "<finding>", "<finding>"],
  "recommended_actions": ["<action>", "<action>"],
  "narrative":           "<2-4 sentences>"
}`;

async function triageAlert(alert, enrichmentCtx, settings = {}) {
  const payload = {
    alert: {
      id:          alert.id,
      timestamp:   alert.timestamp,
      rule_id:     alert.rule_id,
      rule_level:  alert.rule_level,
      rule_desc:   alert.rule_desc,
      rule_groups: alert.rule_groups,
      src_ip:      alert.src_ip,
      dst_ip:      alert.dst_ip,
      username:    alert.username,
      hostname:    alert.hostname,
      target_db:   alert.target_db,
      process:     alert.process,
      mitre_techniques: alert.mitre_techniques || [],
      mitre_tactics:    alert.mitre_tactics || [],
      full_log:    String(alert.full_log || '').slice(0, 400),
    },
    enrichment: compactForPrompt(enrichmentCtx || {}),
  };

  const messages = [
    { role: 'system', content: TRIAGE_SYSTEM_PROMPT },
    { role: 'user',   content: `Triage this alert:\n\n${JSON.stringify(payload, null, 2)}` },
  ];

  const { parsed, usage, model, provider, processing_ms } =
    await chatJSON({ messages, settings, maxTokens: 600 });

  // Normalise + validate
  parsed.attack_stage = normalizeStage(parsed.attack_stage);
  if (!SEVERITIES.includes(parsed.severity)) parsed.severity = 'medium';
  if (!VERDICTS.includes(parsed.verdict))    parsed.verdict  = 'needs_investigation';
  parsed.confidence = Math.min(1, Math.max(0, parseFloat(parsed.confidence) || 0.5));
  if (!Array.isArray(parsed.key_findings))        parsed.key_findings        = [];
  if (!Array.isArray(parsed.recommended_actions)) parsed.recommended_actions = [];
  if (typeof parsed.narrative !== 'string')       parsed.narrative           = '';

  return {
    ...parsed,
    model,
    provider,
    prompt_tokens:     usage.prompt_tokens     || 0,
    completion_tokens: usage.completion_tokens || 0,
    total_tokens:      usage.total_tokens      || 0,
    processing_ms,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CORRELATION — analyse a batch of triaged alerts and group them into incidents
// This is the AI cross-correlation pass. The LLM decides what relates to what;
// the caller only bounds the candidate set (all triaged alerts in last N hours).
// ═══════════════════════════════════════════════════════════════════════════
const CORRELATION_SYSTEM_PROMPT = `You are a senior SOC analyst at a bank performing cross-alert correlation.
You receive a batch of already-triaged Wazuh alerts from the last several hours. Decide which alerts
belong to the SAME security incident — i.e. the same actor, campaign, or causally-linked chain of
activity — and describe each incident.

Correlate on:
- shared entities (username, hostname, source IP, destination IP, process, target database),
- temporal proximity,
- logical attack progression across MITRE ATT&CK tactics
  (e.g. brute_force -> successful logon -> privilege_escalation -> lateral_movement on the same host/user;
   or recon from one IP -> exploitation -> C2 -> exfiltration).

Rules:
- Only group alerts that have a plausible relationship. Do NOT force unrelated alerts together.
  Two alerts sharing only a timestamp but no entity or logical link are NOT one incident.
- An incident normally contains 2+ alerts. A SINGLE alert may be its own incident only if it is
  independently critical (e.g. confirmed ransomware or data exfiltration from a crown-jewel system).
- Use ONLY the alert IDs given to you. NEVER invent IDs. Omit alerts that don't correlate.
- severity = business impact of the whole incident (driven by its worst element + assets/users involved).
- attack_stages = the distinct MITRE tactics observed across the incident, in progression order.
- narrative = explain HOW the alerts connect and what the attacker appears to be doing, naming the
  shared entities. 2-5 sentences.
- recommended_actions = specific containment/investigation steps for the incident as a whole.

Respond ONLY with valid JSON (no markdown, no code blocks):
{
  "incidents": [
    {
      "title":               "<short incident title>",
      "severity":            "critical"|"high"|"medium"|"low",
      "confidence":          <number 0.0-1.0>,
      "alert_ids":           ["<id>", "<id>"],
      "attack_stages":       ["<tactic>", "<tactic>"],
      "common_entities":     { "users": [], "hosts": [], "ips": [] },
      "narrative":           "<2-5 sentences>",
      "recommended_actions": ["<action>", "<action>"]
    }
  ]
}
If no alerts correlate into incidents, return { "incidents": [] }.`;

function compactAlert(a) {
  const v = a.verdict || {};
  return {
    id:      a.id,
    time:    a.timestamp,
    level:   a.rule_level,
    desc:    a.rule_desc,
    sev:     v.severity || null,
    stage:   v.attack_stage || null,
    verdict: v.verdict || null,
    src_ip:  a.src_ip || null,
    dst_ip:  a.dst_ip || null,
    user:    a.username || null,
    host:    a.hostname || null,
    process: a.process || null,
    db:      a.target_db || null,
    mitre:   Array.isArray(a.mitre_techniques) ? a.mitre_techniques : [],
    finding: Array.isArray(v.key_findings) ? (v.key_findings[0] || null) : null,
  };
}

async function correlateAlerts(alerts, settings = {}) {
  if (!Array.isArray(alerts) || alerts.length < 2) return { incidents: [], usage: {} };

  const inputIds = new Set(alerts.map(a => a.id));
  const compact  = alerts.map(compactAlert);

  const messages = [
    { role: 'system', content: CORRELATION_SYSTEM_PROMPT },
    { role: 'user',   content: `Correlate these ${compact.length} triaged alerts into incidents:\n\n${JSON.stringify(compact, null, 1)}` },
  ];

  const { parsed, usage } = await chatJSON({ messages, settings, maxTokens: 1600 });

  const rawIncidents = Array.isArray(parsed.incidents) ? parsed.incidents : [];
  const out = [];

  for (const inc of rawIncidents) {
    // Drop any hallucinated IDs the model may have invented.
    const ids = [...new Set((Array.isArray(inc.alert_ids) ? inc.alert_ids : [])
      .filter(id => inputIds.has(id)))];
    if (ids.length === 0) continue;

    const severity = SEVERITIES.includes(inc.severity) ? inc.severity : 'medium';

    // Require 2+ members unless the single alert is independently critical.
    if (ids.length < 2 && severity !== 'critical') continue;

    const ce = (inc.common_entities && typeof inc.common_entities === 'object') ? inc.common_entities : {};

    out.push({
      alert_ids:           ids,
      title:               (typeof inc.title === 'string' && inc.title.trim())
                             ? inc.title.trim().slice(0, 200)
                             : 'Correlated incident',
      severity,
      confidence:          Math.min(1, Math.max(0, parseFloat(inc.confidence) || 0.5)),
      attack_stages:       Array.isArray(inc.attack_stages)
                             ? [...new Set(inc.attack_stages.map(normalizeStage))]
                             : [],
      common_entities:     {
                             users: Array.isArray(ce.users) ? ce.users.map(String) : [],
                             hosts: Array.isArray(ce.hosts) ? ce.hosts.map(String) : [],
                             ips:   Array.isArray(ce.ips)   ? ce.ips.map(String)   : [],
                           },
      narrative:           typeof inc.narrative === 'string' ? inc.narrative : '',
      recommended_actions: Array.isArray(inc.recommended_actions)
                             ? inc.recommended_actions.map(String)
                             : [],
    });
  }

  return { incidents: out, usage };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL-CALLING LOOP — generic agentic driver shared by agentic triage + chat
// The model is given tools and decides which to call; we execute them, feed the
// results back, and repeat until it produces a final answer (or we hit the cap).
// ═══════════════════════════════════════════════════════════════════════════
function parseArgs(s) {
  if (s && typeof s === 'object') return s;
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

async function postChat(body, { baseUrl, apiKey, provider }) {
  for (let attempt = 0; attempt <= 2; attempt++) {
    let res;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
    } catch (netErr) {
      throw new Error(`LLM network error (${provider}): ${netErr.message || String(netErr)}`);
    }
    if (res.status === 429) {
      const wait = Math.max(parseInt(res.headers.get('retry-after') || '8') * 1000, (attempt + 1) * 8000);
      console.warn(`[llm] rate limited, waiting ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`LLM HTTP ${res.status} from ${provider}: ${txt.slice(0, 300)}`);
    }
    return res.json();
  }
  throw new Error('LLM call exhausted all retries');
}

// Runs the tool loop. Returns { content, trace, usage }. `trace` records every
// tool call (name, args, short result) so the verdict/answer is auditable.
async function runToolLoop({ messages, tools, dispatch, settings = {}, maxTokens = 700, maxIterations = 3, toolResultChars = 2200 }) {
  const conn = resolveProvider(settings);
  const trace = [];
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  for (let iter = 0; iter < maxIterations; iter++) {
    const last = iter === maxIterations - 1;
    const body = {
      model: conn.model,
      messages,
      temperature: 0.1,
      max_tokens: maxTokens,
      tools,
      // On the final iteration force the model to stop calling tools and answer.
      tool_choice: last ? 'none' : 'auto',
    };
    const data = await postChat(body, conn);
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('LLM returned no message');

    const u = data.usage || {};
    const estimatedPrompt = Math.ceil(
      (JSON.stringify(messages).length + JSON.stringify(tools).length) / 4
    );
    const estimatedCompletion = Math.ceil(JSON.stringify(msg).length / 4);
    const promptUsed = u.prompt_tokens || estimatedPrompt;
    const completionUsed = u.completion_tokens || estimatedCompletion;
    usage.prompt_tokens += promptUsed;
    usage.completion_tokens += completionUsed;
    usage.total_tokens += u.total_tokens || (promptUsed + completionUsed);

    messages.push(msg);

    const calls = msg.tool_calls || [];
    if (!calls.length) {
      return { content: msg.content || '', trace, usage, model: conn.model, provider: conn.provider };
    }

    for (const tc of calls) {
      const name = tc.function?.name;
      const args = parseArgs(tc.function?.arguments);
      let result;
      try { result = await dispatch(name, args); }
      catch (e) { result = { error: e.message || String(e) }; }
      const resultStr = JSON.stringify(result);
      trace.push({ step: iter + 1, tool: name, args, result: resultStr.slice(0, 600) });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr.slice(0, toolResultChars) });
    }
  }
  return { content: '', trace, usage, model: conn.model, provider: conn.provider };
}

function extractJSON(s) {
  if (!s) return null;
  let t = String(s).trim().replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  try { return JSON.parse(t); } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

// ── Agentic triage: the model investigates with enrichment tools, then verdicts
async function investigateAlert(alert, settings = {}) {
  const { TRIAGE_TOOLS, dispatch } = require('./tools');

  const system = TRIAGE_SYSTEM_PROMPT + `

You are working as an investigator. Before deciding, you MAY call the provided tools to gather
context (AD user, CMDB asset, EDR detections, threat intel, vulnerabilities). Investigate only what
is relevant — do not call tools whose result cannot change your verdict. When you have enough
evidence, STOP calling tools and respond with ONLY the verdict JSON described above.`;

  const alertView = {
    id: alert.id, timestamp: alert.timestamp, rule_id: alert.rule_id, rule_level: alert.rule_level,
    rule_desc: alert.rule_desc, rule_groups: alert.rule_groups, src_ip: alert.src_ip, dst_ip: alert.dst_ip,
    username: alert.username, hostname: alert.hostname, target_db: alert.target_db, process: alert.process,
    mitre_techniques: alert.mitre_techniques || [], mitre_tactics: alert.mitre_tactics || [],
    full_log: String(alert.full_log || '').slice(0, 400),
  };

  const messages = [
    { role: 'system', content: system },
    { role: 'user',   content: `Investigate and triage this alert. Use tools as needed.\n\n${JSON.stringify(alertView, null, 2)}` },
  ];

  const t0 = Date.now();
  const maxIterations = clampInt(settings.agentic_max_iterations, 3, 2, 4);
  const { content, trace, usage, model, provider } =
    await runToolLoop({
      messages, tools: TRIAGE_TOOLS, dispatch, settings,
      maxTokens: 650, maxIterations, toolResultChars: 2200,
    });

  let parsed = extractJSON(content) || {};
  parsed.attack_stage = normalizeStage(parsed.attack_stage);
  if (!SEVERITIES.includes(parsed.severity)) parsed.severity = 'medium';
  if (!VERDICTS.includes(parsed.verdict))    parsed.verdict  = 'needs_investigation';
  parsed.confidence = Math.min(1, Math.max(0, parseFloat(parsed.confidence) || 0.5));
  if (!Array.isArray(parsed.key_findings))        parsed.key_findings        = [];
  if (!Array.isArray(parsed.recommended_actions)) parsed.recommended_actions = [];
  if (typeof parsed.narrative !== 'string')       parsed.narrative           = '';

  return {
    ...parsed,
    model, provider,
    investigation: trace,
    tools_used: trace.length,
    prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens, processing_ms: Date.now() - t0,
  };
}

// ── Hybrid triage: inexpensive screening, agentic escalation only when useful
function shouldEscalateAgentically(alert, preliminary, settings = {}) {
  const minLevel = clampInt(settings.hybrid_agentic_min_rule_level, 12, 1, 20);
  const confidenceFloor = Math.min(0.95, Math.max(0.5,
    parseFloat(settings.hybrid_agentic_confidence_below || 0.82)));
  const level = parseInt(alert.rule_level, 10) || 0;
  const confidence = Number(preliminary.confidence) || 0;
  const highRisk =
    level >= minLevel ||
    preliminary.severity === 'critical' ||
    (preliminary.severity === 'high' && level >= Math.max(8, minLevel - 2));
  const ambiguous =
    preliminary.verdict === 'needs_investigation' ||
    confidence < confidenceFloor;
  return highRisk && ambiguous;
}

async function triageHybrid(alert, enrichmentCtx, settings = {}) {
  const preliminary = await triageAlert(alert, enrichmentCtx, settings);
  if (!shouldEscalateAgentically(alert, preliminary, settings)) {
    return {
      ...preliminary,
      triage_path: 'hybrid_screened',
      agentic_escalated: false,
    };
  }

  const investigated = await investigateAlert(alert, settings);
  return {
    ...investigated,
    prompt_tokens: (preliminary.prompt_tokens || 0) + (investigated.prompt_tokens || 0),
    completion_tokens: (preliminary.completion_tokens || 0) + (investigated.completion_tokens || 0),
    total_tokens: (preliminary.total_tokens || 0) + (investigated.total_tokens || 0),
    processing_ms: (preliminary.processing_ms || 0) + (investigated.processing_ms || 0),
    triage_path: 'hybrid_agentic',
    agentic_escalated: true,
    screening: {
      severity: preliminary.severity,
      verdict: preliminary.verdict,
      confidence: preliminary.confidence,
    },
  };
}

// ── SOC assistant chatbot: answers questions using read-only DB tools
const CHAT_SYSTEM_PROMPT = `You are the SOC Agent assistant, embedded in a bank's security operations platform.
You help analysts with triage, investigation, and prioritisation by querying live data through tools.

Guidelines:
- ALWAYS use tools to ground answers in real data. Never invent alert IDs, incident IDs, or numbers.
- When asked what to investigate or what's most critical, call top_critical_alerts and prioritise by
  severity, then verdict (true_positive > needs_investigation), then asset/user criticality.
- Be concise and specific. Reference alert/incident IDs. Summarise; don't dump raw JSON.
- If the data doesn't contain the answer, say so plainly.
- You are read-only: you cannot close, modify, or create anything — guide the analyst to do it in the UI.`;

async function chatAgent(question, history = [], settings = {}) {
  const { CHAT_TOOLS, dispatch } = require('./dbtools');
  const prior = (Array.isArray(history) ? history : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-8)
    .map(m => ({ role: m.role, content: m.content }));

  const messages = [
    { role: 'system', content: CHAT_SYSTEM_PROMPT },
    ...prior,
    { role: 'user', content: String(question || '').slice(0, 2000) },
  ];

  const { content, trace, usage } =
    await runToolLoop({ messages, tools: CHAT_TOOLS, dispatch, settings, maxTokens: 900, maxIterations: 5 });

  return {
    answer: content || "I couldn't find an answer to that.",
    tools_used: trace.map(t => ({ tool: t.tool, args: t.args })),
    tokens: usage.total_tokens,
  };
}

module.exports = {
  triageAlert, investigateAlert, triageHybrid, correlateAlerts, chatAgent,
  normalizeStage, resolveProvider, compactForPrompt,
};
