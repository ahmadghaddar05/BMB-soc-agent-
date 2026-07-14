'use strict';
// Pure scoring functions for the SOC Agent evaluation harness. No I/O — unit-testable.

// ── Triage classification ──────────────────────────────────────────────────
// Per-class precision/recall/F1 + confusion matrix over verdict labels.
function classifyMetrics(pairs, labels) {
  // pairs: [{ truth, pred }]
  const classes = labels || [...new Set(pairs.flatMap(p => [p.truth, p.pred]))].sort();
  const idx = Object.fromEntries(classes.map((c, i) => [c, i]));
  const cm = classes.map(() => classes.map(() => 0)); // cm[truth][pred]
  for (const { truth, pred } of pairs) {
    if (idx[truth] == null || idx[pred] == null) continue;
    cm[idx[truth]][idx[pred]]++;
  }
  const per = {};
  let microCorrect = 0, total = 0;
  classes.forEach((c, i) => {
    const tp = cm[i][i];
    const fp = classes.reduce((s, _, j) => s + (j !== i ? cm[j][i] : 0), 0);
    const fn = classes.reduce((s, _, j) => s + (j !== i ? cm[i][j] : 0), 0);
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall    = tp + fn ? tp / (tp + fn) : 0;
    const f1        = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
    per[c] = { precision, recall, f1, support: tp + fn };
    microCorrect += tp;
    total += tp + fn;
  });
  const macroF1 = classes.reduce((s, c) => s + per[c].f1, 0) / (classes.length || 1);
  const accuracy = total ? microCorrect / total : 0;
  return { classes, confusion_matrix: cm, per_class: per, macro_f1: macroF1, accuracy, n: total };
}

// ── Correlation clustering quality ──────────────────────────────────────────
// Pairwise precision/recall/F1: over all pairs of alerts, did we agree on
// "same incident or not" with ground truth? Robust to cluster id naming.
function pairwiseClusterMetrics(truthGroups, predGroups) {
  // *Groups: { alertId -> groupId }. Alerts with no group are singletons (unique id).
  const ids = [...new Set([...Object.keys(truthGroups), ...Object.keys(predGroups)])];
  const tg = id => truthGroups[id] ?? `__t_${id}`;
  const pg = id => predGroups[id]  ?? `__p_${id}`;
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const sameTruth = tg(ids[i]) === tg(ids[j]);
      const samePred  = pg(ids[i]) === pg(ids[j]);
      if (sameTruth && samePred) tp++;
      else if (!sameTruth && samePred) fp++;
      else if (sameTruth && !samePred) fn++;
      else tn++;
    }
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall    = tp + fn ? tp / (tp + fn) : 0;
  const f1        = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  // Adjusted Rand Index
  const n = ids.length;
  const totalPairs = n * (n - 1) / 2;
  const ari = (() => {
    if (!totalPairs) return 0;
    const expected = ((tp + fp) * (tp + fn)) / totalPairs;
    const max = ((tp + fp) + (tp + fn)) / 2;
    return (max - expected) ? (tp - expected) / (max - expected) : 0;
  })();
  return { pairwise_precision: precision, pairwise_recall: recall, pairwise_f1: f1,
           adjusted_rand_index: ari, pairs: { tp, fp, fn, tn } };
}

// ── Efficiency / volume reduction ───────────────────────────────────────────
function efficiencyMetrics({ rawAlerts, llmCalls, autoClosed, incidents, tokens, totalMs }) {
  const reductionFromClustering = rawAlerts ? 1 - (llmCalls / rawAlerts) : 0;
  const itemsForAnalyst = incidents + Math.max(0, rawAlerts - autoClosed - 0); // alerts not auto-closed
  return {
    raw_alerts: rawAlerts,
    llm_calls: llmCalls,
    clustering_reduction: reductionFromClustering, // fraction of LLM calls avoided
    auto_closed: autoClosed,
    incidents,
    alert_to_incident_ratio: incidents ? rawAlerts / incidents : null,
    avg_tokens_per_llm_call: llmCalls ? tokens / llmCalls : 0,
    avg_ms_per_llm_call: llmCalls ? totalMs / llmCalls : 0,
  };
}

module.exports = { classifyMetrics, pairwiseClusterMetrics, efficiencyMetrics };
