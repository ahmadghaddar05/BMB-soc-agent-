'use strict';

const db = require('../db');

const HERMES_SYSTEM_PROMPT = `You are the BMB AI-SOC analyst.
Answer using only the supplied SOC evidence. Never invent alert IDs, incident IDs, counts, users, hosts, IPs, or conclusions.
Be concise and operational. Cite supporting records inline using [alert:<id>] or [incident:<id>].
Clearly separate observed facts from inference. If evidence is insufficient, say so.
You are read-only: recommend actions, but never claim an action was executed.`;

function compactText(value, max = 320) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
}

async function buildEvidence() {
  const [stats, alerts, incidents] = await Promise.all([
    db.getAlertStats(),
    db.query(`
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
    db.query(`
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
    alerts: alerts.rows.map(a => ({
      id: a.id,
      time: a.timestamp,
      description: compactText(a.rule_desc, 220),
      level: a.rule_level,
      severity: a.verdict?.severity || a.source_severity || null,
      verdict: a.verdict?.verdict || null,
      confidence: a.verdict?.confidence || null,
      user: a.username || null,
      host: a.hostname || null,
      source_ip: a.src_ip || null,
      destination_ip: a.dst_ip || null,
      process: compactText(a.process, 120) || null,
      triage_status: a.triage_status,
    })),
    incidents: incidents.rows.map(i => ({
      id: i.id,
      title: compactText(i.title, 180),
      severity: i.severity,
      status: i.status,
      confidence: i.confidence,
      first_seen: i.first_seen,
      last_seen: i.last_seen,
      attack_stages: i.attack_stages || [],
      entities: i.common_entities || {},
      alert_ids: Array.isArray(i.alert_ids) ? i.alert_ids.slice(0, 20) : [],
      narrative: compactText(i.narrative, 360),
    })),
  };
}

async function chatHermes(question, history = []) {
  const apiKey = process.env.HERMES_API_KEY || '';
  if (!apiKey) throw new Error('HERMES_API_KEY is not configured');

  const baseUrl = (process.env.HERMES_API_URL || 'http://host.docker.internal:8643/v1').replace(/\/$/, '');
  const evidence = await buildEvidence();
  const prior = (Array.isArray(history) ? history : [])
    .filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .slice(-4)
    .map(m => ({ role: m.role, content: compactText(m.content, 900) }));

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.HERMES_MODEL || 'hermes-agent',
      messages: [
        { role: 'system', content: HERMES_SYSTEM_PROMPT },
        ...prior,
        {
          role: 'user',
          content: `Analyst question:\n${compactText(question, 2000)}\n\nSOC evidence:\n${JSON.stringify(evidence)}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(parseInt(process.env.HERMES_TIMEOUT_MS || '180000', 10)),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Hermes HTTP ${response.status}: ${detail.slice(0, 240)}`);
  }

  const data = await response.json();
  const answer = data.choices?.[0]?.message?.content;
  if (!answer) throw new Error('Hermes returned an empty response');

  return {
    answer,
    provider: 'hermes',
    model: data.model || process.env.HERMES_MODEL || 'hermes-agent',
    tokens: data.usage?.total_tokens || 0,
    usage: data.usage || {},
    evidence: {
      alerts: evidence.alerts.map(a => a.id),
      incidents: evidence.incidents.map(i => i.id),
      generated_at: evidence.generated_at,
    },
    tools_used: [{ tool: 'soc_evidence_snapshot', args: { hours: 24 } }],
  };
}

module.exports = { chatHermes };
