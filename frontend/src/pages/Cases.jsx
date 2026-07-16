import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BriefcaseBusiness, CheckCircle2, Clock3, FileText, Search, ShieldAlert, UserRound } from 'lucide-react';
import { api, fmtTs, sevClass } from '../lib/api';
import { relativeTime } from '../lib/soc';

export default function Cases() {
  const navigate = useNavigate();
  const [cases, setCases] = useState([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function openCase(id) {
    setSelectedId(id);
    setSelected(await api(`/cases/${id}`));
  }

  useEffect(() => {
    let mounted = true;
    api('/cases?limit=100').then(async data => {
      if (!mounted) return;
      const items = data.cases || [];
      setCases(items);
      if (items[0]) {
        setSelectedId(items[0].id);
        const detail = await api(`/cases/${items[0].id}`);
        if (mounted) setSelected(detail);
      }
    }).catch(() => {}).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const filtered = cases.filter(item => `${item.id} ${item.title} ${item.severity} ${item.status} ${item.owner || ''}`.toLowerCase().includes(query.toLowerCase()));
  const counts = useMemo(() => ({
    open: cases.filter(item => item.status === 'open').length,
    closed: cases.filter(item => item.status === 'closed').length,
    critical: cases.filter(item => item.severity === 'critical' && item.status === 'open').length,
    assigned: cases.filter(item => item.owner).length,
  }), [cases]);

  async function updateCase(changes) {
    if (!selected) return;
    const updated = await api(`/cases/${selected.id}`, { method: 'PATCH', body: JSON.stringify(changes) });
    setSelected(current => ({ ...current, ...updated }));
    setCases(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item));
  }

  async function addNote() {
    if (!selected || !note.trim()) return;
    setSaving(true);
    try {
      const added = await api(`/cases/${selected.id}/notes`, {
        method: 'POST', body: JSON.stringify({ body: note.trim() }),
      });
      setSelected(current => ({ ...current, notes: [added, ...(current.notes || [])] }));
      setCases(current => current.map(item => item.id === selected.id
        ? { ...item, note_count: Number(item.note_count || 0) + 1 }
        : item));
      setNote('');
    } finally { setSaving(false); }
  }

  return <div className="module-page cases-page"><div className="module-hero compact"><div><span className="eyebrow"><BriefcaseBusiness />Case management</span><h2>Cases</h2><p>Durable ownership, analyst notes, and reporting workflow for correlated incidents.</p></div><span className="live-pill"><i />{counts.open} active cases</span></div><div className="module-metrics"><article className="metric-card tone-red"><span><ShieldAlert /></span><div><small>Critical open</small><strong>{counts.critical}</strong></div></article><article className="metric-card tone-blue"><span><BriefcaseBusiness /></span><div><small>Open cases</small><strong>{counts.open}</strong></div></article><article className="metric-card tone-green"><span><CheckCircle2 /></span><div><small>Closed cases</small><strong>{counts.closed}</strong></div></article><article className="metric-card tone-purple"><span><UserRound /></span><div><small>Assigned</small><strong>{counts.assigned}</strong></div></article></div><div className="case-management-layout"><section className="module-panel case-queue"><div className="inventory-controls"><label><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search cases" /></label></div>{filtered.map(item => <button key={item.id} className={String(selectedId) === String(item.id) ? 'active' : ''} onClick={() => openCase(item.id)}><span className={`badge ${sevClass(item.severity)}`}>{item.severity}</span><div><strong>{item.title}</strong><small>INC-{String(item.id).padStart(6, '0')} · {item.alert_ids?.length || 0} alerts · {item.note_count || 0} notes</small></div><em>{item.status}</em></button>)}{!loading && !filtered.length && <div className="module-empty small"><BriefcaseBusiness /><strong>No cases found</strong></div>}</section><section className="module-panel case-workspace">{selected ? <><div className="case-workspace-head"><div><small>INC-{String(selected.id).padStart(6, '0')}</small><h3>{selected.title}</h3><p>{selected.narrative || 'Correlated incident awaiting analyst documentation.'}</p></div><span className={`badge ${sevClass(selected.severity)}`}>{selected.severity}</span></div><div className="case-form"><label>Case owner<select value={selected.owner || ''} onChange={event => updateCase({ owner: event.target.value })}><option value="">Unassigned</option><option>Ahmad</option><option>SOC Analyst</option><option>Incident Lead</option></select></label><label>Case status<select value={selected.status} onChange={event => updateCase({ status: event.target.value })}><option value="open">Open</option><option value="closed">Closed</option><option value="false_positive">False positive</option></select></label></div><div className="workflow-notes case-note-history"><strong>Analyst timeline</strong><div>{(selected.notes || []).map(item => <article key={item.id}><p>{item.body}</p><small>{item.author} · {relativeTime(item.created_at)}</small></article>)}{!selected.notes?.length && <small>No notes recorded yet.</small>}</div><textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Document evidence, decisions, and next actions…" maxLength={4000} /><button disabled={!note.trim() || saving} onClick={addNote}>Add note</button></div><div className="case-facts"><span><Clock3 />First seen {fmtTs(selected.first_seen)}</span><span><ShieldAlert />{selected.alert_ids?.length || 0} correlated alerts</span></div><div className="case-actions"><button onClick={() => navigate('/incidents')}>Open incident command</button><a href={`/api/reports/incidents/${selected.id}`}><FileText />Generate report</a></div></> : <div className="module-empty"><BriefcaseBusiness /><strong>Select a case</strong></div>}</section></div></div>;
}
