import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Filter, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import { api } from '../lib/api';

const EMPTY_FILTERS = Object.freeze({ actor:'', eventType:'', outcome:'' });
const OUTCOMES = ['success', 'failure', 'denied', 'cancelled'];

function timestamp(value) {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Not recorded' : parsed.toLocaleString();
}

function outcomeTone(outcome) {
  if (outcome === 'success') return 'success';
  if (outcome === 'failure' || outcome === 'denied') return 'attention';
  return 'neutral';
}

function metadataText(metadata) {
  if (metadata == null) return '';
  if (typeof metadata === 'object' && !Array.isArray(metadata) && !Object.keys(metadata).length) return '';
  try { return JSON.stringify(metadata, null, 2); } catch { return String(metadata); }
}

export default function AuditGovernance() {
  const [draft, setDraft] = useState({ ...EMPTY_FILTERS });
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page:String(page), limit:String(limit) });
      if (filters.actor) params.set('actor', filters.actor);
      if (filters.eventType) params.set('event_type', filters.eventType);
      if (filters.outcome) params.set('outcome', filters.outcome);
      const result = await api(`/admin/audit-events?${params.toString()}`);
      setEvents(Array.isArray(result.audit_events) ? result.audit_events : []);
      setTotal(Number(result.total || 0));
    } catch (loadError) {
      setEvents([]);
      setTotal(0);
      setError(loadError.message || 'Audit events could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [filters, limit, page]);

  useEffect(() => { load(); }, [load]);

  const pages = Math.max(1, Math.ceil(total / limit));
  const filtersActive = Boolean(filters.actor || filters.eventType || filters.outcome);
  const range = useMemo(() => total ? `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total.toLocaleString()}` : '0 events', [limit, page, total]);

  function applyFilters(event) {
    event.preventDefault();
    setPage(1);
    setFilters({ actor:draft.actor.trim(), eventType:draft.eventType.trim(), outcome:draft.outcome });
  }

  function clearFilters() {
    setDraft({ ...EMPTY_FILTERS });
    setPage(1);
    setFilters({ ...EMPTY_FILTERS });
  }

  return (
    <div className="module-page">
      <div className="module-hero compact">
        <div>
          <span className="eyebrow"><ShieldCheck />Administrative evidence</span>
          <h2>Audit &amp; Governance</h2>
          <p>Server-recorded workflow events with bounded filters and disclosed event metadata.</p>
        </div>
        <button type="button" className="primary-action" onClick={load} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</button>
      </div>

      <div className="module-notice"><ShieldCheck /><span>This view reports application audit records only. It is not a complete operating-system, Elastic, database, or identity-provider audit trail.</span></div>
      {error && <div className="module-notice danger" role="alert"><span>{error}</span><button type="button" onClick={load} disabled={loading}>Retry</button></div>}

      <section className="module-panel">
        <div className="panel-heading"><div><Filter /><span><strong>Audit filters</strong><small>Actor and event type are capped at 120 characters; results are limited to 100 records per page</small></span></div>{filtersActive && <StatusBadge tone="neutral">Filtered</StatusBadge>}</div>
        <form className="inventory-controls" onSubmit={applyFilters}>
          <label><Search /><input aria-label="Filter by actor" maxLength={120} value={draft.actor} onChange={event => setDraft(current => ({ ...current, actor:event.target.value }))} placeholder="Actor contains…" /></label>
          <label><Search /><input aria-label="Filter by event type" maxLength={120} value={draft.eventType} onChange={event => setDraft(current => ({ ...current, eventType:event.target.value }))} placeholder="Event type contains…" /></label>
          <label className="select-with-icon"><Filter /><select aria-label="Filter by outcome" value={draft.outcome} onChange={event => setDraft(current => ({ ...current, outcome:event.target.value }))}><option value="">All outcomes</option>{OUTCOMES.map(outcome => <option key={outcome} value={outcome}>{outcome}</option>)}</select></label>
          <button type="submit" className="primary-action small" disabled={loading}>Apply</button>
          <button type="button" className="ghost-action" onClick={clearFilters} disabled={loading || (!filtersActive && !draft.actor && !draft.eventType && !draft.outcome)}><X />Clear</button>
        </form>

        <div className="module-table-wrap">
          <table className="module-table">
            <thead><tr><th>Recorded</th><th>Actor</th><th>Event</th><th>Target</th><th>Outcome</th><th>Request</th><th>Metadata</th></tr></thead>
            <tbody>{events.map(event => {
              const metadata = metadataText(event.metadata);
              return <tr key={event.id}>
                <td><strong>{timestamp(event.created_at)}</strong><small>Event #{event.id}</small></td>
                <td><strong>{event.actor || 'Not recorded'}</strong></td>
                <td><strong>{event.event_type || 'Not recorded'}</strong></td>
                <td><strong>{event.target_type || 'Not recorded'}</strong><small>{event.target_id || 'No target ID'}</small></td>
                <td><StatusBadge tone={outcomeTone(event.outcome)}>{event.outcome || 'Not recorded'}</StatusBadge></td>
                <td><strong>{event.request_id || 'Not recorded'}</strong></td>
                <td>{metadata ? <details><summary className="cursor-pointer text-blue-400">Inspect</summary><pre className="mt-2 max-h-52 max-w-md overflow-auto whitespace-pre-wrap break-words rounded border border-slate-700 bg-slate-950 p-2 text-[10px] text-slate-300">{metadata}</pre></details> : <span>No metadata recorded</span>}</td>
              </tr>;
            })}</tbody>
          </table>
          {loading && <div className="module-empty small" role="status"><RefreshCw className="animate-spin" /><strong>Loading audit evidence</strong></div>}
          {!loading && !error && !events.length && <div className="module-empty"><ClipboardList /><strong>{filtersActive ? 'No audit events match these filters' : 'No application audit events were returned'}</strong><span>{filtersActive ? 'Clear or broaden the bounded filters to review other recorded events.' : 'The audit store returned zero records. This does not assert that no activity occurred outside this application.'}</span></div>}
        </div>

        {!loading && !error && (events.length > 0 || total > 0) && <div className="workspace-pagination"><span>{range}</span><div><button type="button" aria-label="Previous audit page" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>‹</button><b>{page}</b><button type="button" aria-label="Next audit page" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>›</button></div><select aria-label="Audit events per page" value={limit} onChange={event => { setLimit(Number(event.target.value)); setPage(1); }}><option value={25}>25 per page</option><option value={50}>50 per page</option><option value={100}>100 per page</option></select></div>}
      </section>
    </div>
  );
}
