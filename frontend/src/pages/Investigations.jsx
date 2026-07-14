import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, ClipboardList, Clock3, FilePlus2, FolderOpen, Search, ShieldAlert, Trash2, UserRound } from 'lucide-react';
import { api, sevClass } from '../lib/api';
import { entityOf, readLocal, relativeTime, saveLocal, severityOf } from '../lib/soc';

export default function Investigations() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('search') || '');
  const [alerts, setAlerts] = useState([]);
  const [selected, setSelected] = useState([]);
  const [investigations, setInvestigations] = useState(() => readLocal('bmb-investigations', []));
  const [activeId, setActiveId] = useState('');
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');

  async function runSearch(event) {
    event?.preventDefault(); if (!query.trim()) return;
    setLoading(true);
    try { const data = await api(`/alerts?limit=50&search=${encodeURIComponent(query.trim())}`); setAlerts(data.alerts || []); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (params.get('search')) runSearch(); }, []);

  function toggle(id) { setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); }

  function createInvestigation() {
    if (!selected.length) return;
    const item = { id: `INV-${Date.now().toString().slice(-8)}`, title: title.trim() || `Investigation: ${query}`, query, alertIds: selected, createdAt: new Date().toISOString(), status: 'open', owner: 'Analyst' };
    const next = [item, ...investigations]; setInvestigations(next); saveLocal('bmb-investigations', next); setActiveId(item.id); setTitle(''); setSelected([]);
  }

  function remove(id) { const next = investigations.filter(item => item.id !== id); setInvestigations(next); saveLocal('bmb-investigations', next); if (activeId === id) setActiveId(''); }
  const active = investigations.find(item => item.id === activeId) || investigations[0];
  const activeEvidence = useMemo(() => active ? alerts.filter(alert => active.alertIds.includes(alert.id)) : [], [active, alerts]);

  return <div className="module-page investigations-page">
    <div className="module-hero compact"><div><span className="eyebrow"><Search />Analyst workbench</span><h2>Investigations</h2><p>Search evidence, collect relevant alerts, and preserve an analyst investigation workspace.</p></div><span className="live-pill"><i />{investigations.filter(item => item.status === 'open').length} open workspaces</span></div>
    <form className="investigation-search" onSubmit={runSearch}><Search /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search rules, raw events, IPs, users, hostnames, or hashes" /><button disabled={loading}>{loading ? 'Searching…' : 'Search evidence'}</button></form>
    <div className="investigation-layout">
      <section className="module-panel evidence-browser"><div className="panel-heading"><div><ShieldAlert /><span><strong>Evidence browser</strong><small>{alerts.length} alerts returned · {selected.length} selected</small></span></div></div><div className="evidence-results">{alerts.map(alert => <article key={alert.id} className={selected.includes(alert.id) ? 'selected' : ''}><button className={`row-check ${selected.includes(alert.id) ? 'checked' : ''}`} onClick={() => toggle(alert.id)}>{selected.includes(alert.id) && <Check />}</button><div><strong>{alert.rule_desc || 'Security alert'}</strong><span>{entityOf(alert)} · {alert.src_ip || alert.process || 'No observable'}</span><small>{alert.id} · {relativeTime(alert.timestamp)}</small></div><span className={`badge ${sevClass(severityOf(alert))}`}>{severityOf(alert)}</span></article>)}{!loading && !alerts.length && <div className="module-empty"><Search /><strong>No evidence loaded</strong><span>Run a search to start building an investigation.</span></div>}</div><div className="investigation-builder"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Investigation title (optional)" /><button className="primary-action" disabled={!selected.length} onClick={createInvestigation}><FilePlus2 />Create from {selected.length} alerts</button></div></section>
      <section className="module-panel investigations-list"><div className="panel-heading"><div><ClipboardList /><span><strong>Investigation workspaces</strong><small>Stored for this analyst browser</small></span></div></div><div className="case-list">{investigations.map(item => <button key={item.id} className={active?.id === item.id ? 'active' : ''} onClick={() => setActiveId(item.id)}><FolderOpen /><span><strong>{item.title}</strong><small>{item.id} · {item.alertIds.length} evidence items</small></span><em>{item.status}</em></button>)}{!investigations.length && <div className="module-empty small"><ClipboardList /><strong>No investigations yet</strong></div>}</div>{active && <div className="case-detail"><div><span><UserRound />{active.owner}</span><span><Clock3 />{relativeTime(active.createdAt)}</span></div><h3>{active.title}</h3><p>Search context: <b>{active.query}</b></p><dl><div><dt>Status</dt><dd>{active.status}</dd></div><div><dt>Evidence</dt><dd>{active.alertIds.length} alerts</dd></div><div><dt>Loaded now</dt><dd>{activeEvidence.length}</dd></div></dl><div className="case-actions"><button onClick={() => navigate(`/alerts?search=${encodeURIComponent(active.query)}`)}>Open alert workspace</button><button className="danger" onClick={() => remove(active.id)}><Trash2 />Delete workspace</button></div></div>}</section>
    </div>
  </div>;
}
