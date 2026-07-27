import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Bot, Check, CircleUserRound, Clock3, Download,
  Fingerprint, Link2, LockKeyhole, Monitor, Network, RefreshCw, Search,
  Server, Shield, ShieldAlert, ShieldCheck, Sparkles, Target, UserRound,
} from 'lucide-react';
import { api, fmtTs, sevClass } from '../lib/api';
import { activityTitle, humanize, severityOf } from '../lib/executive';
import { relativeTime } from '../lib/soc';
import InfoTip from '../components/InfoTip';

const TACTIC_LABELS = {
  reconnaissance: 'Reconnaissance', resource_development: 'Resource Development', initial_access: 'Initial Access',
  execution: 'Execution', persistence: 'Persistence', privilege_escalation: 'Privilege Escalation',
  defense_evasion: 'Defense Evasion', credential_access: 'Credential Access', discovery: 'Discovery',
  lateral_movement: 'Lateral Movement', collection: 'Collection', command_and_control: 'Command & Control',
  exfiltration: 'Exfiltration', impact: 'Impact', unknown: 'Investigation',
};

function severityScore(severity, alertCount) {
  const base = { critical: 90, high: 72, medium: 48, low: 24 }[severity] || 35;
  return Math.min(99, base + Math.min(9, Math.max(0, alertCount - 1)));
}

function stageIcon(stage) {
  if (stage === 'credential_access') return Fingerprint;
  if (stage === 'lateral_movement') return Network;
  if (stage === 'collection') return Server;
  if (stage === 'initial_access') return Target;
  return Shield;
}

function compactTime(timestamp) {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function entityCounts(alerts = []) {
  const users = new Set(alerts.map(item => item.username).filter(Boolean));
  const hosts = new Set(alerts.map(item => item.hostname || item.agent_name).filter(Boolean));
  return { users: users.size, hosts: hosts.size };
}

function IncidentEmpty() {
  return <div className="incident-empty"><ShieldCheck /><strong>No incidents in this view</strong><span>Change the status filter or wait for the next correlation cycle.</span></div>;
}

function incidentReference(id) {
  return `INC-${String(id).padStart(5, '0')}`;
}

function correlatedCount(incident) {
  return Number(incident.alert_count || incident.alert_ids?.length || incident.correlated_alert_count || 0);
}

function IncidentSelection({
  incidents, total, status, setStatus, loading, error, reload, openIncident, workspace,
}) {
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('all');
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return incidents.filter(incident => {
      if (severity !== 'all' && severityOf(incident) !== severity) return false;
      if (!term) return true;
      return [
        incidentReference(incident.id), incident.title, incident.owner, incident.narrative,
        incident.severity, ...(incident.common_entities ? Object.values(incident.common_entities).flat() : []),
      ].filter(Boolean).some(value => String(value).toLowerCase().includes(term));
    });
  }, [incidents, query, severity]);
  const critical = incidents.filter(item => severityOf(item) === 'critical').length;
  const high = incidents.filter(item => severityOf(item) === 'high').length;
  const unassigned = incidents.filter(item => !item.owner).length;

  return (
    <div className="incident-command incident-selection">
      <header className="incident-selection-hero">
        <div>
          <span className="eyebrow"><ShieldAlert />Security operations</span>
          <h2>{workspace === 'cases' ? 'Case-linked Incidents' : 'Incident Command'}</h2>
          <p>Select an incident to enter its command workspace. Nothing is opened automatically, so analysts retain control of their investigation context.</p>
        </div>
        <button type="button" onClick={reload} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh incidents</button>
      </header>

      <section className="incident-selection-metrics" aria-label="Incident queue summary">
        <article><span>Incidents in view</span><strong>{total}</strong><small>{status === 'open' ? 'Requiring review or ownership' : humanize(status)}</small></article>
        <article className="critical"><span>Critical</span><strong>{critical}</strong><small>Confirmed critical severity only</small></article>
        <article className="high"><span>High</span><strong>{high}</strong><small>Elevated analyst priority</small></article>
        <article className="attention"><span>Without owner</span><strong>{unassigned}</strong><small>Assignment is the next decision</small></article>
      </section>

      <section className="incident-browser">
        <div className="incident-browser-toolbar">
          <div className="incident-search">
            <Search />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search incident title, reference, owner, or entity"
              aria-label="Search incidents"
            />
          </div>
          <label>Status
            <select value={status} onChange={event => setStatus(event.target.value)}>
              <option value="open">Open incidents</option>
              <option value="closed">Closed incidents</option>
              <option value="false_positive">False positives</option>
            </select>
          </label>
          <label>Severity
            <select value={severity} onChange={event => setSeverity(event.target.value)}>
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
        </div>

        <div className="incident-browser-heading">
          <div><strong>{filtered.length} displayed</strong><span>{total} total {status.replaceAll('_', ' ')}</span></div>
          <span>Choose an incident to review its attack story, evidence, ownership, and containment plan.</span>
        </div>

        {error && <div className="module-notice danger" role="alert"><span>{error}</span><button type="button" onClick={reload}>Retry</button></div>}
        <div className="incident-card-list">
          {filtered.map(incident => {
            const itemSeverity = severityOf(incident);
            const count = correlatedCount(incident);
            return (
              <article key={incident.id} className={`incident-queue-card severity-${itemSeverity}`}>
                <span className={`incident-queue-severity ${itemSeverity}`}><Shield /><b>{humanize(itemSeverity)}</b></span>
                <div className="incident-queue-main">
                  <div><code>{incidentReference(incident.id)}</code><span>{humanize(incident.status || status)}</span></div>
                  <h3>{incident.title || 'Untitled security incident'}</h3>
                  <p>{incident.narrative || 'Open the incident command workspace to review its correlated evidence and attack path.'}</p>
                  <dl>
                    <div><dt>Correlated alerts</dt><dd>{count || 'Not summarized'}</dd></div>
                    <div><dt>Owner</dt><dd>{incident.owner || 'Unassigned'}</dd></div>
                    <div><dt>Opened</dt><dd>{relativeTime(incident.first_seen || incident.created_at)}</dd></div>
                    <div><dt>Last activity</dt><dd>{relativeTime(incident.last_seen || incident.updated_at)}</dd></div>
                  </dl>
                </div>
                <div className="incident-queue-decision">
                  <small>Next decision</small>
                  <strong>{incident.owner ? 'Review evidence and containment' : 'Assign an accountable owner'}</strong>
                  <button type="button" onClick={() => openIncident(incident.id)}>Open incident <ArrowRight /></button>
                </div>
              </article>
            );
          })}
          {loading && !incidents.length && <div className="incident-empty" role="status"><RefreshCw className="animate-spin" /><strong>Loading incident queue</strong><span>Reading correlated incident records and ownership state.</span></div>}
          {!loading && !error && !filtered.length && (
            query || severity !== 'all'
              ? <div className="incident-empty"><Search /><strong>No matching incidents</strong><span>Clear the search or broaden the severity filter.</span><button type="button" onClick={() => { setQuery(''); setSeverity('all'); }}>Clear filters</button></div>
              : <IncidentEmpty />
          )}
        </div>
      </section>
    </div>
  );
}

export default function Incidents({ workspace = 'incidents', readOnly = false }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedIncident = searchParams.get('incident');
  const [incidents, setIncidents] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('open');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [graphExpanded, setGraphExpanded] = useState(false);
  const [showAllEvidence, setShowAllEvidence] = useState(false);
  const [completedActions, setCompletedActions] = useState({});
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await api(`/incidents?status=${status}&page=1&limit=50`);
      let rows = data.incidents || [];
      if (requestedIncident && !rows.some(item => String(item.id) === String(requestedIncident))) {
        const requested = await api(`/incidents/${encodeURIComponent(requestedIncident)}`).catch(() => null);
        if (requested) rows = [requested, ...rows];
        else setLoadError(`Incident ${requestedIncident} was not found or is no longer available.`);
      }
      setIncidents(rows);
      setTotal(data.total || 0);
      setSelectedId(requestedIncident && rows.some(item => String(item.id) === String(requestedIncident))
        ? requestedIncident
        : null);
    } catch (error) {
      setLoadError(error.message || 'The incident queue could not be loaded.');
      setIncidents([]); setTotal(0); setSelectedId(null);
    } finally { setLoading(false); }
  }, [requestedIncident, status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let live = true;
    setDetail(null);
    setLoadError('');
    api(`/incidents/${selectedId}`)
      .then(data => { if (live) setDetail(data); })
      .catch(error => {
        if (!live) return;
        setDetail(null);
        setLoadError(error.message || 'The selected incident details could not be loaded.');
      });
    return () => { live = false; };
  }, [selectedId]);

  const model = useMemo(() => {
    if (!detail) return null;
    const alerts = [...(detail.alerts || [])].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const stages = detail.attack_stages?.length ? detail.attack_stages : [...new Set(alerts.flatMap(item => item.mitre_tactics || []))];
    const counts = entityCounts(alerts);
    return { alerts, stages, counts, score: severityScore(detail.severity, alerts.length || detail.alert_ids?.length || 0) };
  }, [detail]);

  async function updateStatus(nextStatus) {
    if (!detail?.id) return;
    setUpdating(true);
    try { await api(`/incidents/${detail.id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) }); setStatus(nextStatus === 'open' ? 'open' : nextStatus); await load(); }
    finally { setUpdating(false); }
  }

  async function assignIncident() {
    if (!detail?.id) return;
    setUpdating(true);
    try {
      const updated = await api(`/cases/${detail.id}`, {
        method: 'PATCH', body: JSON.stringify({ owner: detail.owner ? '' : 'SOC Analyst' }),
      });
      setDetail(current => ({ ...current, ...updated }));
      setIncidents(current => current.map(item => String(item.id) === String(updated.id) ? { ...item, ...updated } : item));
    } finally { setUpdating(false); }
  }

  function toggleContainment(index) {
    const key = String(detail.id); const current = completedActions[key] || [];
    setCompletedActions({ ...completedActions, [key]: current.includes(index) ? current.filter(value => value !== index) : [...current,index] });
  }

  function openIncident(id) {
    const next = new URLSearchParams(searchParams);
    next.set('incident', String(id));
    setSelectedId(String(id));
    setSearchParams(next);
  }

  function returnToQueue() {
    const next = new URLSearchParams(searchParams);
    next.delete('incident');
    setSelectedId(null);
    setDetail(null);
    setLoadError('');
    setGraphExpanded(false);
    setShowAllEvidence(false);
    setSearchParams(next);
  }

  if (!requestedIncident) {
    return (
      <IncidentSelection
        incidents={incidents}
        total={total}
        status={status}
        setStatus={setStatus}
        loading={loading}
        error={loadError}
        reload={load}
        openIncident={openIncident}
        workspace={workspace}
      />
    );
  }

  if (!detail || !model) {
    return (
      <div className="incident-command">
        <div className="incident-command-nav">
          <button type="button" onClick={returnToQueue}><ArrowLeft />All incidents</button>
          <span>{incidentReference(requestedIncident)}</span>
          <button type="button" onClick={load} aria-label="Refresh incident"><RefreshCw className={loading ? 'animate-spin' : ''} /></button>
        </div>
        {loadError
          ? <div className="incident-empty"><ShieldAlert /><strong>Incident could not be opened</strong><span>{loadError}</span><button type="button" onClick={load}>Retry</button></div>
          : <div className="incident-empty" role="status"><RefreshCw className="animate-spin" /><strong>Opening incident command</strong><span>Loading attack story, evidence, ownership, and containment context.</span></div>}
      </div>
    );
  }

  const alertCount = model.alerts.length || detail.alert_ids?.length || 0;
  const highCount = model.alerts.filter(item => ['critical','high'].includes(severityOf(item))).length;
  const mediumCount = model.alerts.filter(item => severityOf(item) === 'medium').length;
  const requiredDecision = !detail.owner
    ? 'Assign an accountable incident owner.'
    : detail.status === 'open'
      ? 'Validate containment and record the next analyst action.'
      : 'Confirm closure evidence and reporting are complete.';
  const containmentStatus = detail.status === 'closed' ? 'Record closed' : 'Not recorded';

  return (
    <div className="incident-command">
      <div className="incident-command-nav">
        <button type="button" onClick={returnToQueue}><ArrowLeft />All incidents</button>
        <div><span>{incidentReference(detail.id)}</span><b>{workspace === 'cases' ? 'Case-linked incident' : 'Incident command workspace'}</b></div>
        <button type="button" onClick={load} aria-label="Refresh incident"><RefreshCw className={loading ? 'animate-spin' : ''} /></button>
      </div>

      <section className="incident-hero">
        <div className={`incident-severity-icon ${detail.severity || 'medium'}`}><span>{detail.severity || 'medium'}</span><Shield /></div>
        <div className="incident-title"><h1>{detail.title || 'Untitled security incident'}</h1><p>INC-{String(detail.id).padStart(5, '0')} <i /> Detected {fmtTs(detail.first_seen)} <i /> Last updated {fmtTs(detail.last_seen)}</p></div>
        <div className="incident-score"><span>Derived Risk Indicator <InfoTip text="Client-derived from stored severity and correlated alert volume. This is not a persisted enterprise risk score." /></span><div><strong>{model.score}</strong><small>/100</small></div></div>
        <div className="incident-alert-count"><span>Correlated Alerts</span><strong>{alertCount}</strong><small><b>{highCount} High</b> · {mediumCount} Medium</small></div>
        <div className="incident-controls">{readOnly ? <div className="incident-read-only"><ShieldCheck />Executive review · analyst controls hidden</div> : <><label>Status<select value={detail.status || 'open'} onChange={event => updateStatus(event.target.value)} disabled={updating}><option value="open">In progress</option><option value="closed">Closed</option><option value="false_positive">False positive</option></select></label><div><button className={detail.owner ? 'assigned' : ''} onClick={assignIncident} disabled={updating} title="Persist incident ownership in the BMB case record"><CircleUserRound />{detail.owner || 'Assign to SOC Analyst'}</button><button className="contain" onClick={() => updateStatus('closed')} disabled={updating}><LockKeyhole />Close incident record</button></div></>}<a href={`/api/reports/incidents/${detail.id}`} target="_blank" rel="noreferrer"><Download />Generate report</a></div>
      </section>

      <section className="incident-command-summary" aria-label="Incident command summary">
        <article><span>What happened</span><strong>{detail.title || 'Correlated security activity'}</strong><small>{model.stages.length ? `${model.stages.length} ATT&CK stages are represented in stored evidence.` : 'No ATT&CK stage mapping is available.'}</small></article>
        <article><span>Business impact</span><strong>{detail.severity ? `${humanize(detail.severity)} impact potential` : 'Not assessed'}</strong><small>Business-service mapping is not stored; impact is based on incident severity.</small></article>
        <article><span>Containment status</span><strong>{containmentStatus}</strong><small>{detail.status === 'closed' ? 'Closure does not prove an external containment action occurred.' : 'No approved external containment state is stored.'}</small></article>
        <article><span>Remaining exposure</span><strong>{detail.status === 'open' ? `${highCount} high-risk alerts` : 'Requires closure validation'}</strong><small>{alertCount} correlated alerts remain available as evidence.</small></article>
        <article><span>Owner and age</span><strong>{detail.owner || 'Unassigned'}</strong><small>Opened {relativeTime(detail.first_seen || detail.created_at)}</small></article>
        <article className="decision"><span>Required decision</span><strong>{requiredDecision}</strong><small>Recommendations are planning-only unless an approved integration reports execution.</small></article>
      </section>

      <section className="incident-metrics">
        <article><UserRound /><div><span>Affected identities</span><strong>{model.counts.users || '—'}</strong><small>{Object.values(detail.common_entities || {}).flat().filter(Boolean)[0] || 'No shared identity'}</small></div></article>
        <article><Monitor /><div><span>Affected assets</span><strong>{model.counts.hosts || '—'}</strong><small>{model.alerts.map(item => item.hostname || item.agent_name).filter(Boolean).slice(0,3).join(' · ') || 'No host context'}</small></div></article>
        <article><Link2 /><div><span>Attack path</span><strong>{model.stages.length || 1} stages</strong><small>{model.stages.map(stage => TACTIC_LABELS[stage] || stage).slice(0,3).join(' → ')}</small></div></article>
        <article><Sparkles /><div><span>AI impact assessment</span><strong className={`impact-${detail.severity}`}>{detail.severity || 'Unknown'}</strong><small>{detail.narrative ? 'AI correlation narrative available' : 'Awaiting narrative'}</small></div></article>
      </section>

      <div className="incident-body-grid">
        <main className="incident-main-column">
          <section className={`attack-story incident-panel ${graphExpanded ? 'is-expanded' : ''}`}>
            <div className="incident-panel-title"><h2>ATT&amp;CK Attack Story <InfoTip text="Chronological security events mapped to MITRE ATT&CK stages." /></h2><button onClick={() => setGraphExpanded(value => !value)}>{graphExpanded ? 'Restore graph' : 'View full graph ↗'}</button></div>
            <div className="attack-stage-bar">{(model.stages.length ? model.stages : ['unknown']).slice(0,5).map(stage => <span key={stage}>{TACTIC_LABELS[stage] || stage}</span>)}</div>
            <div className="attack-path">
              {(model.alerts.length ? model.alerts.slice(0,6) : [{ rule_desc: detail.title, timestamp: detail.first_seen, mitre_tactics: model.stages }]).map((alert, index) => {
                const stage = alert.mitre_tactics?.[0] || 'unknown'; const Icon = stageIcon(stage);
                return <article key={alert.id || index} className={severityOf(alert) === 'critical' ? 'critical' : index > 2 ? 'elevated' : ''}><time>{compactTime(alert.timestamp)}</time><span className="attack-node"><Icon /></span><strong>{activityTitle(alert)}</strong><small>{alert.username || alert.hostname || alert.src_ip || TACTIC_LABELS[stage]}</small><em>{alert.mitre_techniques?.[0] || TACTIC_LABELS[stage]}</em></article>;
              })}
            </div>
          </section>

          <div className="incident-lower-grid">
            <section className="incident-panel evidence-panel"><div className="incident-panel-title"><h2>Key Evidence</h2><button onClick={() => setShowAllEvidence(value => !value)}>{showAllEvidence ? 'Show key evidence' : 'View all evidence ↗'}</button></div><div className="incident-evidence-table"><div className="evidence-head"><span>Time</span><span>Event</span><span>Source</span><span>Details</span><span>Severity</span></div>{model.alerts.slice(0,showAllEvidence ? model.alerts.length : 7).map((alert,index)=>{ const severity=severityOf(alert); return <article key={alert.id || index}><time>{fmtTs(alert.timestamp)}</time><strong>{activityTitle(alert)}</strong><span>{alert.agent_name || alert.decoder || 'Elastic'}</span><p>{[alert.src_ip, alert.username, alert.hostname].filter(Boolean).join(' → ') || 'Normalized event evidence'}</p><em className={severity}>{humanize(severity)}</em></article>; })}</div></section>

            <section className="incident-panel containment-panel"><div className="incident-panel-title"><h2>Recommended Containment</h2><span>{readOnly ? 'Planning only' : `${(completedActions[String(detail.id)] || []).length} acknowledged`}</span></div><div className="module-notice"><ShieldAlert />Planning only — no endpoint, identity, firewall, or Elastic record is changed here.</div><div className="containment-list">{(detail.recommended_actions || ['Disable the affected account','Isolate affected hosts','Revoke active sessions','Reset credentials']).slice(0,5).map((action,index)=>{ const done=(completedActions[String(detail.id)] || []).includes(index); return <article key={index} className={done ? 'complete' : ''}><span>{done ? <Check /> : index === 0 ? <UserRound /> : index === 1 ? <Monitor /> : <LockKeyhole />}</span><div><strong>{action}</strong><small>{done ? 'Acknowledged in this analyst session; no action was executed' : 'Review recommendation before using an approved response system'}</small></div>{!readOnly && <button onClick={() => toggleContainment(index)}>{done ? 'Undo review' : 'Acknowledge'}</button>}</article>;})}</div></section>
          </div>
        </main>

        <aside className="incident-side-column">
          <section className="incident-panel live-activity-panel"><div className="incident-panel-title"><h2>Recent Activity</h2><span>Stored evidence</span></div><div>{model.alerts.slice(-7).reverse().map((alert,index)=>{ const severity=severityOf(alert); return <article key={alert.id || index}><i className={severity} /><time>{compactTime(alert.timestamp)}</time><p>{activityTitle(alert)}<small>{alert.hostname || alert.username || alert.src_ip || 'Elastic'}</small></p><em>{humanize(severity)}</em></article>; })}</div></section>
          <section className="incident-panel incident-ai"><div className="incident-panel-title"><h2>AI Incident Brief</h2><span className="beta">Evidence grounded</span></div><div className="ai-summary"><Bot /><p><strong>Current assessment</strong>{detail.narrative || 'This incident contains correlated security activity. Review the attack path and evidence before changing its status.'}</p></div><button onClick={() => window.dispatchEvent(new CustomEvent('open-soc-assistant', { detail:{ prompt:`Explain incident INC-${String(detail.id).padStart(5, '0')} in plain language. Summarize the attack path, strongest evidence, business impact, and next analyst action.`, autoSend:true } }))}>Ask AI to explain this incident</button></section>
        </aside>
      </div>
    </div>
  );
}
