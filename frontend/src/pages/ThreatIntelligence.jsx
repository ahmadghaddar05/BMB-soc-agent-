import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Copy, Globe2, Search, ShieldAlert, Star, UserRound } from 'lucide-react';
import { api, fmtTs } from '../lib/api';
import { copyText, parseJson, readLocal, saveLocal, severityOf } from '../lib/soc';
import { activityTitle, alertReference } from '../lib/executive';
import EntityRelationshipGraph from '../components/EntityRelationshipGraph';
import {
  Button, Card, EmptyState, SeverityBadge, SkeletonLoader, StatusChip,
} from '../components/ui';

function classifyObservable(value, alerts = []) {
  const observable = String(value || '').trim();
  if (alerts.some(alert => [alert.username, alert.user_email].filter(Boolean).includes(observable))) return { kind:'identity', label:'Identity / username' };
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(observable)) return { kind:'identity', label:'Email address' };
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(observable)) return { kind:'network', label:'IPv4 address' };
  if (/^[a-f0-9]{32,64}$/i.test(observable)) return { kind:'hash', label:'File hash' };
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(observable)) return { kind:'domain', label:'Domain name' };
  if (/^[a-z0-9._-]+$/i.test(observable)) return { kind:'identity', label:'Identity / username' };
  return { kind:'generic', label:'Security observable' };
}

function reputationState(reputation) {
  if (['malicious', 'critical', 'high'].includes(reputation)) return { tone:'error', label:'Malicious' };
  if (['clean', 'benign'].includes(reputation)) return { tone:'active', label:'No known threat match' };
  if (reputation === 'observed') return { tone:'neutral', label:'Observed internally' };
  return { tone:'neutral', label:'Unknown' };
}

export default function ThreatIntelligence() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [watchlist, setWatchlist] = useState(() => readLocal('bmb-threat-watchlist', []));

  async function search(event) {
    event?.preventDefault();
    const value = query.trim();
    if (!value) return;
    setLoading(true);
    setError('');
    try {
      setResult(await api(`/pivot?indicator=${encodeURIComponent(value)}`));
    } catch (searchError) {
      setError(searchError.message || 'The observable pivot could not be completed.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function toggleWatchlist() {
    const value = result?.indicator || query.trim();
    if (!value) return;
    const next = watchlist.includes(value) ? watchlist.filter(item => item !== value) : [...watchlist, value];
    setWatchlist(next);
    saveLocal('bmb-threat-watchlist', next);
  }

  function selectSaved(value) {
    setQuery(value);
    setResult(null);
    setError('');
  }

  const model = useMemo(() => {
    if (!result) return null;
    const intel = result.threat_intel || {};
    const alerts = result.alerts || [];
    const primary = alerts[0] || {};
    const confidenceRaw = intel.confidence ?? parseJson(primary.verdict).confidence ?? 0;
    const confidence = confidenceRaw <= 1 ? Math.round(confidenceRaw * 100) : Math.round(confidenceRaw);
    const reputation = intel.found ? (intel.severity || 'malicious') : alerts.length ? 'observed' : 'unknown';
    const hosts = [...new Set(alerts.map(alert => alert.hostname || alert.agent_name).filter(Boolean))];
    const users = [...new Set(alerts.map(alert => alert.username).filter(Boolean))];
    const techniques = [...new Set(alerts.flatMap(alert => alert.mitre_techniques || []))];
    const timestamps = alerts.map(alert => new Date(alert.timestamp).getTime()).filter(Number.isFinite).sort((left, right) => left - right);
    const timeSpan = timestamps.length > 1 ? Math.max(1, Math.round((timestamps.at(-1) - timestamps[0]) / 3600000)) : 0;
    const highRisk = alerts.filter(alert => ['critical', 'high'].includes(severityOf(alert))).length;
    return {
      intel, alerts, primary, confidence, reputation,
      observableType:classifyObservable(result.indicator, alerts),
      correlation:{ hosts, users, techniques, timeSpan, highRisk },
    };
  }, [result]);

  const indicator = result?.indicator || query.trim();
  const isWatched = watchlist.includes(indicator);
  const ObservableIcon = model?.observableType.kind === 'identity' ? UserRound : Globe2;
  const reputation = reputationState(model?.reputation);
  const threatSources = model?.intel?.sources || [];
  const incidents = result?.incidents || [];

  return (
    <div className="intel-page-v2 ui-page-enter">
      <form className="intel-search intel-search-v2" onSubmit={search}>
        <Search size={16} strokeWidth={1.5} aria-hidden="true" />
        <input value={query} onChange={event => { setQuery(event.target.value); if (!event.target.value.trim()) { setResult(null); setError(''); } }} placeholder="Search an IP, domain, hash, email, username, or host" aria-label="Search security observable" />
        <Button type="submit" variant="primary" disabled={loading || !query.trim()}>{loading ? 'Searching…' : 'Investigate observable'}</Button>
      </form>

      {error && <div className="intel-error-v2" role="alert"><ShieldAlert size={16} strokeWidth={1.5} aria-hidden="true" /><span>{error}</span><button type="button" onClick={search} disabled={loading || !query.trim()}>Retry</button></div>}
      {loading && <Card className="intel-loading-v2"><SkeletonLoader lines={7} /></Card>}

      {!loading && !model && !error && (
        <Card className="intel-welcome-v2">
          <EmptyState icon={Globe2} message="Search an observable to build its evidence map" />
          {watchlist.length > 0 && <div className="intel-saved-pivots"><span>Saved on this browser</span><div>{watchlist.slice(0, 8).map(item => <button key={item} type="button" onClick={() => selectSaved(item)}>{item}</button>)}</div></div>}
        </Card>
      )}

      {!loading && model && <>
        <Card className="intel-summary-v2">
          <header className="intel-observable-header">
            <span className="intel-observable-icon"><ObservableIcon aria-hidden="true" /></span>
            <div><span>{model.observableType.label}</span><h2>{indicator}</h2><p>Evidence-grounded pivot across stored alerts, incidents, and enrichment</p></div>
            <StatusChip status={reputation.tone}>{reputation.label}</StatusChip>
          </header>
          <dl className="intel-facts-v2"><div><dt>Confidence</dt><dd>{model.confidence ? `${model.confidence}%` : '—'}</dd></div><div><dt>Related alerts</dt><dd>{result.alert_count || 0}</dd></div><div><dt>Incidents</dt><dd>{result.incident_count || 0}</dd></div><div><dt>High-risk alerts</dt><dd>{model.correlation.highRisk}</dd></div></dl>
          <div className="intel-actions-v2"><Button variant="primary" icon={Search} onClick={() => navigate(`/investigations?search=${encodeURIComponent(indicator)}`)}>Build investigation</Button><Button icon={Star} className={isWatched ? 'is-watched' : ''} onClick={toggleWatchlist}>{isWatched ? 'Remove saved pivot' : 'Save pivot'}</Button><Button icon={Bot} onClick={() => window.dispatchEvent(new CustomEvent('open-soc-assistant', { detail:{ prompt:`Investigate ${indicator}. Summarize related alerts and incidents, explain the risk, and state any missing evidence.`, autoSend:true } }))}>Ask AI Analyst</Button><Button icon={Copy} onClick={() => copyText(indicator)}>Copy observable</Button></div>
        </Card>

        <EntityRelationshipGraph indicator={indicator} observableType={model.observableType} alerts={model.alerts} incidents={incidents} navigate={navigate} />

        <div className="intel-context-grid-v2">
          {model.alerts.length > 0 && <Card title={`Related alerts (${result.alert_count || model.alerts.length})`} caption="Latest stored detections containing this observable" className="intel-related-card-v2">
            <ol>{model.alerts.slice(0, 8).map(alert => <li key={alert.id}><button type="button" onClick={() => navigate(`/alerts?search=${encodeURIComponent(alert.id)}`)}><span><strong>{activityTitle(alert)}</strong><small>{alertReference(alert)} · {fmtTs(alert.timestamp)}</small></span><SeverityBadge severity={severityOf(alert)} /></button></li>)}</ol>
            <Button onClick={() => navigate(`/alerts?search=${encodeURIComponent(indicator)}`)}>View all matching alerts</Button>
          </Card>}

          {incidents.length > 0 && <Card title={`Related incidents (${result.incident_count || incidents.length})`} caption="Stored incidents whose evidence includes this observable" className="intel-related-card-v2">
            <ol>{incidents.slice(0, 6).map(incident => <li key={incident.id}><button type="button" onClick={() => navigate(`/incidents?incident=${encodeURIComponent(incident.id)}`)}><span><strong>{incident.title}</strong><small>{String(incident.status || 'open').replaceAll('_', ' ')} · {fmtTs(incident.last_seen)}</small></span><SeverityBadge severity={incident.severity} /></button></li>)}</ol>
          </Card>}

          {(threatSources.length > 0 || model.intel.found || model.intel.notes) && <Card title="Threat-intelligence context" caption="Recorded enrichment results for this observable" className="intel-source-card-v2">
            {threatSources.length > 0 && <ul>{threatSources.map(source => <li key={source}><span>{source}</span><StatusChip status={model.intel.found ? 'error' : 'neutral'}>{model.intel.found ? 'Match' : 'Checked'}</StatusChip></li>)}</ul>}
            {model.intel.notes && <p>{model.intel.notes}</p>}
          </Card>}

          <Card title="Observable profile" caption="Recorded classification and activity window" className="intel-profile-card-v2">
            <dl><div><dt>Indicator</dt><dd>{indicator}</dd></div><div><dt>Categories</dt><dd>{(model.intel.categories || []).join(', ') || 'Unclassified'}</dd></div><div><dt>Sharing level</dt><dd>{model.intel.tlp || 'Internal'}</dd></div><div><dt>Last seen</dt><dd>{fmtTs(model.intel.last_seen || model.primary.timestamp)}</dd></div></dl>
            <Button icon={Copy} onClick={() => copyText(JSON.stringify(result, null, 2))}>Copy pivot JSON</Button>
          </Card>

          {model.alerts.length > 0 && <Card title="Correlation context" caption="Observed entities and techniques across matching alerts" className="intel-correlation-card-v2">
            <dl><div><dt>Hosts</dt><dd>{model.correlation.hosts.length}</dd></div><div><dt>Identities</dt><dd>{model.correlation.users.length}</dd></div><div><dt>High-risk alerts</dt><dd>{model.correlation.highRisk}</dd></div><div><dt>Activity span</dt><dd>{model.correlation.timeSpan ? `${model.correlation.timeSpan}h` : '—'}</dd></div></dl>
            {model.correlation.techniques.length > 0 && <div className="intel-techniques-v2">{model.correlation.techniques.slice(0, 8).map(item => <span key={item}>{item}</span>)}</div>}
          </Card>}
        </div>
      </>}
    </div>
  );
}
