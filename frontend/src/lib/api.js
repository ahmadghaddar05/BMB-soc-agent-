const BASE = '';
let csrfToken = null;

export function setCsrfToken(value) {
  csrfToken = typeof value === 'string' && value ? value : null;
}

export async function api(path, opts = {}) {
  const method = String(opts.method || 'GET').toUpperCase();
  const { headers: optionHeaders = {}, ...fetchOptions } = opts;
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(!['GET','HEAD','OPTIONS'].includes(method) && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...optionHeaders,
    },
    ...fetchOptions,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const message = typeof err.error === 'object' ? err.error.message : err.error;
    const error = new Error(message || `HTTP ${res.status}`);
    error.code = err.error?.code || `HTTP_${res.status}`;
    error.status = res.status;
    error.requestId = err.error?.request_id || res.headers.get('x-request-id');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bmb-api-error', { detail: { message: error.message, status: res.status, requestId: error.requestId, path } }));
      if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('bmb-auth-expired'));
    }
    throw error;
  }
  const data = await res.json();
  if (Object.prototype.hasOwnProperty.call(data || {}, 'csrf')) setCsrfToken(data.csrf);
  return data;
}

export async function apiStream(path, opts = {}, onEvent = () => {}) {
  const method = String(opts.method || 'GET').toUpperCase();
  const { headers: optionHeaders = {}, ...fetchOptions } = opts;
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(!['GET','HEAD','OPTIONS'].includes(method) && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...optionHeaders,
    },
    ...fetchOptions,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const message = typeof body.error === 'object' ? body.error.message : body.error;
    const error = new Error(message || `HTTP ${res.status}`);
    error.code = body.error?.code || `HTTP_${res.status}`;
    error.status = res.status;
    throw error;
  }
  if (!res.body) throw new Error('Streaming response body is unavailable');

  const reader = res.body.getReader();
  const decoder = new globalThis.TextDecoder();
  let buffer = '';
  let result = null;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = done ? '' : lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      onEvent(event);
      if (event.type === 'error') {
        const error = new Error(event.error?.message || 'Hermes investigation failed');
        error.code = event.error?.code || 'HERMES_UNAVAILABLE';
        error.status = event.status || 502;
        throw error;
      }
      if (event.type === 'result') result = event.result;
    }
    if (done) break;
  }
  if (!result) throw new Error('Hermes stream ended without a result');
  return result;
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
