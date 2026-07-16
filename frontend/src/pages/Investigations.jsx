import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, ClipboardList, Clock3, FilePlus2, FolderOpen, Search, ShieldAlert, Trash2, UserRound } from 'lucide-react';
import { api, sevClass } from '../lib/api';
import { entityOf, relativeTime, severityOf } from '../lib/soc';

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

  async function openInvestigation(id) {
    setActiveId(id);
    setActive(await api(`/investigations/${encodeURIComponent(id)}`));
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
    try {
      const data = await api(`/alerts?limit=50&search=${encodeURIComponent(query.trim())}`);
      setAlerts(data.alerts || []);
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
          title: title.trim() || `Investigation: ${query.trim() || selected[0]}`,
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
    await api(`/investigations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const remaining = investigations.filter(item => item.id !== id);
    setInvestigations(remaining);
    setActive(null);
    setActiveId('');
    if (remaining[0]) await openInvestigation(remaining[0].id);
  }

  return <div className="module-page investigations-page">
    <div className="module-hero compact"><div><span className="eyebrow"><Search />Analyst workbench</span><h2>Investigations</h2><p>Search evidence, collect relevant alerts, and preserve a shared analyst investigation workspace.</p></div><span className="live-pill"><i />{investigations.filter(item => item.status === 'open').length} open workspaces</span></div>
    <form className="investigation-search" onSubmit={runSearch}><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search rules, raw events, IPs, users, hostnames, or hashes" /><button disabled={loading}>{loading ? 'Searching…' : 'Search evidence'}</button></form>
    <div className="investigation-layout">
      <section className="module-panel evidence-browser"><div className="panel-heading"><div><ShieldAlert /><span><strong>Evidence browser</strong><small>{alerts.length} alerts returned · {selected.length} selected</small></span></div></div><div className="evidence-results">{alerts.map(alert => <article key={alert.id} className={selected.includes(alert.id) ? 'selected' : ''}><button type="button" className={`row-check ${selected.includes(alert.id) ? 'checked' : ''}`} onClick={() => toggle(alert.id)}>{selected.includes(alert.id) && <Check />}</button><div><strong>{alert.rule_desc || 'Security alert'}</strong><span>{entityOf(alert)} · {alert.src_ip || alert.process || 'No observable'}</span><small>{alert.id} · {relativeTime(alert.timestamp)}</small></div><span className={`badge ${sevClass(severityOf(alert))}`}>{severityOf(alert)}</span></article>)}{!loading && !alerts.length && <div className="module-empty"><Search /><strong>No evidence loaded</strong><span>Run a search to start building an investigation.</span></div>}</div><div className="investigation-builder"><input value={title} onChange={event => setTitle(event.target.value)} placeholder="Investigation title (optional)" /><button type="button" className="primary-action" disabled={!selected.length || saving} onClick={createInvestigation}><FilePlus2 />Create from {selected.length} alerts</button></div></section>
      <section className="module-panel investigations-list"><div className="panel-heading"><div><ClipboardList /><span><strong>Investigation workspaces</strong><small>Stored securely on the SOC server</small></span></div></div><div className="case-list">{investigations.map(item => <button key={item.id} className={activeId === item.id ? 'active' : ''} onClick={() => openInvestigation(item.id)}><FolderOpen /><span><strong>{item.title}</strong><small>{String(item.id).slice(0, 8)} · {item.alert_ids?.length || 0} evidence · {item.note_count || 0} notes</small></span><em>{item.status}</em></button>)}{!investigations.length && <div className="module-empty small"><ClipboardList /><strong>No investigations yet</strong></div>}</div>{active && <div className="case-detail"><div><span><UserRound />{active.owner || 'Unassigned'}</span><span><Clock3 />{relativeTime(active.created_at)}</span></div><h3>{active.title}</h3><p>Search context: <b>{active.search_query || 'Direct evidence selection'}</b></p><div className="durable-fields"><label>Owner<select value={active.owner || ''} onChange={event => updateInvestigation({ owner: event.target.value })}><option value="">Unassigned</option><option>Ahmad</option><option>SOC Analyst</option><option>Incident Lead</option></select></label><label>Status<select value={active.status} onChange={event => updateInvestigation({ status: event.target.value })}><option value="open">Open</option><option value="closed">Closed</option></select></label></div><dl><div><dt>Evidence</dt><dd>{active.alert_ids?.length || 0} alerts</dd></div><div><dt>Created by</dt><dd>{active.created_by}</dd></div></dl><div className="workflow-notes"><strong>Analyst timeline</strong><div>{(active.notes || []).map(item => <article key={item.id}><p>{item.body}</p><small>{item.author} · {relativeTime(item.created_at)}</small></article>)}{!active.notes?.length && <small>No notes recorded yet.</small>}</div><textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Add evidence, decisions, or next steps…" maxLength={4000} /><button disabled={!note.trim() || saving} onClick={addNote}>Add note</button></div><div className="case-actions"><button onClick={() => navigate(`/alerts?search=${encodeURIComponent(active.search_query || active.alert_ids?.[0] || '')}`)}>Open alert workspace</button><button className="danger" onClick={() => remove(active.id)}><Trash2 />Delete workspace</button></div></div>}</section>
    </div>
  </div>;
}
