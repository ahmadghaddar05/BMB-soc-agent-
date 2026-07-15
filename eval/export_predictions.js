'use strict';
// Pull predictions from a running SOC Agent API into preds.json for evaluate.js.
//   node eval/export_predictions.js [http://localhost:3000] > preds.json

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const API_KEY = process.env.SOC_API_KEY || '';

async function getJSON(path) {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: API_KEY ? { Authorization:`Bearer ${API_KEY}` } : {},
  });
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

async function main() {
  // All alerts (paginate)
  const alerts = [];
  for (let page = 1; ; page++) {
    const r = await getJSON(`/alerts?page=${page}&limit=200`);
    alerts.push(...r.alerts);
    if (alerts.length >= r.total || !r.alerts.length) break;
  }
  // All incidents → map member alert -> incident id
  const incMap = {};
  for (let page = 1; ; page++) {
    const r = await getJSON(`/incidents?status=open&page=${page}&limit=100`);
    for (const inc of r.incidents) {
      const full = await getJSON(`/incidents/${inc.id}`);
      for (const a of (full.alerts || [])) incMap[a.id] = String(inc.id);
    }
    if (!r.incidents.length || (r.total && page * 100 >= r.total)) break;
  }

  const stats = await getJSON('/stats');
  const runs  = (await getJSON('/runs?limit=200')).runs || [];
  const sum = k => runs.reduce((s, r) => s + (parseInt(r[k]) || 0), 0);

  const out = {
    alerts: alerts.map(a => ({
      id: a.id,
      verdict: a.verdict?.verdict || null,
      incident: incMap[a.id] || null,
    })),
    efficiency: {
      rawAlerts:  parseInt(stats.alerts.total) || alerts.length,
      llmCalls:   sum('llm_calls'),
      autoClosed: parseInt(stats.alerts.auto_closed) || 0,
      incidents:  stats.incidents?.total || 0,
      tokens:     sum('llm_tokens'),
      totalMs:    sum('duration_ms'),
    },
  };
  process.stdout.write(JSON.stringify(out, null, 2));
}
main().catch(e => { console.error(e.message); process.exit(1); });
