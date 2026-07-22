'use strict';
// SOC Agent evaluation harness.
//
// Usage:
//   node eval/evaluate.js --demo                       # run on built-in synthetic data
//   node eval/evaluate.js --truth gt.json --pred preds.json
//
// ground truth (gt.json):
//   { "alerts": [ { "id":"a1", "verdict":"true_positive", "incident":"inc1" }, ... ] }
// predictions (preds.json) — produced by eval/export_predictions.js against a live API:
//   { "alerts": [ { "id":"a1", "verdict":"true_positive", "incident":"3" }, ... ],
//     "efficiency": { "rawAlerts":120,"llmCalls":40,"autoClosed":15,"incidents":6,"tokens":52000,"totalMs":90000 } }

const fs = require('fs');
const { classifyMetrics, pairwiseClusterMetrics, efficiencyMetrics } = require('./metrics');

const VERDICTS = ['true_positive','false_positive','needs_investigation','benign_anomaly'];

function loadJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function buildReport(truth, pred) {
  const predById = Object.fromEntries((pred.alerts || []).map(a => [a.id, a]));
  const pairs = [], truthGroups = {}, predGroups = {};
  for (const t of truth.alerts || []) {
    const p = predById[t.id];
    if (p && t.verdict && p.verdict) pairs.push({ truth: t.verdict, pred: p.verdict });
    if (t.incident) truthGroups[t.id] = `t:${t.incident}`;
    if (p && p.incident) predGroups[t.id] = `p:${p.incident}`;
  }
  const triage = classifyMetrics(pairs, VERDICTS);
  const correlation = pairwiseClusterMetrics(truthGroups, predGroups);
  const efficiency = pred.efficiency ? efficiencyMetrics(pred.efficiency) : null;
  return { triage, correlation, efficiency, coverage: { labeled: (truth.alerts||[]).length, matched: pairs.length } };
}

function pct(x) { return (x * 100).toFixed(1) + '%'; }

function printReport(rep) {
  console.log('\n══════════════════ SOC AGENT EVALUATION ══════════════════\n');
  console.log(`Coverage: ${rep.coverage.matched}/${rep.coverage.labeled} labeled alerts matched to predictions\n`);

  console.log('── TRIAGE (verdict classification) ───────────────────────');
  console.log(`  Accuracy:  ${pct(rep.triage.accuracy)}   Macro-F1: ${rep.triage.macro_f1.toFixed(3)}`);
  for (const c of rep.triage.classes) {
    const m = rep.triage.per_class[c];
    if (!m.support) continue;
    console.log(`    ${c.padEnd(22)} P=${m.precision.toFixed(2)} R=${m.recall.toFixed(2)} F1=${m.f1.toFixed(2)} (n=${m.support})`);
  }
  console.log('  Confusion matrix (rows=truth, cols=pred):');
  console.log('    ' + ['', ...rep.triage.classes.map(c => c.slice(0,8))].join('\t'));
  rep.triage.confusion_matrix.forEach((row, i) =>
    console.log('    ' + [rep.triage.classes[i].slice(0,8), ...row].join('\t')));

  console.log('\n── CORRELATION (pairwise clustering) ─────────────────────');
  const c = rep.correlation;
  console.log(`  Precision=${c.pairwise_precision.toFixed(2)}  Recall=${c.pairwise_recall.toFixed(2)}  F1=${c.pairwise_f1.toFixed(2)}`);
  console.log(`  Adjusted Rand Index=${c.adjusted_rand_index.toFixed(3)}`);
  console.log(`  pairs: tp=${c.pairs.tp} fp=${c.pairs.fp} fn=${c.pairs.fn} tn=${c.pairs.tn}`);

  if (rep.efficiency) {
    const e = rep.efficiency;
    console.log('\n── EFFICIENCY ────────────────────────────────────────────');
    console.log(`  Raw alerts: ${e.raw_alerts}   LLM calls: ${e.llm_calls}`);
    console.log(`  Clustering/cache reduction: ${pct(e.clustering_reduction)} of LLM calls avoided`);
    console.log(`  Auto-closed: ${e.auto_closed}   Incidents: ${e.incidents}`);
    if (e.alert_to_incident_ratio) console.log(`  Alert→incident ratio: ${e.alert_to_incident_ratio.toFixed(1)}:1`);
    console.log(`  Avg tokens/call: ${e.avg_tokens_per_llm_call.toFixed(0)}   Avg ms/call: ${e.avg_ms_per_llm_call.toFixed(0)}`);
  }
  console.log('\n═══════════════════════════════════════════════════════════\n');
}

function demoData() {
  // 10 alerts. Ground truth + a plausible imperfect prediction.
  const truth = { alerts: [
    { id:'a1', verdict:'true_positive',       incident:'I1' },
    { id:'a2', verdict:'true_positive',       incident:'I1' },
    { id:'a3', verdict:'true_positive',       incident:'I1' },
    { id:'a4', verdict:'false_positive' },
    { id:'a5', verdict:'false_positive' },
    { id:'a6', verdict:'needs_investigation', incident:'I2' },
    { id:'a7', verdict:'needs_investigation', incident:'I2' },
    { id:'a8', verdict:'benign_anomaly' },
    { id:'a9', verdict:'true_positive',       incident:'I3' },
    { id:'a10',verdict:'false_positive' },
  ]};
  const pred = { alerts: [
    { id:'a1', verdict:'true_positive',       incident:'5' },
    { id:'a2', verdict:'true_positive',       incident:'5' },
    { id:'a3', verdict:'needs_investigation', incident:'5' },   // verdict miss
    { id:'a4', verdict:'false_positive' },
    { id:'a5', verdict:'false_positive' },
    { id:'a6', verdict:'needs_investigation', incident:'6' },
    { id:'a7', verdict:'needs_investigation', incident:'6' },
    { id:'a8', verdict:'benign_anomaly' },
    { id:'a9', verdict:'true_positive',       incident:'6' },   // correlation miss (wrong group)
    { id:'a10',verdict:'false_positive' },
  ], efficiency: { rawAlerts:120, llmCalls:42, autoClosed:18, incidents:7, tokens:54600, totalMs:88000 } };
  return { truth, pred };
}

function main() {
  const args = process.argv.slice(2);
  let truth, pred;
  if (args.includes('--demo')) {
    ({ truth, pred } = demoData());
  } else {
    const ti = args.indexOf('--truth'), pi = args.indexOf('--pred');
    if (ti < 0 || pi < 0) {
      console.error('Usage: node eval/evaluate.js --demo  |  --truth gt.json --pred preds.json');
      process.exit(1);
    }
    truth = loadJSON(args[ti + 1]);
    pred  = loadJSON(args[pi + 1]);
  }
  printReport(buildReport(truth, pred));
}

if (require.main === module) main();
module.exports = { buildReport };
