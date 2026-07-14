const BASE = '';

export async function api(path, opts = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const sevClass = (sev) => ({
  critical: 'badge-critical',
  high:     'badge-high',
  medium:   'badge-medium',
  low:      'badge-low',
}[sev] || 'badge-info');

export const verdictClass = (v) => ({
  true_positive:       'pill-tp',
  false_positive:      'pill-fp',
  needs_investigation: 'pill-ni',
  benign_anomaly:      'pill-ba',
}[v] || 'badge-info');

export const verdictLabel = (v) => ({
  true_positive:       'True Positive',
  false_positive:      'False Positive',
  needs_investigation: 'Needs Investigation',
  benign_anomaly:      'Benign',
}[v] || v || '—');

export const statusClass = (s) => ({
  enriched:           'badge-low',
  pending:            'badge-medium',
  enrichment_failed:  'badge-high',
  triaged:            'badge-blue',
  triage_failed:      'badge-critical',
}[s] || 'badge-info');

export function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, {
    month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit'
  });
}

export function fmtDuration(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms/1000).toFixed(1)}s`;
}
