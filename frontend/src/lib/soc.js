export function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function severityOf(alert) {
  const verdict = parseJson(alert?.verdict);
  if (verdict.severity) return verdict.severity;
  if (alert?.source_severity) return alert.source_severity;
  const level = Number(alert?.rule_level || 0);
  return level >= 12 ? 'critical' : level >= 9 ? 'high' : level >= 6 ? 'medium' : level >= 3 ? 'low' : 'informational';
}

export function entityOf(alert) {
  return alert?.hostname || alert?.agent_name || alert?.username || alert?.src_ip || 'Unknown entity';
}

export function relativeTime(timestamp) {
  if (!timestamp) return 'Unknown';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function saveLocal(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

export function copyText(value) {
  return navigator.clipboard?.writeText(String(value || ''));
}
