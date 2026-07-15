'use strict';

const crypto = require('crypto');
const db = require('../../db');
const { defaultHermesClient } = require('./client');
const { createAgentStore } = require('./store');
const { parseChatOutput, validateCitations } = require('./schemas');

const PROMPT_VERSION = 'soc-chat-v2';
const OUTPUT_SCHEMA_VERSION = 'soc-chat-output-v1';
const HERMES_INSTRUCTIONS = `You are the BMB AI-SOC analyst. You are read-only.
Use only the SOC evidence in the current request. Never invent identifiers, counts, users, hosts, IP addresses, actions, or conclusions.
Clearly distinguish observed facts from inference. If evidence is insufficient, say so.
Never claim that an action was executed. Do not use host tools or external knowledge.
Return exactly one JSON object with no prose or markdown using this shape:
{"answer":"string","citations":[{"type":"alert|incident","id":"exact supplied id"}],"confidence":"low|medium|high","limitations":["string"]}
Every citation must identify a record supplied in the current SOC evidence. Use an empty citations array when no record supports the answer.`;

function compactText(value, max = 320) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

async function buildEvidence(database = db) {
  const [stats, alerts, incidents] = await Promise.all([
    database.getAlertStats(),
    database.query(`
      SELECT id, timestamp, rule_level, rule_desc, source_severity,
             src_ip, dst_ip, username, hostname, process,
             triage_status, verdict
      FROM alerts
      WHERE timestamp >= NOW() - interval '24 hours'
      ORDER BY
        CASE COALESCE(verdict->>'severity', source_severity)
          WHEN 'critical' THEN 0 WHEN 'high' THEN 1
          WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4
        END,
        rule_level DESC,
        timestamp DESC
      LIMIT 12
    `),
    database.query(`
      SELECT id, title, severity, status, confidence, first_seen, last_seen,
             attack_stages, common_entities, narrative, alert_ids
      FROM incidents
      WHERE status = 'open'
      ORDER BY
        CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1
          WHEN 'medium' THEN 2 ELSE 3 END,
        last_seen DESC
      LIMIT 8
    `),
  ]);

  return {
    generated_at: new Date().toISOString(),
    scope: 'Top security evidence from the last 24 hours plus open incidents',
    stats,
    alerts: alerts.rows.map(alert => ({
      id: String(alert.id), time: alert.timestamp,
      description: compactText(alert.rule_desc, 220), level: alert.rule_level,
      severity: alert.verdict?.severity || alert.source_severity || null,
      verdict: alert.verdict?.verdict || null,
      confidence: alert.verdict?.confidence || null,
      user: alert.username || null, host: alert.hostname || null,
      source_ip: alert.src_ip || null, destination_ip: alert.dst_ip || null,
      process: compactText(alert.process, 120) || null, triage_status: alert.triage_status,
    })),
    incidents: incidents.rows.map(incident => ({
      id: String(incident.id), title: compactText(incident.title, 180),
      severity: incident.severity, status: incident.status, confidence: incident.confidence,
      first_seen: incident.first_seen, last_seen: incident.last_seen,
      attack_stages: incident.attack_stages || [], entities: incident.common_entities || {},
      alert_ids: Array.isArray(incident.alert_ids) ? incident.alert_ids.slice(0, 20).map(String) : [],
      narrative: compactText(incident.narrative, 360),
    })),
  };
}

function historyForHermes(history) {
  return history.map(message => ({ role: message.role, content: compactText(message.content, 2000) }));
}

async function chatHermes(question, {
  conversationId = null, actor = 'system', requestId = crypto.randomUUID(), signal,
  client = defaultHermesClient(), store = createAgentStore(), evidenceBuilder = buildEvidence,
} = {}) {
  const started = await store.beginChat({
    conversationId, actor, question, requestId,
    promptVersion: PROMPT_VERSION, schemaVersion: OUTPUT_SCHEMA_VERSION,
  });
  try {
    const evidenceStarted = Date.now();
    const evidence = await evidenceBuilder();
    await store.recordEvidenceSnapshot(started.runId, evidence, Date.now() - evidenceStarted);
    const hermes = await client.runAgent({
      input: `Analyst question:\n${compactText(question, 4000)}\n\nSOC evidence:\n${JSON.stringify(evidence)}`,
      instructions: HERMES_INSTRUCTIONS,
      sessionId: started.conversationId,
      sessionKey: `bmb-soc:${crypto.createHash('sha256').update(actor).digest('hex').slice(0, 32)}`,
      conversationHistory: historyForHermes(started.history),
      signal, idempotencyKey: started.idempotencyKey,
      onSubmitted: hermesRunId => store.attachHermesRun(started.runId, hermesRunId),
    });
    const output = validateCitations(parseChatOutput(hermes.output), evidence);
    await store.completeChat({
      runId: started.runId, conversationId: started.conversationId,
      actor, requestId, output, hermes,
    });
    return {
      answer: output.answer, citations: output.citations, confidence: output.confidence,
      limitations: output.limitations || [], conversation_id: started.conversationId,
      run_id: started.runId, hermes_run_id: hermes.runId, provider: 'hermes',
      model: hermes.model, usage: hermes.usage, tokens: hermes.usage.total_tokens,
      evidence: {
        alerts: evidence.alerts.map(item => item.id),
        incidents: evidence.incidents.map(item => item.id),
        generated_at: evidence.generated_at,
      },
      tools_used: [{ tool: 'soc_evidence_snapshot', args: { hours: 24 } }],
    };
  } catch (error) {
    await store.failChat({ runId: started.runId, actor, requestId, error });
    throw error;
  }
}

module.exports = {
  HERMES_INSTRUCTIONS, OUTPUT_SCHEMA_VERSION, PROMPT_VERSION,
  buildEvidence, chatHermes, compactText, historyForHermes,
};
