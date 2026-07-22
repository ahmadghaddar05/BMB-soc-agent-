import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Bell, Copy, Laptop, Network, Search, Server, Shield, UserRound } from 'lucide-react';
import { api, sevClass } from '../lib/api';
import { copyText, entityOf, parseJson, relativeTime, severityOf } from '../lib/soc';
import { activityTitle } from '../lib/executive';

const rank = { critical: 5, high: 4, medium: 3, low: 2, informational: 1 };

export default function Assets() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [selectedKey, setSelectedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api('/alerts?limit=100');
      setAlerts(data.alerts || []);
    } catch (loadError) {
      setError(loadError.message || 'Observed entity data could not be loaded.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const assets = useMemo(() => {
    const map = new Map();
    const add = (kind, value, alert) => {
      if (!value) return; const key = `${kind}:${value}`;
      const item = map.get(key) || { key, kind, value, alerts: [], severity: 'informational', firstSeen: alert.timestamp, lastSeen: alert.timestamp };
      item.alerts.push(alert); item.lastSeen = item.lastSeen > alert.timestamp ? item.lastSeen : alert.timestamp; item.firstSeen = item.firstSeen < alert.timestamp ? item.firstSeen : alert.timestamp;
      const sev = severityOf(alert); if ((rank[sev] || 0) > (rank[item.severity] || 0)) item.severity = sev;
      map.set(key, item);
    };
    alerts.forEach(alert => { add('host', alert.hostname || alert.agent_name, alert); add('identity', alert.username, alert); add('address', alert.src_ip, alert); });
    return [...map.values()].sort((a,b) => (rank[b.severity] - rank[a.severity]) || b.alerts.length - a.alerts.length);
  }, [alerts]);

  const filtered = assets.filter(asset => (type === 'all' || asset.kind === type) && asset.value.toLowerCase().includes(search.toLowerCase()));
  const selected = filtered.find(asset => asset.key === selectedKey) || filtered[0] || null;
  const counts = { host: assets.filter(a => a.kind === 'host').length, identity: assets.filter(a => a.kind === 'identity').length, address: assets.filter(a => a.kind === 'address').length };

  function openAlerts(asset) {
    const key = asset.kind === 'host' ? 'hostname' : asset.kind === 'identity' ? 'username' : 'src_ip';
    navigate(`/alerts?search=${encodeURIComponent(asset.value)}&${key}=${encodeURIComponent(asset.value)}`);
  }

  return <div className="module-page assets-page">
    <div className="module-hero compact"><div><span className="eyebrow"><Server />Recent alert-derived entities</span><h2>Observed Entity Intelligence</h2><p>Hosts, identities, and network observables derived from the latest 100 stored Elastic alerts, not a complete CMDB inventory.</p></div><span className="live-pill"><i />{alerts.length} alerts sampled</span></div>
    {error && <div className="module-notice danger" role="alert"><span>{error}</span><button type="button" onClick={load} disabled={loading}>Retry</button></div>}
    <div className="module-metrics"><article className="metric-card tone-blue"><span><Server /></span><div><small>Observed hosts</small><strong>{counts.host}</strong></div></article><article className="metric-card tone-purple"><span><UserRound /></span><div><small>Observed identities</small><strong>{counts.identity}</strong></div></article><article className="metric-card tone-green"><span><Network /></span><div><small>Observed addresses</small><strong>{counts.address}</strong></div></article><article className="metric-card tone-red"><span><Shield /></span><div><small>High-risk observed entities</small><strong>{assets.filter(a => rank[a.severity] >= 4).length}</strong></div></article></div>
    <div className="asset-layout">
      <section className="module-panel asset-inventory"><div className="panel-heading"><div><Laptop /><span><strong>Observed entity sample</strong><small>{filtered.length} entities in this view</small></span></div></div><div className="inventory-controls"><label><Search /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search host, user, or IP" /></label><select value={type} onChange={e => setType(e.target.value)}><option value="all">All observed types</option><option value="host">Hosts</option><option value="identity">Identities</option><option value="address">Addresses</option></select></div>
        <div className="asset-list">{filtered.map(asset => { const Icon = asset.kind === 'host' ? Server : asset.kind === 'identity' ? UserRound : Network; return <button key={asset.key} className={selected?.key === asset.key ? 'active' : ''} onClick={() => setSelectedKey(asset.key)}><span className={`asset-type asset-${asset.kind}`}><Icon /></span><div><strong>{asset.value}</strong><small>{asset.kind} · last seen {relativeTime(asset.lastSeen)}</small></div><span className={`badge ${sevClass(asset.severity)}`}>{asset.severity}</span><b>{asset.alerts.length}<small>alerts</small></b></button>; })}{!loading && !error && !filtered.length && <div className="module-empty small"><Server /><strong>No matching observed entities</strong></div>}</div>
      </section>
      <section className="module-panel asset-detail">{selected ? <><div className="asset-detail-hero"><span className={`asset-type asset-${selected.kind}`}>{selected.kind === 'host' ? <Server /> : selected.kind === 'identity' ? <UserRound /> : <Network />}</span><div><small>{selected.kind}</small><h3>{selected.value}</h3><p>Observed in {selected.alerts.length} sampled security alerts</p></div><span className={`badge ${sevClass(selected.severity)}`}>{selected.severity} observed risk</span></div><div className="asset-actions"><button onClick={() => openAlerts(selected)}><Bell />View related alerts</button><button onClick={() => copyText(selected.value)}><Copy />Copy identifier</button><button onClick={() => navigate(`/investigations?search=${encodeURIComponent(selected.value)}`)}><Search />Investigate</button></div>
        <div className="asset-facts"><article><small>First observed</small><strong>{relativeTime(selected.firstSeen)}</strong></article><article><small>Last observed</small><strong>{relativeTime(selected.lastSeen)}</strong></article><article><small>Critical / high</small><strong>{selected.alerts.filter(a => rank[severityOf(a)] >= 4).length}</strong></article><article><small>AI-triaged</small><strong>{selected.alerts.filter(a => a.triage_status === 'triaged').length}</strong></article></div>
        <div className="asset-timeline"><h4>Recent security activity</h4>{selected.alerts.slice(0,8).map(alert => { const verdict = parseJson(alert.verdict); return <article key={alert.id}><i className={severityOf(alert)} /><span><strong>{activityTitle(alert)}</strong><small>{entityOf(alert)} · {relativeTime(alert.timestamp)}</small></span><em>{verdict.verdict?.replaceAll('_',' ') || alert.triage_status || 'pending'}</em></article>; })}</div></> : error ? <div className="module-empty"><Activity /><strong>Observed entity data unavailable</strong><span>Retry loading to restore entity context.</span></div> : <div className="module-empty"><Activity /><strong>Select an observed entity</strong></div>}</section>
    </div>
  </div>;
}
