export const ALERT_VIEW_STORAGE_KEY = 'bmb-alert-view';

export const DEFAULT_ALERT_FILTERS = Object.freeze({
  search: '',
  severity: '',
  triage_status: '',
  source: '',
  time_range: '1440',
  custom_from: '',
  custom_to: '',
});

const VALID_SEVERITIES = new Set(['', 'critical', 'high', 'medium', 'low']);
const VALID_TRIAGE_STATES = new Set(['', 'pending', 'triaged', 'triage_failed']);
const VALID_TIME_RANGES = new Set([
  '1', '5', '15', '30', '60', '240', '720', '1440', '10080', '43200', '129600', 'all', 'custom',
]);

function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function sanitizeFilters(value = {}) {
  const severity = text(value.severity);
  const triageStatus = text(value.triage_status);
  const timeRange = text(value.time_range, DEFAULT_ALERT_FILTERS.time_range);

  return {
    search: text(value.search),
    severity: VALID_SEVERITIES.has(severity) ? severity : '',
    triage_status: VALID_TRIAGE_STATES.has(triageStatus) ? triageStatus : '',
    source: text(value.source),
    time_range: VALID_TIME_RANGES.has(timeRange) ? timeRange : DEFAULT_ALERT_FILTERS.time_range,
    custom_from: text(value.custom_from),
    custom_to: text(value.custom_to),
  };
}

export function readBrowserAlertView(storage) {
  try {
    const raw = storage?.getItem?.(ALERT_VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.filters || typeof parsed.filters !== 'object') return null;
    return {
      filters: sanitizeFilters(parsed.filters),
      viewMode: parsed.viewMode === 'individual' ? 'individual' : 'grouped',
      savedAt: text(parsed.saved_at),
    };
  } catch {
    return null;
  }
}

export function createInitialAlertView({ storage, workspace, searchParams }) {
  const saved = readBrowserAlertView(storage);
  const filters = { ...DEFAULT_ALERT_FILTERS, ...(saved?.filters || {}) };

  for (const key of ['search', 'severity', 'triage_status', 'time_range']) {
    if (searchParams?.has?.(key)) filters[key] = searchParams.get(key) || '';
  }

  const sanitized = sanitizeFilters(filters);
  if (workspace === 'triage') sanitized.triage_status = 'pending';

  return {
    filters: sanitized,
    viewMode: saved?.viewMode || 'grouped',
    restored: Boolean(saved),
  };
}

export function writeBrowserAlertView(storage, view) {
  const payload = {
    version: 1,
    scope: 'browser-local',
    saved_at: new Date().toISOString(),
    filters: sanitizeFilters(view?.filters),
    viewMode: view?.viewMode === 'individual' ? 'individual' : 'grouped',
  };
  storage?.setItem?.(ALERT_VIEW_STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

export function normalizeCitations(value) {
  if (!Array.isArray(value)) return [];
  const citations = value.flatMap(item => {
    if (typeof item === 'string' && item.trim()) return [{ type: 'evidence', id: item.trim() }];
    if (!item || typeof item !== 'object') return [];
    const type = text(item.type).trim();
    const id = item.id == null ? '' : String(item.id).trim();
    return type && id ? [{ type, id }] : [];
  });
  const seen = new Set();
  return citations.filter(item => {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeTextList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim());
}
