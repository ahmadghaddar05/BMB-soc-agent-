import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight, Check, ClipboardList, Clock3, FilePlus2, FolderOpen,
  Search, ShieldAlert, Trash2, UserRound,
} from 'lucide-react';
import { api, sevClass } from '../lib/api';
import { entityOf, relativeTime } from '../lib/soc';
import {
  activityTitle, alertReference, friendlyEvidenceText, investigationReference, severityOf,
} from '../lib/executive';

export default function Investigations() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialQuery = params.get('search') || '';
  const [query, setQuery] = useState(initialQuery);
  const [alerts, setAlerts] = useState([]);
  const [selected, setSelected] = useState([]);
  const [investigations, setInvestigations] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const detailRequest = useRef(0);

  async function openInvestigation(id) {
    const requestId = ++detailRequest.current;
    setActiveId(id);
    setActive(null);
    setError('');
    try {
      const detail = await api(`/investigations/${encodeURIComponent(id)}`);
      if (detailRequest.current === requestId) setActive(detail);
    } catch (requestError) {
      if (detailRequest.current === requestId) setError(requestError.message || 'Investigation details could not be loaded.');
    }
  }

  useEffect(() => {
    let mounted = true;
    api('/investigations?limit=100').then(async data => {
      if (!mounted) return;
      const items = data.investigations || [];
      setInvestigations(items);
      if (items[0]) {
        setActiveId(items[0].id);
        const detail = await api(`/investigations/${encodeURIComponent(items[0].id)}`);
        if (mounted) setActive(detail);
      }
    }).catch(() => {});
    if (initialQuery) {
      setLoading(true);
      api(`/alerts?limit=50&search=${encodeURIComponent(initialQuery)}`)
        .then(data => { if (mounted) setAlerts(data.alerts || []); })
        .finally(() => { if (mounted) setLoading(false); });
    }
    return () => { mounted = false; };
  }, [initialQuery]);

  async function runSearch(event) {
    event?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setSelected([]);
    setError('');
    try {
      const data = await api(`/alerts?limit=50&search=${encodeURIComponent(query.trim())}`);
      setAlerts(data.alerts || []);
    } catch (searchError) {
      setAlerts([]);
      setError(searchError.message || 'Evidence search failed.');
    } finally { setLoading(false); }
  }

  function toggle(id) {
    setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  }

  async function createInvestigation() {
    if (!selected.length) return;
    setSaving(true);
    try {
      const item = await api('/investigations', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim() || `Investigation: ${query.trim() || alertReference(selected[0])}`,
          search_query: query.trim(),
          alert_ids: selected,
        }),
      });
      setInvestigations(current => [item, ...current]);
      setActiveId(item.id);
      setActive(item);
      setTitle('');
      setSelected([]);
    } finally { setSaving(false); }
  }

  async function updateInvestigation(changes) {
    if (!active) return;
    if (changes.status === 'closed' && !active.notes?.length) {
      setError('Record at least one analyst finding before closing this investigation.');
      return;
    }
    const updated = await api(`/investigations/${encodeURIComponent(active.id)}`, {
      method: 'PATCH', body: JSON.stringify(changes),
    });
    setActive(current => ({ ...current, ...updated }));
    setInvestigations(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item));
  }

  async function addNote() {
    if (!active || !note.trim()) return;
    setSaving(true);
    try {
      const added = await api(`/investigations/${encodeURIComponent(active.id)}/notes`, {
        method: 'POST', body: JSON.stringify({ body: note.trim() }),
      });
      setActive(current => ({ ...current, notes: [added, ...(current.notes || [])] }));
      setInvestigations(current => current.map(item => item.id === active.id
        ? { ...item, note_count: Number(item.note_count || 0) + 1 }
        : item));
      setNote('');
    } finally { setSaving(false); }
  }

  async function remove(id) {
    if (!window.confirm('Delete this investigation workspace permanently? Its selected alerts are not deleted.')) return;
    await api(`/investigations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const remaining = investigations.filter(item => item.id !== id);
    setInvestigations(remaining);
    setActive(null);
    setActiveId('');
    if (remaining[0]) await openInvestigation(remaining[0].id);
  }

  return <div className="module-page investigations-page">
    <div className="module-hero compact">
      <div><span className="eyebrow"><Search />Evidence workspace</span><h2>Investigations</h2><p>Build a focused body of evidence, document your conclusion, and hand the result to a case or response workflow.</p></div>
      <span className="live-pill"><i />{investigations.filter(item => item.status === 'open').length} open investigations</span>
    </div>

    <div className="investigation-guide" aria-label="Investigation workflow">
      <span><b>1</b><strong>Search evidence</strong><small>Use a user, host, IP, alert, or behavior.</small></span><ArrowRight />
      <span><b>2</b><strong>Select relevant alerts</strong><small>Keep evidence that supports the hypothesis.</small></span><ArrowRight />
      <span><b>3</b><strong>Create and document</strong><small>Assign ownership and record the conclusion.</small></span>
    </div>

    <form className="investigation-search" onSubmit={runSearch}>
      <Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search a user, host, IP, process, behavior, or alert reference" />
      <button disabled={loading}>{loading ? 'Searching…' : 'Search evidence'}</button>
    </form>
    {error && <div className="module-notice danger" role="alert"><ShieldAlert />{error}</div>}

    <div className="investigation-layout">
      <section className="module-panel evidence-browser">
        <div className="panel-heading"><div><ShieldAlert /><span><strong>1. Search and select evidence</strong><small>{alerts.length} alerts returned · {selected.length} selected</small></span></div></div>
        <div className="evidence-results">
          {alerts.map(alert => <article key={alert.id} className={selected.includes(alert.id) ? 'selected' : ''}>
            <button type="button" className={`row-check ${selected.includes(alert.id) ? 'checked' : ''}`} onClick={() => toggle(alert.id)} aria-label={`${selected.includes(alert.id) ? 'Remove' : 'Add'} ${alertReference(alert)} ${selected.includes(alert.id) ? 'from' : 'to'} investigation evidence`}>{selected.includes(alert.id) && <Check />}</button>
            <div><strong>{activityTitle(alert)}</strong><span>{entityOf(alert)} · {alert.src_ip || alert.process || 'No observable'}</span><small>{alertReference(alert)} · {relativeTime(alert.timestamp)}</small></div>
            <span className={`badge ${sevClass(severityOf(alert))}`}>{severityOf(alert)}</span>
          </article>)}
          {!loading && !alerts.length && <div className="module-empty"><Search /><strong>Start with an evidence search</strong><span>Results will appear here so you can select only the alerts relevant to this investigation.</span></div>}
        </div>
        <div className="investigation-builder"><input value={title} onChange={event => setTitle(event.target.value)} placeholder="Clear investigation title" /><button type="button" className="primary-action" disabled={!selected.length || saving} onClick={createInvestigation}><FilePlus2 />Create investigation ({selected.length})</button></div>
      </section>

      <section className="module-panel investigations-list">
        <div className="panel-heading"><div><ClipboardList /><span><strong>2. Active investigation</strong><small>Server-backed workspaces with ownership and notes</small></span></div></div>
        <div className="case-list">
          {investigations.map(item => <button key={item.id} className={activeId === item.id ? 'active' : ''} onClick={() => openInvestigation(item.id)}><FolderOpen /><span><strong>{item.title}</strong><small>{investigationReference(item)} · {item.alert_ids?.length || 0} evidence · {item.note_count || 0} notes</small></span><em>{item.status}</em></button>)}
          {!investigations.length && <div className="module-empty small"><ClipboardList /><strong>No investigations yet</strong><span>Select evidence on the left, then create the first investigation.</span></div>}
        </div>
        {active && <div className="case-detail">
          <div><span><UserRound />{active.owner || 'Unassigned'}</span><span><Clock3 />{relativeTime(active.created_at)}</span></div>
          <small className="workspace-reference">{investigationReference(active)}</small><h3>{active.title}</h3><p>Evidence hypothesis: <b>{friendlyEvidenceText(active.search_query || 'Direct evidence selection')}</b></p>
          <div className="durable-fields"><label>Owner<select value={active.owner || ''} onChange={event => updateInvestigation({ owner: event.target.value })}><option value="">Unassigned</option><option>Ahmad</option><option>SOC Analyst</option><option>Incident Lead</option></select></label><label>Investigation status<select value={active.status} onChange={event => updateInvestigation({ status: event.target.value })}><option value="open">Open — analysis active</option><option value="closed">Closed — conclusion recorded</option></select></label></div>
          <dl><div><dt>Selected evidence</dt><dd>{active.alert_ids?.length || 0} alerts</dd></div><div><dt>Created by</dt><dd>{active.created_by}</dd></div></dl>
          <div className="workflow-notes"><strong>Analyst findings and decisions</strong><div>{(active.notes || []).map(item => <article key={item.id}><p>{friendlyEvidenceText(item.body)}</p><small>{item.author} · {relativeTime(item.created_at)}</small></article>)}{!active.notes?.length && <small>No findings recorded. Add what the evidence proves, what remains unknown, and the next action.</small>}</div><textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Record a finding, decision, or next step…" maxLength={4000} /><button disabled={!note.trim() || saving} onClick={addNote}>Add to timeline</button></div>
          <div className="case-actions"><button onClick={() => navigate(`/alerts?search=${encodeURIComponent(active.search_query || active.alert_ids?.[0] || '')}`)}>Review evidence in Technical Triage</button><button className="danger" onClick={() => remove(active.id)} title="Permanently delete this investigation workspace"><Trash2 />Delete</button></div>
        </div>}
      </section>
    </div>
  </div>;
}
