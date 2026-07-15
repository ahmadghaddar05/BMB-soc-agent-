import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Bot, Check, ChevronDown, CircleUserRound, Clock3, Download,
  FileText, Fingerprint, Link2, LockKeyhole, Monitor, Network, RefreshCw,
  Server, Shield, ShieldAlert, ShieldCheck, Sparkles, Target, UserRound, Users, X,
} from 'lucide-react';
import { api, fmtTs, sevClass } from '../lib/api';
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

export default function Incidents({ workspace = 'incidents' }) {
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
  const [owners, setOwners] = useState(() => { try { return JSON.parse(localStorage.getItem('bmb-incident-owners')) || {}; } catch { return {}; } });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api(`/incidents?status=${status}&page=1&limit=50`);
      const rows = data.incidents || [];
      setIncidents(rows);
      setTotal(data.total || 0);
      setSelectedId(current => rows.some(item => String(item.id) === String(current)) ? current : rows[0]?.id || null);
    } catch {
      setIncidents([]); setTotal(0); setSelectedId(null);
    } finally { setLoading(false); }
  }, [status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let live = true;
    api(`/incidents/${selectedId}`).then(data => { if (live) setDetail(data); }).catch(() => { if (live) setDetail(incidents.find(item => String(item.id) === String(selectedId)) || null); });
    return () => { live = false; };
  }, [selectedId, incidents]);

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

  function assignIncident() {
    if (!detail?.id) return;
    const next = { ...owners, [detail.id]: owners[detail.id] ? '' : 'Analyst' };
    setOwners(next); localStorage.setItem('bmb-incident-owners', JSON.stringify(next));
  }

  function toggleContainment(index) {
    const key = String(detail.id); const current = completedActions[key] || [];
    setCompletedActions({ ...completedActions, [key]: current.includes(index) ? current.filter(value => value !== index) : [...current,index] });
  }

  if (!detail || !model) {
    return <div className="incident-command"><div className="incident-list-toolbar"><div><h2>{workspace === 'cases' ? 'Case Workspace' : 'Incident Command'}</h2><span>{total} {status}</span></div><div><select value={status} onChange={event => setStatus(event.target.value)}><option value="open">Open</option><option value="closed">Closed</option><option value="false_positive">False positive</option></select><button onClick={load}><RefreshCw className={loading ? 'animate-spin' : ''} /></button></div></div><IncidentEmpty /></div>;
  }

  const alertCount = model.alerts.length || detail.alert_ids?.length || 0;
  const highCount = model.alerts.filter(item => Number(item.rule_level) >= 9).length;
  const mediumCount = model.alerts.filter(item => Number(item.rule_level) >= 6 && Number(item.rule_level) < 9).length;

  return (
    <div className="incident-command">
      <div className="incident-list-toolbar">
        <div><span className="incident-breadcrumb">Incidents <b>›</b> INC-{String(detail.id).padStart(5, '0')}</span><h2>{workspace === 'cases' ? 'Case Workspace' : 'Incident Command'}</h2></div>
        <div><select value={selectedId || ''} onChange={event => setSelectedId(event.target.value)}>{incidents.map(item => <option key={item.id} value={item.id}>{item.title || `Incident ${item.id}`}</option>)}</select><select value={status} onChange={event => setStatus(event.target.value)}><option value="open">Open incidents</option><option value="closed">Closed incidents</option><option value="false_positive">False positives</option></select><button onClick={load} aria-label="Refresh"><RefreshCw className={loading ? 'animate-spin' : ''} /></button></div>
      </div>

      <section className="incident-hero">
        <div className={`incident-severity-icon ${detail.severity || 'medium'}`}><span>{detail.severity || 'medium'}</span><Shield /></div>
        <div className="incident-title"><h1>{detail.title || 'Untitled security incident'}</h1><p>INC-{String(detail.id).padStart(5, '0')} <i /> Detected {fmtTs(detail.first_seen)} <i /> Last updated {fmtTs(detail.last_seen)}</p></div>
        <div className="incident-score"><span>Incident Risk Score <InfoTip text="Calculated from incident severity, alert volume, and correlated activity." /></span><div><strong>{model.score}</strong><small>/100</small></div></div>
        <div className="incident-alert-count"><span>Correlated Alerts</span><strong>{alertCount}</strong><small><b>{highCount} High</b> · {mediumCount} Medium</small></div>
        <div className="incident-controls"><label>Status<select value={detail.status || 'open'} onChange={event => updateStatus(event.target.value)} disabled={updating}><option value="open">In progress</option><option value="closed">Closed</option><option value="false_positive">False positive</option></select></label><div><button className={owners[detail.id] ? 'assigned' : ''} onClick={assignIncident}><CircleUserRound />{owners[detail.id] || 'Assign locally'}</button><button className="contain" onClick={() => updateStatus('closed')} disabled={updating}><LockKeyhole />Close incident record</button><a href={`/api/reports/incidents/${detail.id}`} target="_blank" rel="noreferrer"><Download />Generate report</a></div></div>
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
                const stage = alert.mitre_tactics?.[0] || model.stages[index % Math.max(1, model.stages.length)] || 'unknown'; const Icon = stageIcon(stage);
                return <article key={alert.id || index} className={Number(alert.rule_level) >= 12 ? 'critical' : index > 2 ? 'elevated' : ''}><time>{compactTime(alert.timestamp)}</time><span className="attack-node"><Icon /></span><strong>{alert.rule_desc || 'Correlated activity'}</strong><small>{alert.username || alert.hostname || alert.src_ip || TACTIC_LABELS[stage]}</small><em>{alert.mitre_techniques?.[0] || TACTIC_LABELS[stage]}</em></article>;
              })}
            </div>
          </section>

          <div className="incident-lower-grid">
            <section className="incident-panel evidence-panel"><div className="incident-panel-title"><h2>Key Evidence</h2><button onClick={() => setShowAllEvidence(value => !value)}>{showAllEvidence ? 'Show key evidence' : 'View all evidence ↗'}</button></div><div className="incident-evidence-table"><div className="evidence-head"><span>Time</span><span>Event</span><span>Source</span><span>Details</span><span>Severity</span></div>{model.alerts.slice(0,showAllEvidence ? model.alerts.length : 7).map((alert,index)=><article key={alert.id || index}><time>{fmtTs(alert.timestamp)}</time><strong>{alert.rule_desc || 'Security event'}</strong><span>{alert.agent_name || alert.decoder || 'Elastic'}</span><p>{[alert.src_ip, alert.username, alert.hostname].filter(Boolean).join(' → ') || 'Normalized event evidence'}</p><em className={Number(alert.rule_level) >= 12 ? 'critical' : Number(alert.rule_level) >= 9 ? 'high' : 'medium'}>{Number(alert.rule_level) >= 12 ? 'Critical' : Number(alert.rule_level) >= 9 ? 'High' : 'Medium'}</em></article>)}</div></section>

            <section className="incident-panel containment-panel"><div className="incident-panel-title"><h2>Recommended Containment</h2><span>{(completedActions[String(detail.id)] || []).length} acknowledged</span></div><div className="module-notice"><ShieldAlert />Planning only — these controls record local review and do not execute containment.</div><div className="containment-list">{(detail.recommended_actions || ['Disable the affected account','Isolate affected hosts','Revoke active sessions','Reset credentials']).slice(0,5).map((action,index)=>{ const done=(completedActions[String(detail.id)] || []).includes(index); return <article key={index} className={done ? 'complete' : ''}><span>{done ? <Check /> : index === 0 ? <UserRound /> : index === 1 ? <Monitor /> : <LockKeyhole />}</span><div><strong>{action}</strong><small>{done ? 'Acknowledged in this analyst session; no action was executed' : 'Review recommendation before using an approved response system'}</small></div><button onClick={() => toggleContainment(index)}>{done ? 'Undo review' : 'Acknowledge'}</button></article>;})}</div></section>
          </div>
        </main>

        <aside className="incident-side-column">
          <section className="incident-panel live-activity-panel"><div className="incident-panel-title"><h2>Live Activity</h2><span><i />Live</span></div><div>{model.alerts.slice(-7).reverse().map((alert,index)=><article key={alert.id || index}><i className={Number(alert.rule_level) >= 12 ? 'critical' : Number(alert.rule_level) >= 9 ? 'high' : ''} /><time>{compactTime(alert.timestamp)}</time><p>{alert.rule_desc || 'Correlated activity'}<small>{alert.hostname || alert.username || alert.src_ip || 'Elastic'}</small></p><em>{Number(alert.rule_level) >= 12 ? 'Critical' : Number(alert.rule_level) >= 9 ? 'High' : 'Medium'}</em></article>)}</div></section>
          <section className="incident-panel incident-ai"><div className="incident-panel-title"><h2>BMB AI Assistant</h2><span className="beta">Beta</span></div><div className="ai-summary"><Bot /><p><strong>Here’s what I found so far.</strong>{detail.narrative || 'This incident contains correlated security activity. Review the attack path and containment actions before changing its status.'}</p></div><button onClick={() => window.dispatchEvent(new CustomEvent('open-soc-assistant'))}>Explain attack path</button></section>
        </aside>
      </div>
    </div>
  );
}
