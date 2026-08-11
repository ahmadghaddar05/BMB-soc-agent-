import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowUpRight, Check, ClipboardList, MessageSquareText, Search, ShieldAlert, Trash2,
} from 'lucide-react';
import { api } from '../lib/api';
import { entityOf, relativeTime } from '../lib/soc';
import {
  activityTitle, alertReference, friendlyEvidenceText, investigationReference, severityOf,
} from '../lib/executive';
import {
  Button, Card, EmptyState, Select, SeverityBadge, SkeletonLoader, StatusChip, Timeline,
} from '../components/ui';

const OWNER_OPTIONS = ['SOC Analyst', 'Incident Lead', 'Shift Lead'];

function investigationStatus(status) {
  return status === 'closed' ? { label:'Closed', tone:'resolved' } : { label:'Open', tone:'active' };
}

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
  const [detailLoading, setDetailLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const detailRequest = useRef(0);

  const openInvestigation = useCallback(async id => {
    const requestId = ++detailRequest.current;
    setActiveId(id);
    setActive(null);
    setDetailLoading(true);
    setError('');
    try {
      const detail = await api(`/investigations/${encodeURIComponent(id)}`);
      if (detailRequest.current === requestId) setActive(detail);
    } catch (requestError) {
      if (detailRequest.current === requestId) setError(requestError.message || 'Investigation details could not be loaded.');
    } finally {
      if (detailRequest.current === requestId) setDetailLoading(false);
    }
  }, []);

  const searchEvidence = useCallback(async term => {
    const value = String(term || '').trim();
    if (!value) return;
    setLoading(true);
    setSelected([]);
    setError('');
    try {
      const data = await api(`/alerts?limit=50&search=${encodeURIComponent(value)}`);
      setAlerts(data.alerts || []);
    } catch (searchError) {
      setAlerts([]);
      setError(searchError.message || 'Evidence search failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    api('/investigations?limit=100').then(data => {
      if (!mounted) return;
      const items = data.investigations || [];
      setInvestigations(items);
      if (items[0]) openInvestigation(items[0].id);
    }).catch(loadError => {
      if (mounted) setError(loadError.message || 'Investigations could not be loaded.');
    });
    if (initialQuery) searchEvidence(initialQuery);
    return () => { mounted = false; detailRequest.current += 1; };
  }, [initialQuery, openInvestigation, searchEvidence]);

  const openCount = investigations.filter(item => item.status === 'open').length;
  const timelineItems = useMemo(() => (active?.notes || []).map(item => ({
    id:item.id,
    icon:<MessageSquareText aria-hidden="true" />,
    title:item.author || 'SOC analyst',
    detail:friendlyEvidenceText(item.body),
    meta:relativeTime(item.created_at),
  })), [active?.notes]);

  function runSearch(event) {
    event.preventDefault();
    searchEvidence(query);
  }

  function toggle(id) {
    setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  }

  async function createInvestigation() {
    if (!selected.length) return;
    setSaving(true);
    setError('');
    try {
      const item = await api('/investigations', {
        method:'POST',
        body:JSON.stringify({
          title:title.trim() || `Investigation: ${query.trim() || alertReference(selected[0])}`,
          search_query:query.trim(),
          alert_ids:selected,
        }),
      });
      setInvestigations(current => [item, ...current]);
      setActiveId(item.id);
      setActive(item);
      setTitle('');
      setSelected([]);
    } catch (createError) {
      setError(createError.message || 'The investigation could not be created.');
    } finally {
      setSaving(false);
    }
  }

  async function updateInvestigation(changes) {
    if (!active) return;
    if (changes.status === 'closed' && !active.notes?.length) {
      setError('Add an analyst finding before closing this investigation.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const updated = await api(`/investigations/${encodeURIComponent(active.id)}`, { method:'PATCH', body:JSON.stringify(changes) });
      setActive(current => ({ ...current, ...updated }));
      setInvestigations(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item));
    } catch (updateError) {
      setError(updateError.message || 'The investigation could not be updated.');
    } finally {
      setSaving(false);
    }
  }

  async function addNote(event) {
    event.preventDefault();
    if (!active || !note.trim()) return;
    setSaving(true);
    setError('');
    try {
      const added = await api(`/investigations/${encodeURIComponent(active.id)}/notes`, { method:'POST', body:JSON.stringify({ body:note.trim() }) });
      setActive(current => ({ ...current, notes:[added, ...(current.notes || [])], updated_at:added.created_at }));
      setInvestigations(current => current.map(item => item.id === active.id
        ? { ...item, note_count:Number(item.note_count || 0) + 1, updated_at:added.created_at }
        : item));
      setNote('');
    } catch (noteError) {
      setError(noteError.message || 'The finding could not be recorded.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this investigation workspace permanently? Its selected alerts will remain stored.')) return;
    setSaving(true);
    setError('');
    try {
      await api(`/investigations/${encodeURIComponent(id)}`, { method:'DELETE' });
      const remaining = investigations.filter(item => item.id !== id);
      setInvestigations(remaining);
      setActive(null);
      setActiveId('');
      if (remaining[0]) await openInvestigation(remaining[0].id);
    } catch (deleteError) {
      setError(deleteError.message || 'The investigation could not be deleted.');
    } finally {
      setSaving(false);
    }
  }

  const ownerOptions = active?.owner && !OWNER_OPTIONS.includes(active.owner)
    ? [active.owner, ...OWNER_OPTIONS]
    : OWNER_OPTIONS;
  const progress = active ? 3 : selected.length ? 2 : alerts.length ? 1 : 0;

  return (
    <div className="investigations-page-v2 ui-page-enter">
      <section className="investigation-progress" aria-label="Investigation workflow">
        {[
          ['Search evidence', 'Find a user, host, IP, process, or alert'],
          ['Select evidence', 'Keep only records relevant to the hypothesis'],
          ['Document findings', 'Assign ownership and record the conclusion'],
        ].map(([label, detail], index) => (
          <article key={label} className={progress > index ? 'is-complete' : progress === index ? 'is-current' : ''}>
            <span>{progress > index ? <Check aria-hidden="true" /> : index + 1}</span>
            <div><strong>{label}</strong><small>{detail}</small></div>
          </article>
        ))}
      </section>

      <form className="investigation-search-v2" onSubmit={runSearch}>
        <Search size={16} strokeWidth={1.5} aria-hidden="true" />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search user, host, IP, process, behavior, or alert reference" aria-label="Search investigation evidence" />
        <Button type="submit" variant="primary" disabled={!query.trim() || loading}>{loading ? 'Searching…' : 'Search evidence'}</Button>
      </form>

      {error && <div className="investigations-error" role="alert"><ShieldAlert size={16} strokeWidth={1.5} aria-hidden="true" /><span>{error}</span><button type="button" onClick={() => setError('')}>Dismiss</button></div>}

      <div className="investigations-layout-v2">
        <Card
          compact
          className="investigation-evidence-card"
          title="Evidence results"
          caption={`${alerts.length} alerts found for the current search`}
          action={<StatusChip status={selected.length ? 'active' : 'neutral'}>{selected.length} selected</StatusChip>}
        >
          {loading ? <div className="investigation-evidence-loading"><SkeletonLoader lines={6} /></div> : alerts.length ? (
            <ol className="investigation-evidence-list" aria-label="Alert evidence results">
              {alerts.map(alert => {
                const checked = selected.includes(alert.id);
                return (
                  <li key={alert.id}>
                    <button type="button" className={`row-check ${checked ? 'is-selected' : ''}`} onClick={() => toggle(alert.id)} aria-pressed={checked} aria-label={`${checked ? 'Remove' : 'Add'} ${alertReference(alert)} ${checked ? 'from' : 'to'} investigation evidence`}>
                      <span className="investigation-check" aria-hidden="true">{checked && <Check />}</span>
                      <span className="investigation-evidence-main"><strong>{activityTitle(alert)}</strong><small>{entityOf(alert)} · {alert.src_ip || alert.process || 'No additional observable'}</small><code>{alertReference(alert)} · {relativeTime(alert.timestamp)}</code></span>
                      <SeverityBadge severity={severityOf(alert)} />
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <EmptyState icon={Search} message="Search to find investigation evidence" />
          )}
          <div className="investigation-create-bar">
            <input value={title} onChange={event => setTitle(event.target.value)} placeholder="Investigation title (optional)" aria-label="Investigation title" />
            <Button variant="primary" disabled={!selected.length || saving} onClick={createInvestigation}>Create investigation ({selected.length})</Button>
          </div>
        </Card>

        <div className="investigation-workspace-stack">
          <Card
            compact
            className="investigation-directory-card"
            title="Investigations"
            caption="Server-backed workspaces with durable ownership"
            action={<StatusChip status={openCount ? 'active' : 'neutral'}>{openCount} open</StatusChip>}
          >
            {investigations.length ? (
              <ol className="investigation-directory" aria-label="Investigation workspaces">
                {investigations.map(item => {
                  const status = investigationStatus(item.status);
                  return (
                    <li key={item.id}><button type="button" className={activeId === item.id ? 'is-selected' : ''} onClick={() => openInvestigation(item.id)} aria-current={activeId === item.id ? 'true' : undefined}><span><code>{investigationReference(item)}</code><strong>{item.title}</strong><small>{item.alert_ids?.length || 0} evidence · {item.note_count || 0} notes · {relativeTime(item.updated_at || item.created_at)}</small></span><StatusChip status={status.tone}>{status.label}</StatusChip></button></li>
                  );
                })}
              </ol>
            ) : <EmptyState icon={ClipboardList} message="No investigations created" />}
          </Card>

          {detailLoading && <Card className="investigation-detail-loading"><SkeletonLoader lines={6} /></Card>}

          {!detailLoading && active && (
            <Card className="investigation-detail-card">
              <header className="investigation-detail-header">
                <div><code>{investigationReference(active)}</code><h2>{active.title}</h2><p>{friendlyEvidenceText(active.search_query || 'Created from directly selected alert evidence')}</p></div>
                <StatusChip status={investigationStatus(active.status).tone}>{investigationStatus(active.status).label}</StatusChip>
              </header>

              <div className="investigation-inline-controls">
                <Select label="Owner" value={active.owner || ''} disabled={saving} onChange={event => updateInvestigation({ owner:event.target.value })}><option value="">Unassigned</option>{ownerOptions.map(owner => <option key={owner}>{owner}</option>)}</Select>
                <Select label="Status" value={active.status || 'open'} disabled={saving} onChange={event => updateInvestigation({ status:event.target.value })}><option value="open">Open</option><option value="closed">Closed</option></Select>
              </div>

              <dl className="investigation-facts"><div><dt>Selected evidence</dt><dd>{active.alert_ids?.length || 0} alerts</dd></div><div><dt>Created by</dt><dd>{active.created_by || 'Unknown'}</dd></div><div><dt>Age</dt><dd>{relativeTime(active.created_at)}</dd></div><div><dt>Last update</dt><dd>{relativeTime(active.updated_at || active.created_at)}</dd></div></dl>

              <section className="investigation-findings">
                <div className="investigation-findings-heading"><div><h3>Analyst findings</h3><p>Evidence-backed conclusions and next actions</p></div><StatusChip>{timelineItems.length} notes</StatusChip></div>
                {timelineItems.length ? <Timeline items={timelineItems} /> : <EmptyState icon={MessageSquareText} message="No findings recorded" />}
                <form className="investigation-note-form" onSubmit={addNote}><label htmlFor="investigation-note">Record a finding or decision</label><textarea id="investigation-note" value={note} onChange={event => setNote(event.target.value)} placeholder="State what the evidence proves, what remains unknown, and the next action" maxLength={4000} /><div><small>{note.length.toLocaleString()} / 4,000</small><Button type="submit" variant="primary" disabled={!note.trim() || saving}>{saving ? 'Saving…' : 'Add to timeline'}</Button></div></form>
              </section>

              <footer className="investigation-detail-actions"><Button icon={ArrowUpRight} onClick={() => navigate(`/alerts?search=${encodeURIComponent(active.search_query || active.alert_ids?.[0] || '')}`)}>Open in Technical Triage</Button><Button icon={Trash2} className="is-danger" disabled={saving} onClick={() => remove(active.id)}>Delete workspace</Button></footer>
            </Card>
          )}

          {!detailLoading && !active && investigations.length > 0 && <Card><EmptyState icon={ClipboardList} message="Select an investigation to continue" /></Card>}
        </div>
      </div>
    </div>
  );
}
