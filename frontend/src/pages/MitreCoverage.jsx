import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Ban, Bot, CheckCircle2, GitBranch, LayoutGrid,
  RefreshCw, ShieldCheck, ShieldOff, UserX,
} from 'lucide-react';
import { api, fmtTs, verdictLabel } from '../lib/api';
import { humanize } from '../lib/executive';
import '../styles/mitre-coverage.css';
import {
  Button, Card, EmptyState, SegmentedControl, Select, SeverityBadge,
  SkeletonLoader, StatusChip, Timeline,
} from '../components/ui';

const VIEWS = [
  { value:'incident', label:'Incident View' },
  { value:'coverage', label:'Coverage View' },
];

const RANGES = [
  { value:'30', label:'30d' },
  { value:'90', label:'90d' },
  { value:'all', label:'All time' },
];

function elapsed(firstSeen, lastSeen) {
  const start = new Date(firstSeen).getTime();
  const end = new Date(lastSeen || Date.now()).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Unknown';
  const days = Math.max(0, Math.floor((end - start) / 86400000));
  if (days > 0) return `${days}d`;
  const hours = Math.max(1, Math.floor((end - start) / 3600000));
  return `${hours}h`;
}

function clock(timestamp) {
  if (!timestamp) return 'Time unavailable';
  return new Date(timestamp).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
}

function incidentOption(item) {
  return `${item.reference} · ${item.name} · ${humanize(item.severity)} · ${item.alertCount} alerts`;
}

function mappingEntries(incident, tactics) {
  const order = new Map(tactics.map((tactic, index) => [tactic.id, index]));
  return (incident?.alerts || []).flatMap(alert => alert.mappings.map(mapping => ({ alert, mapping })))
    .sort((left, right) => {
      const timestamp = new Date(left.alert.timestamp).getTime() - new Date(right.alert.timestamp).getTime();
      return timestamp || (order.get(left.mapping.tacticId) ?? 99) - (order.get(right.mapping.tacticId) ?? 99);
    });
}

function AttackMatrix({ incident, tactics, selectedAlertId, onSelectAlert }) {
  const entries = useMemo(() => mappingEntries(incident, tactics), [incident, tactics]);
  const byTactic = useMemo(() => {
    const grouped = new Map(tactics.map(tactic => [tactic.id, []]));
    entries.forEach(entry => grouped.get(entry.mapping.tacticId)?.push(entry));
    return grouped;
  }, [entries, tactics]);
  const rows = Math.max(1, ...[...byTactic.values()].map(items => items.length));
  const canvasHeight = 64 + (rows * 84);
  const width = tactics.length * 120;
  const containedIndex = entries.reduce((result, entry) => {
    if (entry.alert.state !== 'contained') return result;
    return Math.max(result, tactics.findIndex(tactic => tactic.id === entry.mapping.tacticId));
  }, -1);
  const coordinates = entries.map(entry => {
    const tacticIndex = tactics.findIndex(tactic => tactic.id === entry.mapping.tacticId);
    const rowIndex = byTactic.get(entry.mapping.tacticId).findIndex(item => item.alert.id === entry.alert.id);
    return { ...entry, x:(tacticIndex * 120) + 60, y:64 + (rowIndex * 84) + 34 };
  });

  return (
    <Card
      className="mitre-matrix-card"
      title="ATT&CK incident path"
      caption="Stored alerts mapped to tactics in chronological order"
      action={<span className="mitre-matrix-key"><i className="active" />Active <i className="confirmed" />Confirmed <i className="contained" />Contained</span>}
    >
      <div className="mitre-matrix-scroll" tabIndex="0" aria-label="Horizontally scrollable ATT&CK incident matrix">
        <div className="mitre-matrix-canvas" style={{ width, minHeight:canvasHeight }}>
          {coordinates.length > 1 && (
            <svg className="mitre-attack-path" viewBox={`0 0 ${width} ${canvasHeight}`} preserveAspectRatio="none" aria-hidden="true">
              <defs>
                {coordinates.slice(1).map((point, index) => point.alert.state === 'contained' && (
                  <linearGradient
                    key={`gradient-${index}`}
                    id={`mitre-contained-${index}`}
                    gradientUnits="userSpaceOnUse"
                    x1={coordinates[index].x}
                    y1={coordinates[index].y}
                    x2={point.x}
                    y2={point.y}
                  >
                    <stop offset="0%" stopColor="var(--severity-critical)" />
                    <stop offset="80%" stopColor="var(--severity-critical)" />
                    <stop offset="100%" stopColor="var(--success)" />
                  </linearGradient>
                ))}
              </defs>
              {coordinates.slice(1).map((point, index) => {
                const previous = coordinates[index];
                return (
                  <line
                    key={`${previous.alert.id}-${point.alert.id}-${index}`}
                    x1={previous.x}
                    y1={previous.y}
                    x2={point.x}
                    y2={point.y}
                    className={point.alert.state === 'contained' ? 'is-contained' : 'is-threat'}
                    style={{ '--path-index':index, stroke:point.alert.state === 'contained' ? `url(#mitre-contained-${index})` : undefined }}
                  />
                );
              })}
            </svg>
          )}
          <div className="mitre-matrix-grid" style={{ gridTemplateColumns:`repeat(${tactics.length}, 120px)` }}>
            {tactics.map((tactic, tacticIndex) => {
              const items = byTactic.get(tactic.id) || [];
              const notReached = containedIndex >= 0 && tacticIndex > containedIndex && items.length === 0;
              return (
                <section key={tactic.id} className={`mitre-tactic-column ${items.length ? 'is-touched' : ''} ${notReached ? 'is-not-reached' : ''}`}>
                  <header><strong>{tactic.name}</strong><code>{tactic.id}</code></header>
                  <div className="mitre-tactic-alerts">
                    {items.map(({ alert, mapping }) => {
                      const technique = mapping.techniques[0] || { id:'Mapped', name:alert.name };
                      return (
                        <button
                          type="button"
                          key={`${alert.id}-${mapping.tacticId}`}
                          className={`mitre-alert-chip is-${alert.state} ${selectedAlertId === alert.id ? 'is-selected' : ''}`}
                          onClick={() => onSelectAlert(alert.id)}
                          aria-label={`${technique.name}, ${humanize(alert.state)}, ${clock(alert.timestamp)}`}
                        >
                          <GitBranch aria-hidden="true" />
                          <span><strong>{technique.name}</strong><code>{technique.id}</code><time>{clock(alert.timestamp)}</time></span>
                          {alert.state === 'contained' && <CheckCircle2 className="mitre-contained-mark" aria-hidden="true" />}
                        </button>
                      );
                    })}
                    {notReached && <em>Not reached</em>}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

function DecisionEvidence({ alert }) {
  const trace = alert.decisionTrace || {};
  const inputs = Object.entries(trace.inputSummary || {});
  const outputs = Object.entries(trace.outputSummary || {});
  return (
    <div className="mitre-decision-evidence">
      {trace.reason && <p>{trace.reason}</p>}
      <dl>
        <div><dt>Model</dt><dd>{trace.model || 'Not recorded'}</dd></div>
        <div><dt>Confidence</dt><dd>{alert.confidence == null ? 'Not supplied' : `${Math.round(alert.confidence * 100)}%`}</dd></div>
        <div><dt>Inputs</dt><dd>{inputs.length || 'Not recorded'}</dd></div>
        <div><dt>Outputs</dt><dd>{outputs.length || 'Not recorded'}</dd></div>
      </dl>
      {trace.limitations?.length > 0 && <div><strong>Recorded limitations</strong><ul>{trace.limitations.slice(0, 3).map(item => <li key={item}>{item}</li>)}</ul></div>}
    </div>
  );
}

function AlertTimeline({ incident, selectedAlertId }) {
  const items = (incident.alerts || []).map(alert => {
    const technique = alert.mappings.flatMap(mapping => mapping.techniques)[0];
    const verdict = verdictLabel(alert.aiVerdict);
    const verdictTone = alert.state === 'contained'
      ? 'resolved'
      : alert.aiVerdict === 'true_positive'
        ? 'error'
        : alert.aiVerdict === 'false_positive' || alert.aiVerdict === 'benign_anomaly'
          ? 'resolved'
          : 'attention';
    return {
      id:alert.id,
      domId:`mitre-alert-${encodeURIComponent(alert.id)}`,
      className:selectedAlertId === alert.id ? 'is-selected' : '',
      timestamp:fmtTs(alert.timestamp),
      dateTime:alert.timestamp,
      title:alert.name,
      detail:[alert.entity, alert.source].filter(Boolean).join(' · '),
      meta:<span className="mitre-timeline-tags">
        {technique?.id && <code>{technique.id}</code>}
        <SeverityBadge severity={alert.severity} />
        <StatusChip status={verdictTone}>{verdict}</StatusChip>
      </span>,
      severity:alert.state === 'contained' ? undefined : alert.severity,
      tone:alert.state === 'contained' ? 'success' : undefined,
      icon:alert.state === 'contained' ? <CheckCircle2 /> : <Bot />,
      expandedLabel:'Inspect AI decision evidence',
      expandedContent:<DecisionEvidence alert={alert} />,
    };
  });
  return (
    <Card title="Alert detail timeline" caption={`${items.length} incident alert${items.length === 1 ? '' : 's'} in chronological order`} className="mitre-timeline-card">
      <Timeline items={items} ariaLabel="Incident alert detail timeline" className="mitre-alert-timeline" />
    </Card>
  );
}

function availableActions(incident) {
  const alerts = incident?.alerts || [];
  const first = predicate => alerts.find(predicate);
  const endpoint = first(alert => alert.hostname);
  const identity = first(alert => alert.username);
  const address = first(alert => alert.srcIp);
  return [
    endpoint && { id:'endpoint', type:'endpoint_isolate', target:endpoint.hostname, label:'Simulate endpoint isolation', description:`Rehearse isolation of ${endpoint.hostname}.`, icon:ShieldOff },
    identity && { id:'identity', type:'identity_suspend', target:identity.username, label:'Simulate credential suspension', description:`Rehearse suspension of ${identity.username}.`, icon:UserX },
    address && { id:'address', type:'ip_block', target:address.srcIp, label:'Simulate source IP block', description:`Rehearse blocking ${address.srcIp}.`, icon:Ban },
  ].filter(Boolean);
}

function ResponseActions({ incident, simulations, onSimulationRecorded }) {
  const [confirming, setConfirming] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const actions = availableActions(incident);

  async function submit(action) {
    setSaving(true);
    setError('');
    try {
      const result = await api('/actions', {
        method:'POST',
        body:JSON.stringify({
          action_type:'response.simulate',
          target_id:action.target,
          parameters:{ response_type:action.type, evidence_alert_ids:incident.alerts.map(alert => alert.id) },
          reason:`MITRE Coverage rehearsal requested for ${incident.reference}.`,
          idempotency_key:`mitre:${incident.id}:${action.type}:${action.target}`,
        }),
      });
      onSimulationRecorded({
        id:result.action_request?.id,
        response_type:action.type,
        target_value:action.target,
        state:result.action_request?.status || 'pending',
        simulationOnly:true,
      });
      setConfirming(null);
    } catch (requestError) {
      setError(requestError.message || 'The response rehearsal could not be requested.');
    } finally {
      setSaving(false);
    }
  }

  if (incident.status !== 'open') {
    const contained = incident.alerts.filter(alert => alert.state === 'contained').length;
    return <Card title="Response Actions" className="mitre-response-card"><p className="mitre-resolved-summary"><ShieldCheck />Resolved record · {contained} of {incident.alertCount} alerts were source-observed as blocked or contained.</p></Card>;
  }

  return (
    <Card title="Response Actions" caption="Approval-gated rehearsals; no external system is modified" className="mitre-response-card">
      {error && <p className="mitre-action-error" role="alert">{error}</p>}
      {actions.length ? <div className="mitre-action-list">{actions.map(action => {
        const Icon = action.icon;
        return (
          <article key={action.id}>
            <div><Icon aria-hidden="true" /><span><strong>{action.label}</strong><small>{action.description}</small></span></div>
            {confirming === action.id ? (
              <div className="mitre-action-confirm">
                <p>Record this simulation-only request for <strong>{action.target}</strong>?</p>
                <span><Button variant="primary" onClick={() => submit(action)} disabled={saving}>{saving ? 'Requesting…' : 'Confirm request'}</Button><Button onClick={() => setConfirming(null)} disabled={saving}>Cancel</Button></span>
              </div>
            ) : <Button onClick={() => setConfirming(action.id)}>Review</Button>}
          </article>
        );
      })}</div> : <EmptyState icon={ShieldOff} message="No supported response target was observed" />}
      {simulations.length > 0 && (
        <div className="mitre-actions-taken"><h3>Recorded rehearsals</h3>{simulations.slice(0, 5).map(item => <p key={item.id || `${item.response_type}-${item.target_value}`}><CheckCircle2 /><span><strong>{humanize(item.response_type)}</strong><small>{item.target_value} · {humanize(item.state)}</small></span></p>)}</div>
      )}
    </Card>
  );
}

function IncidentView({ directory, selectedId, onSelect, detail, loading, error, onReload }) {
  const [selectedAlertId, setSelectedAlertId] = useState('');
  const incident = detail?.incident;
  const tactics = detail?.tactics || [];
  const [simulations, setSimulations] = useState([]);

  useEffect(() => {
    setSelectedAlertId('');
    setSimulations(detail?.response_simulations || []);
  }, [detail]);

  function selectAlert(id) {
    setSelectedAlertId(id);
    window.requestAnimationFrame(() => document.getElementById(`mitre-alert-${encodeURIComponent(id)}`)?.scrollIntoView({ behavior:'smooth', block:'center' }));
  }

  return (
    <>
      <div className="mitre-view-toolbar">
        <Select label="Incident" value={selectedId} onChange={event => onSelect(event.target.value)} disabled={!directory.length}>
          {!directory.length && <option value="">No mapped incidents</option>}
          {directory.map(item => <option key={item.id} value={item.id}>{incidentOption(item)}</option>)}
        </Select>
        <Button icon={RefreshCw} iconOnly aria-label="Refresh MITRE incident" onClick={onReload} disabled={loading} />
      </div>
      {loading && !incident && <Card><SkeletonLoader lines={7} /></Card>}
      {error && <Card><EmptyState icon={AlertTriangle} message={error} action="Retry after checking the API" /></Card>}
      {!loading && !error && !incident && <Card><EmptyState icon={LayoutGrid} message="No incidents contain ATT&CK-mapped alerts" /></Card>}
      {incident && (
        <div className="mitre-incident-view ui-page-enter">
          <Card compact className="mitre-incident-summary" aria-label="Selected incident summary">
            <div className="mitre-incident-name"><strong>{incident.name}</strong><SeverityBadge severity={incident.severity} /></div>
            <dl><div><dt>Alerts</dt><dd>{incident.alertCount}</dd></div><div><dt>Stages touched</dt><dd>{incident.stageCount}</dd></div><div><dt>Active</dt><dd>{elapsed(incident.firstSeen, incident.lastSeen)}</dd></div><div><dt>Status</dt><dd>{humanize(incident.status)}</dd></div></dl>
          </Card>
          <AttackMatrix incident={incident} tactics={tactics} selectedAlertId={selectedAlertId} onSelectAlert={selectAlert} />
          <div className="mitre-incident-lower">
            <AlertTimeline incident={incident} selectedAlertId={selectedAlertId} />
            <ResponseActions incident={incident} simulations={simulations} onSimulationRecorded={item => setSimulations(current => [item, ...current])} />
          </div>
        </div>
      )}
    </>
  );
}

function CoverageView({ range, onRange, data, loading, error, onReload }) {
  return (
    <div className="mitre-coverage-view ui-page-enter">
      <div className="mitre-view-toolbar is-coverage">
        <SegmentedControl value={range} options={RANGES} onChange={onRange} label="Coverage time range" />
        <Button icon={RefreshCw} iconOnly aria-label="Refresh MITRE coverage" onClick={onReload} disabled={loading} />
      </div>
      {loading && !data && <Card><SkeletonLoader lines={6} /></Card>}
      {error && <Card><EmptyState icon={AlertTriangle} message={error} action="Retry after checking the API" /></Card>}
      {data && (
        <>
          <Card title="Detection coverage by ATT&CK tactic" caption="Distinct alerts linked to stored incidents">
            <div className="mitre-heatmap-scroll" tabIndex="0" aria-label="Horizontally scrollable ATT&CK coverage heatmap">
              <div className="mitre-heatmap" style={{ gridTemplateColumns:`repeat(${data.tactics.length}, minmax(112px, 1fr))` }}>
                {data.tactics.map(tactic => {
                  const level = tactic.totalAlertCount === 0 ? 0 : tactic.totalAlertCount <= 3 ? 1 : tactic.totalAlertCount <= 10 ? 2 : 3;
                  return (
                    <section key={tactic.id} className={`mitre-coverage-column level-${level}`}>
                      <header><strong>{tactic.name}</strong><code>{tactic.id}</code></header>
                      <div
                        className="mitre-coverage-cell"
                        title={level === 0 ? `No detections recorded for this tactic — consider reviewing coverage for ${tactic.name}` : `${tactic.detectionCount} distinct detections`}
                      >
                        {level === 0 && <AlertTriangle aria-hidden="true" />}
                        <strong>{tactic.totalAlertCount}</strong>
                        <span>{tactic.incidentCount} incident{tactic.incidentCount === 1 ? '' : 's'} involved</span>
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </Card>
          <Card compact title="Coverage Summary" className="mitre-coverage-summary"><p>{data.summary}</p><small>Coverage reflects recorded incident evidence, not every control configured in the environment.</small></Card>
        </>
      )}
    </div>
  );
}

export default function MitreCoverage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'coverage' ? 'coverage' : 'incident';
  const selectedId = searchParams.get('incident') || '';
  const [directory, setDirectory] = useState([]);
  const [detail, setDetail] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [range, setRange] = useState('90');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef(0);

  function changeView(nextView) {
    const next = new URLSearchParams(searchParams);
    if (nextView === 'coverage') next.set('view', 'coverage');
    else next.delete('view');
    setSearchParams(next, { replace:true });
  }

  function selectIncident(id) {
    const next = new URLSearchParams(searchParams);
    next.set('incident', String(id));
    next.delete('view');
    setSearchParams(next, { replace:true });
  }

  async function loadDirectory() {
    const data = await api('/mitre/incidents?limit=100');
    const rows = data.incidents || [];
    setDirectory(rows);
    if (rows.length && !rows.some(item => String(item.id) === String(selectedId))) selectIncident(rows[0].id);
  }

  async function loadIncident() {
    if (!selectedId) { setDetail(null); return; }
    const request = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const data = await api(`/mitre/incidents/${encodeURIComponent(selectedId)}`);
      if (request === requestRef.current) setDetail(data);
    } catch (loadError) {
      if (request === requestRef.current) setError(loadError.message || 'The selected incident could not be loaded.');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }

  async function loadCoverage() {
    const request = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const data = await api(`/mitre/coverage?range=${range}`);
      if (request === requestRef.current) setCoverage(data);
    } catch (loadError) {
      if (request === requestRef.current) setError(loadError.message || 'MITRE coverage could not be loaded.');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    loadDirectory().catch(loadError => { setError(loadError.message || 'Mapped incidents could not be loaded.'); setLoading(false); });
  }, []);
  useEffect(() => { if (view === 'incident') loadIncident(); }, [selectedId, view]);
  useEffect(() => { if (view === 'coverage') loadCoverage(); }, [range, view]);

  return (
    <div className="mitre-coverage-page">
      <div className="mitre-page-controls">
        <SegmentedControl value={view} options={VIEWS} onChange={changeView} label="MITRE Coverage view" />
        <span><ShieldCheck />Observed evidence only</span>
      </div>
      {view === 'incident'
        ? <IncidentView directory={directory} selectedId={selectedId} onSelect={selectIncident} detail={detail} loading={loading} error={error} onReload={loadIncident} />
        : <CoverageView range={range} onRange={setRange} data={coverage} loading={loading} error={error} onReload={loadCoverage} />}
    </div>
  );
}
