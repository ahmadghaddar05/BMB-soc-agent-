import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Bot, Check, CircleUserRound, Download,
  Fingerprint, Link2, LockKeyhole, Monitor, Network, RefreshCw,
  Server, Shield, ShieldAlert, ShieldCheck, Sparkles, Target, UserRound,
} from 'lucide-react';
import { api, fmtTs } from '../lib/api';
import { activityTitle, humanize, severityOf } from '../lib/executive';
import { relativeTime } from '../lib/soc';
import InfoTip from '../components/InfoTip';
import IncidentCorrelationTrace from '../components/IncidentCorrelationTrace';
import AnalystDecisionReview from '../components/AnalystDecisionReview';
import {
  Button, EmptyState, Select, SeverityBadge, SkeletonLoader, StatusChip,
} from '../components/ui';

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
  return <li className="incident-list-empty"><EmptyState icon={ShieldCheck} message="No incidents in this view" action="Change the status filter" /></li>;
}

function incidentReference(id) {
  return `INC-${String(id).padStart(5, '0')}`;
}

function correlatedCount(incident) {
  return Number(incident.alert_count || incident.alert_ids?.length || incident.correlated_alert_count || 0);
}

function incidentSeverity(incident = {}) {
  const stored = String(incident.severity || '').toLowerCase();
  if (['critical', 'high', 'medium', 'low'].includes(stored)) return stored;
  return severityOf(incident);
}

function IncidentSelection({
  incidents, total, status, setStatus, loading, error, reload, openIncident, workspace, lastRefreshed,
}) {
  const [severity, setSeverity] = useState('all');
  const filtered = useMemo(() => incidents.filter(incident => severity === 'all' || incidentSeverity(incident) === severity), [incidents, severity]);
  const critical = incidents.filter(item => incidentSeverity(item) === 'critical').length;
  const unassigned = incidents.filter(item => !item.owner).length;
  const correlatedAlerts = incidents.reduce((sum, item) => sum + correlatedCount(item), 0);

  return (
    <div className="incidents-page-v2 ui-page-enter">
      <section className="incidents-kpi-strip" aria-label="Incident queue summary">
        <article><small>{humanize(status)} incidents</small><strong>{total}</strong></article>
        <article><small>Correlated alerts</small><strong>{correlatedAlerts}</strong></article>
        <article className="is-critical"><small>Critical incidents</small><strong>{critical}</strong></article>
        <article className="is-attention"><small>Without owner</small><strong>{unassigned}</strong></article>
      </section>

      <section className="incident-queue-v2" aria-label={workspace === 'cases' ? 'Case-linked incidents' : 'Incident command queue'}>
        <header className="incident-queue-toolbar">
          <div><h2>{workspace === 'cases' ? 'Case-linked incidents' : 'Incident command queue'}</h2><p>Select a security story to review its evidence, ownership, and containment plan.</p></div>
          <div>
            <Select label="Status" value={status} onChange={event => setStatus(event.target.value)}><option value="open">Open incidents</option><option value="closed">Closed incidents</option><option value="false_positive">False positives</option></Select>
            <Select label="Severity" value={severity} onChange={event => setSeverity(event.target.value)}><option value="all">All severities</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select>
            <div className="incident-queue-refresh"><small>{lastRefreshed ? `Updated ${lastRefreshed.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}` : 'Awaiting refresh'}</small><Button icon={RefreshCw} iconOnly aria-label="Refresh incidents" onClick={reload} disabled={loading} className={loading ? 'is-loading' : ''} /></div>
          </div>
        </header>

        {error && <div className="incidents-error" role="alert"><ShieldAlert size={16} strokeWidth={1.5} aria-hidden="true" /><span>{error}</span><button type="button" onClick={reload}>Retry</button></div>}
        <ol className="incident-list-v2" aria-label={`${filtered.length} incidents displayed`}>
          {filtered.map(incident => {
            const itemSeverity = incidentSeverity(incident);
            const count = correlatedCount(incident);
            const itemStatus = incident.status === 'closed' ? { label:'Closed', tone:'resolved' } : incident.status === 'false_positive' ? { label:'False positive', tone:'neutral' } : { label:'Open', tone:'active' };
            return (
              <li key={incident.id} className={`is-${itemSeverity}`}>
                <button type="button" onClick={() => openIncident(incident.id)} aria-label={`Open ${incidentReference(incident.id)} ${incident.title || 'Untitled security incident'}`}>
                  <div className="incident-row-heading"><code>{incidentReference(incident.id)}</code><SeverityBadge severity={itemSeverity} /><StatusChip status={itemStatus.tone}>{itemStatus.label}</StatusChip></div>
                  <strong>{incident.title || 'Untitled security incident'}</strong>
                  <p>{incident.narrative || 'Review the correlated evidence and attack path in Incident Command.'}</p>
                  <dl><div><dt>Alerts</dt><dd>{count || '—'}</dd></div><div><dt>Owner</dt><dd>{incident.owner || 'Unassigned'}</dd></div><div><dt>Opened</dt><dd>{relativeTime(incident.first_seen || incident.created_at)}</dd></div><div><dt>Last activity</dt><dd>{relativeTime(incident.last_seen || incident.updated_at)}</dd></div></dl>
                  <span className="incident-row-decision"><small>Next decision</small><b>{incident.owner ? 'Review evidence and containment' : 'Assign an accountable owner'}</b><span>Open incident <ArrowRight aria-hidden="true" /></span></span>
                </button>
              </li>
            );
          })}
          {loading && !incidents.length && <li className="incident-list-loading" role="status"><SkeletonLoader lines={6} /></li>}
          {!loading && !error && !filtered.length && (
            severity !== 'all'
              ? <li className="incident-list-empty"><EmptyState icon={ShieldCheck} message="No incidents match this severity" action="Choose another severity" /></li>
              : <IncidentEmpty />
          )}
        </ol>
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
  const [journey, setJourney] = useState(null);
  const [journeyLoading, setJourneyLoading] = useState(false);
  const [journeyError, setJourneyError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [graphExpanded, setGraphExpanded] = useState(false);
  const [showAllEvidence, setShowAllEvidence] = useState(false);
  const [completedActions, setCompletedActions] = useState({});
  const [loadError, setLoadError] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState(null);

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
      setLastRefreshed(new Date());
    } catch (error) {
      setLoadError(error.message || 'The incident queue could not be loaded.');
      setIncidents([]); setTotal(0); setSelectedId(null);
    } finally { setLoading(false); }
  }, [requestedIncident, status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    const interval = window.setInterval(refreshWhenVisible, 30_000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [load]);
  useEffect(() => {
    if (!selectedId) { setDetail(null); setJourney(null); return; }
    let live = true;
    setDetail(null);
    setJourney(null);
    setJourneyLoading(true);
    setJourneyError(false);
    setLoadError('');
    Promise.allSettled([
      api(`/incidents/${selectedId}`),
      api(`/incidents/${selectedId}/journey`),
    ]).then(([detailResult, journeyResult]) => {
      if (!live) return;
      if (detailResult.status === 'fulfilled') setDetail(detailResult.value);
      else {
        setDetail(null);
        setLoadError(detailResult.reason?.message || 'The selected incident details could not be loaded.');
      }
      if (journeyResult.status === 'fulfilled') setJourney(journeyResult.value);
      else setJourneyError(true);
      setJourneyLoading(false);
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
    setJourney(null);
    setJourneyError(false);
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
        lastRefreshed={lastRefreshed}
      />
    );
  }

  if (!detail || !model) {
    return (
      <div className="incident-command incident-detail-v2 ui-page-enter">
        <nav className="incident-command-nav-v2" aria-label="Incident navigation"><Button icon={ArrowLeft} onClick={returnToQueue}>All incidents</Button><code>{incidentReference(requestedIncident)}</code><Button icon={RefreshCw} iconOnly aria-label="Refresh incident" onClick={load} disabled={loading} className={loading ? 'is-loading' : ''} /></nav>
        {loadError
          ? <div className="incidents-error" role="alert"><ShieldAlert size={16} strokeWidth={1.5} /><span>{loadError}</span><button type="button" onClick={load}>Retry</button></div>
          : <section className="incident-detail-loading" role="status"><SkeletonLoader lines={7} /></section>}
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
    <div className="incident-command incident-detail-v2 ui-page-enter">
      <nav className="incident-command-nav-v2" aria-label="Incident navigation"><Button icon={ArrowLeft} onClick={returnToQueue}>All incidents</Button><div><code>{incidentReference(detail.id)}</code><span>{workspace === 'cases' ? 'Case-linked incident' : 'Incident command workspace'}</span></div><Button icon={RefreshCw} iconOnly aria-label="Refresh incident" onClick={load} disabled={loading} className={loading ? 'is-loading' : ''} /></nav>

      <section className="incident-hero incident-hero-v2">
        <div className="incident-title-v2"><div><SeverityBadge severity={detail.severity || 'medium'} /><StatusChip status={detail.status === 'closed' ? 'resolved' : detail.status === 'false_positive' ? 'neutral' : 'active'}>{humanize(detail.status || 'open')}</StatusChip></div><h2>{detail.title || 'Untitled security incident'}</h2><p>Detected {fmtTs(detail.first_seen)} · Last updated {fmtTs(detail.last_seen)}</p></div>
        <dl className="incident-hero-facts"><div><dt>Risk indicator <InfoTip text="Derived from stored severity and correlated alert volume; not a persisted enterprise risk score." /></dt><dd>{model.score}<small>/100</small></dd></div><div><dt>Correlated alerts</dt><dd>{alertCount}</dd><small>{highCount} high · {mediumCount} medium</small></div><div><dt>Owner</dt><dd>{detail.owner || 'Unassigned'}</dd><small>{relativeTime(detail.first_seen || detail.created_at)}</small></div></dl>
        <div className="incident-controls-v2">{readOnly ? <StatusChip>Executive review · controls hidden</StatusChip> : <><Select label="Status" value={detail.status || 'open'} onChange={event => updateStatus(event.target.value)} disabled={updating}><option value="open">In progress</option><option value="closed">Closed</option><option value="false_positive">False positive</option></Select><Button icon={CircleUserRound} onClick={assignIncident} disabled={updating}>{detail.owner || 'Assign owner'}</Button><Button icon={LockKeyhole} onClick={() => updateStatus('closed')} disabled={updating}>Close incident record</Button></>}<Button as="a" icon={Download} href={`/api/reports/incidents/${detail.id}`} target="_blank" rel="noreferrer">Generate report</Button></div>
      </section>

      <section className="incident-command-summary" aria-label="Incident command summary">
        <article><span>What happened</span><strong>{detail.title || 'Correlated security activity'}</strong><small>{model.stages.length ? `${model.stages.length} ATT&CK stages are represented in stored evidence.` : 'No ATT&CK stage mapping is available.'}</small></article>
        <article><span>Business impact</span><strong>{detail.severity ? `${humanize(detail.severity)} impact potential` : 'Not assessed'}</strong><small>This incident-level impact remains severity-based; mapped service exposure is calculated in the executive overview.</small></article>
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

      <IncidentCorrelationTrace
        incident={detail}
        alerts={model.alerts}
        journey={journey}
        loading={journeyLoading}
        error={journeyError}
      />
      {!readOnly && (
        <AnalystDecisionReview
          entityType="incident"
          entityId={detail.id}
          reviews={journey?.analyst_reviews || []}
          onRecorded={review => setJourney(current => ({
            ...(current || {}),
            analyst_reviews:[review, ...(current?.analyst_reviews || [])],
          }))}
        />
      )}

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
