import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Ban, BellRing, Bot, Copy, Database, Globe2, Network, Plus, Radar, Search, ShieldAlert, Star, UserRound } from 'lucide-react';
import { api, fmtTs, sevClass } from '../lib/api';
import { copyText, parseJson, readLocal, saveLocal, severityOf } from '../lib/soc';

const SAMPLE_IOC = '185.199.110.153';

function classifyObservable(value, alerts = []) {
  const observable = String(value || '').trim();
  if (alerts.some(alert => [alert.username, alert.user_email].filter(Boolean).includes(observable))) return { kind: 'identity', label: 'Identity / username' };
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(observable)) return { kind: 'identity', label: 'Email address' };
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(observable)) return { kind: 'network', label: 'IPv4 address' };
  if (/^[a-f0-9]{32,64}$/i.test(observable)) return { kind: 'hash', label: 'File hash' };
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(observable)) return { kind: 'domain', label: 'Domain name' };
  if (/^[a-z0-9._-]+$/i.test(observable)) return { kind: 'identity', label: 'Identity / username' };
  return { kind: 'generic', label: 'Security observable' };
}

function GraphNode({ className, icon: Icon, label, value }) {
  return <article className={`intel-node ${className}`}><Icon /><span>{label}</span><strong>{value}</strong></article>;
}

export default function ThreatIntelligence() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [watchlist, setWatchlist] = useState(() => readLocal('bmb-threat-watchlist', []));
  const [blocked, setBlocked] = useState(() => readLocal('bmb-blocked-observables', []));

  useEffect(() => { if (!result && !query) setQuery(SAMPLE_IOC); }, [result, query]);

  async function search(event) {
    event?.preventDefault();
    const value = query.trim(); if (!value) return;
    setLoading(true); setError('');
    try { setResult(await api(`/pivot?indicator=${encodeURIComponent(value)}`)); }
    catch (e) { setError(e.message); setResult(null); }
    finally { setLoading(false); }
  }

  function toggleList(key, list, setter) {
    const value = result?.indicator || query.trim(); if (!value) return;
    const next = list.includes(value) ? list.filter(item => item !== value) : [...list, value];
    setter(next); saveLocal(key, next);
  }

  const model = useMemo(() => {
    if (!result) return null;
    const intel = result.threat_intel || {};
    const alerts = result.alerts || [];
    const primary = alerts[0] || {};
    const confidenceRaw = intel.confidence ?? parseJson(primary.verdict).confidence ?? 0;
    const confidence = confidenceRaw <= 1 ? Math.round(confidenceRaw * 100) : Math.round(confidenceRaw);
    const reputation = intel.found ? (intel.severity || 'malicious') : alerts.length ? 'observed' : 'clean';
    const hosts = [...new Set(alerts.map(alert => alert.hostname || alert.agent_name).filter(Boolean))];
    const users = [...new Set(alerts.map(alert => alert.username).filter(Boolean))];
    const techniques = [...new Set(alerts.flatMap(alert => alert.mitre_techniques || []))];
    const timestamps = alerts.map(alert => new Date(alert.timestamp).getTime()).filter(Number.isFinite).sort((a,b) => a-b);
    const timeSpan = timestamps.length > 1 ? Math.max(1, Math.round((timestamps.at(-1) - timestamps[0]) / 3600000)) : 0;
    const highRisk = alerts.filter(alert => ['critical','high'].includes(severityOf(alert))).length;
    const correlationStrength = Math.min(99, Math.round((alerts.length ? 35 : 0) + Math.min(25, hosts.length * 5) + Math.min(15, users.length * 5) + Math.min(15, techniques.length * 3) + (result.incident_count ? 10 : 0)));
    return { intel, alerts, primary, confidence, reputation, observableType: classifyObservable(result.indicator, alerts), correlation: { hosts, users, techniques, timeSpan, highRisk, strength: correlationStrength } };
  }, [result]);

  const indicator = result?.indicator || query.trim();
  const isWatched = watchlist.includes(indicator);
  const isBlocked = blocked.includes(indicator);
  const ObservableIcon = model?.observableType.kind === 'identity' ? UserRound : Globe2;

  return <div className="module-page intel-page">
    <div className="module-hero compact"><div><span className="eyebrow"><Radar />Observable intelligence</span><h2>Threat Intelligence</h2><p>Pivot across alerts, incidents, enrichment sources, identities, and hosts.</p></div><span className="live-pill"><i />Intelligence connected</span></div>

    <form className="intel-search" onSubmit={search}><Search /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search any IOC: IP, domain, hash, URL, email, usernameâ€¦" /><button disabled={loading}>{loading ? 'Searchingâ€¦' : 'Investigate IOC'}</button></form>
    {error && <div className="module-notice danger">{error}</div>}

    {!model ? <section className="intel-welcome"><Globe2 /><h3>Start an intelligence pivot</h3><p>Search an observable to build its relationship map and find related security activity.</p><div>{watchlist.slice(0,6).map(item => <button key={item} onClick={() => setQuery(item)}>{item}</button>)}</div></section> : <>
      <section className="intel-summary module-panel">
        <div className="observable-icon"><ObservableIcon /></div><div className="observable-title"><small>{model.observableType.label}</small><strong>{indicator}</strong><span>Last searched now</span></div>
        <dl><div><dt>Reputation</dt><dd className={`reputation-${model.reputation}`}>{model.reputation}</dd></div><div><dt>Confidence</dt><dd>{model.confidence || 'â€”'}{model.confidence ? '%' : ''}</dd></div><div><dt>Alerts</dt><dd>{result.alert_count}</dd></div><div><dt>Incidents</dt><dd>{result.incident_count}</dd></div></dl>
        <div className="intel-actions"><button className={isWatched ? 'active' : ''} onClick={() => toggleList('bmb-threat-watchlist', watchlist, setWatchlist)}><Star />{isWatched ? 'Watching' : 'Add to watchlist'}</button><button className={isBlocked ? 'danger active' : 'danger'} onClick={() => toggleList('bmb-blocked-observables', blocked, setBlocked)}><Ban />{isBlocked ? 'Remove block' : 'Block indicator'}</button><button onClick={() => copyText(indicator)}><Copy />Copy</button><button onClick={() => navigate(`/investigations?search=${encodeURIComponent(indicator)}`)}><Plus />Open investigation</button><button onClick={() => window.dispatchEvent(new CustomEvent('open-soc-assistant'))}><Bot />Ask AI</button></div>
      </section>

      <section className="module-panel relationship-panel"><div className="panel-heading"><div><Network /><span><strong>Entity relationship graph</strong><small>Observed links from stored alert evidence</small></span></div><span className="legend"><i className="observed" />Observed <i className="triggered" />Triggered alert <i className="correlated" />Correlated incident</span></div>
        <div className="intel-graph"><div className="graph-lines"><i className="line l1"/><i className="line l2"/><i className="line l3"/><i className="line l4"/><i className="line l5"/></div>
          <GraphNode className="node-user" icon={UserRound} label="User" value={model.primary.username || 'No identity'} />
          <GraphNode className="node-process" icon={Database} label="Process" value={model.primary.process || 'Observed event'} />
          <GraphNode className="node-ioc" icon={ObservableIcon} label={model.observableType.label} value={indicator} />
          <GraphNode className="node-host" icon={Database} label="Host" value={model.primary.hostname || 'No host'} />
          <GraphNode className="node-alert" icon={ShieldAlert} label="Related alerts" value={`${result.alert_count} matched`} />
          <GraphNode className="node-incident" icon={AlertTriangle} label="Incidents" value={`${result.incident_count} correlated`} />
        </div>
      </section>

      <div className="intel-card-grid">
        <section className="module-panel intel-card"><h3>Threat intelligence sources</h3><p className="intel-card-description">Where this observable was seen or enriched.</p>{(model.intel.sources || ['BMB enrichment', 'Elastic evidence']).map(source => <div className="intel-list-row" key={source}><span><i className={model.intel.found ? 'danger' : 'good'} />{source}</span><b>{model.intel.found ? 'Match' : 'Observed'}</b></div>)}<footer>{model.intel.notes || 'No external threat match was returned. Internal observations are still shown.'}</footer></section>
        <section className="module-panel intel-card"><h3>Related alerts ({result.alert_count})</h3><p className="intel-card-description">Latest detections containing this observable.</p>{model.alerts.slice(0,6).map(alert => <button className="intel-event" key={alert.id} onClick={() => navigate(`/alerts?search=${encodeURIComponent(indicator)}`)}><ShieldAlert /><span><strong>{alert.rule_desc || 'Security event'}</strong><small>{fmtTs(alert.timestamp)}</small></span><em className={sevClass(severityOf(alert))}>{severityOf(alert)}</em></button>)}{!model.alerts.length && <p className="mini-empty">No alert evidence found.</p>}<footer><button onClick={() => navigate(`/alerts?search=${encodeURIComponent(indicator)}`)}>View matching alerts</button></footer></section>
        <section className="module-panel intel-card"><h3>Related incidents ({result.incident_count})</h3>{(result.incidents || []).slice(0,4).map(incident => <button className="intel-event" key={incident.id} onClick={() => navigate('/incidents')}><AlertTriangle /><span><strong>{incident.title}</strong><small>{incident.status} Â· {fmtTs(incident.last_seen)}</small></span><em className={sevClass(incident.severity)}>{incident.severity}</em></button>)}{!result.incidents?.length && <p className="mini-empty">No correlated incidents found.</p>}</section>
        <section className="module-panel intel-card"><h3>Observable profile</h3><dl className="profile-list"><div><dt>Indicator</dt><dd>{indicator}</dd></div><div><dt>Categories</dt><dd>{(model.intel.categories || []).join(', ') || 'Not classified'}</dd></div><div><dt>TLP</dt><dd>{model.intel.tlp || 'Internal'}</dd></div><div><dt>Last seen</dt><dd>{fmtTs(model.intel.last_seen || model.primary.timestamp)}</dd></div></dl><footer><button onClick={() => copyText(JSON.stringify(result, null, 2))}>Copy intelligence JSON</button></footer></section>
        <section className="module-panel intel-card correlation-card"><h3>Correlation context</h3><div className="correlation-strength"><span><b style={{width:`${model.correlation.strength}%`}} /></span><strong>{model.correlation.strength}% evidence strength</strong></div><div className="correlation-metrics"><article><strong>{model.correlation.hosts.length}</strong><span>hosts</span></article><article><strong>{model.correlation.users.length}</strong><span>identities</span></article><article><strong>{model.correlation.highRisk}</strong><span>high-risk alerts</span></article><article><strong>{model.correlation.timeSpan ? `${model.correlation.timeSpan}h` : 'â€”'}</strong><span>activity span</span></article></div><div className="correlation-techniques">{model.correlation.techniques.slice(0,6).map(item => <span key={item}>{item}</span>)}{!model.correlation.techniques.length && <em>No MITRE techniques mapped yet</em>}</div><footer><button onClick={() => navigate(`/investigations?search=${encodeURIComponent(indicator)}`)}>Build correlated investigation</button></footer></section>
      </div>
    </>}
  </div>;
}
