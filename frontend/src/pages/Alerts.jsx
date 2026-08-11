import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Check, Clock3, Copy, Filter, Maximize2,
  Monitor, Network, Pin, PlayCircle, RefreshCw, Save,
  Shield, ShieldAlert, ShieldCheck, Sparkles, User, X,
} from 'lucide-react';
import { api, fmtTs, verdictLabel } from '../lib/api';
import { createInitialAlertView, normalizeCitations, normalizeTextList, writeBrowserAlertView } from '../lib/analyst';
import { activityTitle, alertReference, severityOf } from '../lib/executive';
import { TriageDecisionSummary, TriageWorkflow } from '../components/TriageDecisionTrace';
import AnalystDecisionReview from '../components/AnalystDecisionReview';
import DecisionQualityPanel from '../components/DecisionQualityPanel';
import {
  Button, ConfidenceGauge, EmptyState, SegmentedControl, Select,
  SeverityBadge, SkeletonLoader, StatusChip, UnderlineTabs,
} from '../components/ui';

function json(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function sourceSeverity(alert) {
  return severityOf(alert);
}

function shortId(alert) {
  return alertReference(alert);
}

function entity(alert) {
  return alert?.username || alert?.hostname || alert?.src_ip || 'Unknown entity';
}

function sourceLabel(alert) {
  const source = alert?.event_dataset || alert?.decoder || alert?.agent_name || 'Elastic';
  return String(source).split('.')[0];
}

function timeOnly(timestamp) {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
}

function readableRuleReference(id) {
  if (!id) return 'No technical ID';
  const value = String(id);
  return /^\d+$/.test(value) ? `Rule ${value}` : `Rule ${value.slice(0, 8).toUpperCase()}`;
}

function StructuredEvent({ alert }) {
  const raw = json(alert.full_log) || json(alert.raw) || {};
  const event = raw.event || {};
  const ecs = raw.ecs || {};
  const source = raw.source || {};
  const destination = raw.destination || {};
  const user = raw.user || {};
  const host = raw.host || {};
  const process = raw.process || {};
  const rule = raw.rule || {};
  const kibanaRule = raw.kibana?.alert?.rule || {};
  const timestamp = raw['@timestamp'] || alert.timestamp;
  const ruleId = alert.rule_id || rule.id || kibanaRule.uuid || kibanaRule.rule_id || '';
  const ruleName = rule.name || kibanaRule.name || alert.rule_desc || 'Detection rule';
  const summary = [event.category, event.type, event.action].flat().filter(Boolean).join(' · ') || alert.rule_desc || 'Security event';
  const facts = [
    ['Event action', event.action || 'Not provided'],
    ['Outcome', event.outcome || 'Unknown'],
    ['Dataset', event.dataset || alert.event_dataset || 'Elastic'],
    ['ECS version', ecs.version || '—'],
    ['Detection rule', ruleName],
    ['Rule level', alert.rule_level ?? rule.level ?? '—'],
  ];
  const entities = [
    ['User', alert.username || user.name || user.email || 'Not identified'],
    ['Host', alert.hostname || alert.agent_name || host.hostname || host.name || 'Not identified'],
    ['Source IP', alert.src_ip || source.ip || 'Not identified'],
    ['Destination IP', alert.dst_ip || destination.ip || 'Not identified'],
    ['Process', alert.process || process.name || process.executable || 'Not identified'],
    ['Target', alert.target_db || destination.domain || raw.url?.domain || 'Not identified'],
  ];
  const rawText = Object.keys(raw).length ? JSON.stringify(raw, null, 2) : String(alert.full_log || 'No raw payload is available.');

  return <div className="structured-event">
    <div className="structured-event-hero"><span><Shield /></span><div><small>Stored alert evidence · normalized view</small><h3>{activityTitle(alert)}</h3><p>{summary}</p></div><time><Clock3 />{fmtTs(timestamp)}</time></div>
    <div className="event-entity-grid"><article><User /><span>User</span><strong>{entities[0][1]}</strong></article><article><Monitor /><span>Host</span><strong>{entities[1][1]}</strong></article><article><Network /><span>Source</span><strong>{entities[2][1]}</strong></article><article><Network /><span>Destination</span><strong>{entities[3][1]}</strong></article></div>
    <div className="event-detail-grid"><section><h4>Detection details</h4><dl>{facts.map(([label,value]) => <div key={label}><dt>{label}</dt><dd title={String(value)}>{String(value)}</dd></div>)}</dl>{ruleId && <div className="rule-reference"><div><small>Technical rule reference</small><strong>{readableRuleReference(ruleId)}</strong></div><details><summary>Show full ID</summary><code>{ruleId}</code><button type="button" onClick={() => navigator.clipboard?.writeText(String(ruleId))} title="Copy full rule ID"><Copy />Copy ID</button></details></div>}</section><section><h4>Entity context</h4><dl>{entities.map(([label,value]) => <div key={label}><dt>{label}</dt><dd title={String(value)}>{String(value)}</dd></div>)}</dl></section></div>
    <details className="raw-event-disclosure"><summary>View raw event JSON</summary><pre className="raw-event">{rawText}</pre></details>
  </div>;
}

function AlertDetail({ alert, journey, journeyLoading, journeyError, onJourneyChange, onClose, onRetriage, onInvestigate, onPin, onExpand, busy, pinned, expanded }) {
  const [tab, setTab] = useState('overview');
  const [completedActions, setCompletedActions] = useState([]);
  const [reviewSignal, setReviewSignal] = useState(0);

  if (!alert) return <aside className="triage-detail-panel triage-detail-empty"><EmptyState icon={ShieldCheck} message="Select an alert to inspect its evidence" /></aside>;

  const verdict = json(alert.verdict);
  const enrichment = json(alert.enrichment) || {};
  const severity = sourceSeverity(alert);
  const confidence = verdict?.confidence != null ? Math.round(verdict.confidence * 100) : null;
  const aiFindings = normalizeTextList(verdict?.key_findings);
  const observedFindings = [
    alert.process && `Process observed: ${alert.process}`,
    alert.src_ip && `Source activity from ${alert.src_ip}`,
    alert.username && `Identity involved: ${alert.username}`,
  ].filter(Boolean);
  const findings = aiFindings.length ? aiFindings : observedFindings;
  const aiActions = normalizeTextList(verdict?.recommended_actions);
  const actions = aiActions.length ? aiActions : ['Review the raw event and enrichment context', 'Validate the affected identity and host', 'Escalate if corroborating activity is present'];
  const citations = normalizeCitations(verdict?.citations);
  const threatIntel = enrichment.src_threat_intel;
  const threatIntelLabel = threatIntel ? (threatIntel.found ? (threatIntel.verdict || 'Match reported') : 'No match reported') : 'Not supplied';
  const cmdbSupplied = Object.prototype.hasOwnProperty.call(enrichment, 'dst_asset') || Object.prototype.hasOwnProperty.call(enrichment, 'src_asset');
  const cmdbLabel = enrichment.dst_asset || enrichment.src_asset ? 'Match reported' : cmdbSupplied ? 'No match reported' : 'Not supplied';
  const edrTotal = Number(enrichment.edr_recent?.total || 0);
  const edrLabel = enrichment.edr_recent ? `${(Number.isFinite(edrTotal) ? edrTotal : 0).toLocaleString()} reported detections` : 'Not supplied';
  const assessmentLabel = verdict ? verdictLabel(verdict.verdict) : 'Awaiting triage';
  const tabs = [
    { value:'overview', label:'Overview' },
    { value:'workflow', label:'Workflow' },
    { value:'evidence', label:'Evidence' },
    { value:'entities', label:'Entities' },
    { value:'response', label:'Response' },
  ];

  function openReview() {
    setTab('overview');
    setReviewSignal(value => value + 1);
    window.setTimeout(() => document.getElementById(`alert-${alert.id}-review`)?.scrollIntoView({ behavior:'smooth', block:'center' }), 0);
  }

  return (
    <aside className="triage-detail-panel">
      <header className="triage-detail-header">
        <div className="triage-detail-heading"><div><h2>{activityTitle(alert)}</h2><SeverityBadge severity={severity} /></div><code>{shortId(alert)}</code></div>
        <div className="triage-panel-controls">
          <Button icon={Pin} iconOnly className={pinned ? 'is-active' : ''} onClick={onPin} aria-label={pinned ? 'Unpin alert' : 'Pin alert'} title={pinned ? 'Unpin alert' : 'Pin alert'} />
          <Button icon={Maximize2} iconOnly className={expanded ? 'is-active' : ''} onClick={onExpand} aria-label={expanded ? 'Restore queue' : 'Expand detail'} title={expanded ? 'Restore queue' : 'Expand detail'} />
          <Button icon={X} iconOnly onClick={onClose} aria-label="Close alert detail" title="Close alert detail" />
        </div>
      </header>

      <div className="triage-detail-actions">
        <Button variant="primary" icon={PlayCircle} onClick={onInvestigate}>Build investigation</Button>
        <Button variant="secondary" icon={Sparkles} onClick={onRetriage} disabled={busy}>{busy ? 'Queuing…' : 'Re-run AI'}</Button>
        <Button variant="secondary" icon={ShieldCheck} onClick={openReview}>Review decision</Button>
      </div>
      <UnderlineTabs value={tab} options={tabs} onChange={setTab} className="detail-tabs" />

      <div className="triage-detail-scroll" role="tabpanel">
        {tab === 'overview' && <div className="triage-overview">
          <section className="triage-assessment-card">
            <ConfidenceGauge value={confidence} label={assessmentLabel} />
            <div><span>AI assessment</span><h3>{assessmentLabel}</h3><p>{verdict?.narrative || 'The alert is queued for evidence-grounded model assessment.'}</p><div><StatusChip status={verdict ? 'active' : 'neutral'}>{verdict ? 'AI-assisted' : 'Pending'}</StatusChip>{verdict?.severity && <SeverityBadge severity={verdict.severity} />}</div></div>
          </section>

          <TriageDecisionSummary journey={journey} loading={journeyLoading} error={journeyError} verdict={verdict} onOpenWorkflow={() => setTab('workflow')} />

          <div className="triage-context-grid">
            <section className="triage-context-card"><h3>Observed enrichment</h3><dl><div><dt>Threat intelligence</dt><dd>{threatIntelLabel}</dd></div><div><dt>Asset mapping</dt><dd>{cmdbLabel}</dd></div><div><dt>Endpoint context</dt><dd>{edrLabel}</dd></div></dl></section>
            {(alert.mitre_techniques || []).length > 0 && <section className="triage-context-card"><h3>ATT&amp;CK mappings</h3><div className="triage-mitre-list">{alert.mitre_techniques.map(item => <span key={item}>{item}</span>)}</div></section>}
          </div>

          {(findings.length > 0 || aiActions.length > 0) && <div className="triage-context-grid">
            {findings.length > 0 && <section className="triage-context-card"><h3>{aiFindings.length ? 'AI key findings' : 'Observed indicators'}</h3><ul>{findings.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
            {aiActions.length > 0 && <section className="triage-context-card"><h3>AI recommended checks</h3><ul>{aiActions.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
          </div>}

          {citations.length > 0 && <section className="triage-citations"><h3>Evidence citations</h3><div>{citations.map(item => <code key={`${item.type}:${item.id}`}>{item.type}:{item.id}</code>)}</div></section>}

          <div id={`alert-${alert.id}-review`}>
            <AnalystDecisionReview entityType="alert" entityId={alert.id} reviews={journey?.analyst_reviews || []} openSignal={reviewSignal} onRecorded={review => onJourneyChange?.(current => ({ ...(current || {}), analyst_reviews:[review, ...(current?.analyst_reviews || [])] }))} />
          </div>
        </div>}

        {tab === 'workflow' && <TriageWorkflow journey={journey} loading={journeyLoading} error={journeyError} />}
        {tab === 'evidence' && <StructuredEvent alert={alert} />}
        {tab === 'entities' && <section className="triage-entity-grid"><article><User /><span>Affected identity</span><strong>{alert.username || 'Unknown'}</strong></article><article><Monitor /><span>Affected host</span><strong>{alert.hostname || alert.agent_name || 'Unknown'}</strong></article><article><Network /><span>Source address</span><strong>{alert.src_ip || 'Unknown'}</strong></article><article><Network /><span>Destination address</span><strong>{alert.dst_ip || 'Unknown'}</strong></article></section>}
        {tab === 'response' && <section className="triage-response-card"><header><div><h3>Response review checklist</h3><p>No action is executed from this checklist.</p></div><StatusChip>{completedActions.length}/{actions.length} acknowledged</StatusChip></header><p className="triage-response-notice"><ShieldAlert />Session-only analyst notes</p><ul>{actions.map((item,index)=><li key={index} className={completedActions.includes(index) ? 'is-complete' : ''}><button type="button" aria-label="Toggle local review acknowledgement" onClick={() => setCompletedActions(current => current.includes(index) ? current.filter(value => value !== index) : [...current,index])}><Check /></button><span>{item}</span></li>)}</ul></section>}
      </div>
    </aside>
  );
}

export default function Alerts({ workspace = 'alerts' }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [initialView] = useState(() => createInitialAlertView({ storage:typeof window === 'undefined' ? null : window.localStorage, workspace, searchParams }));
  const [alerts, setAlerts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [journey, setJourney] = useState(null);
  const [journeyLoading, setJourneyLoading] = useState(false);
  const [journeyError, setJourneyError] = useState(false);
  const [viewMode, setViewMode] = useState(initialView.viewMode);
  const [retriaging, setRetriaging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState(initialView.restored ? 'Restored browser-local alert view.' : '');
  const [pinnedIds, setPinnedIds] = useState(() => { try { return JSON.parse(localStorage.getItem('bmb-pinned-alerts')) || []; } catch { return []; } });
  const [filters, setFilters] = useState(initialView.filters);
  const routeSearch = searchParams.has('search') ? searchParams.get('search') || '' : null;
  const previousRouteSearch = useRef(routeSearch);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page, limit:20 });
      if (filters.search) query.set('search', filters.search);
      if (filters.severity) query.set('severity', filters.severity);
      if (filters.triage_status) query.set('triage_status', filters.triage_status);
      if (filters.source && viewMode === 'grouped') query.set('dataset', filters.source);
      if (filters.time_range === 'custom') {
        if (filters.custom_from) query.set('from', new Date(filters.custom_from).toISOString());
        if (filters.custom_to) query.set('to', new Date(filters.custom_to).toISOString());
      } else if (filters.time_range !== 'all') {
        query.set('from', new Date(Date.now() - Number(filters.time_range) * 60000).toISOString());
      }
      const grouped = viewMode === 'grouped';
      const data = await api(`${grouped ? '/alert-groups' : '/alerts'}?${query}`);
      const rows = grouped ? (data.groups || []).map(group => ({ ...group, id:group.representative_alert_id, timestamp:group.last_seen, agent_name:group.hostname })) : data.alerts || [];
      setAlerts(rows);
      setTotal(data.total || 0);
      setSelected(current => rows.find(row => row.id === current?.id) || rows[0] || null);
    } catch {
      setAlerts([]);
      setTotal(0);
      setSelected(null);
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [filters, page, viewMode]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (previousRouteSearch.current === routeSearch) return;
    previousRouteSearch.current = routeSearch;
    setFilters(current => ({ ...current, search:routeSearch || '' }));
    setPage(1);
  }, [routeSearch]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!selected?.id) { setDetail(null); setJourney(null); setJourneyError(false); return; }
    let live = true;
    setJourneyLoading(true);
    setJourneyError(false);
    Promise.allSettled([api(`/alerts/${encodeURIComponent(selected.id)}`), api(`/alerts/${encodeURIComponent(selected.id)}/journey`)]).then(([detailResult, journeyResult]) => {
      if (!live) return;
      setDetail(detailResult.status === 'fulfilled' ? detailResult.value : selected);
      if (journeyResult.status === 'fulfilled') setJourney(journeyResult.value);
      else { setJourney(null); setJourneyError(true); }
      setJourneyLoading(false);
    });
    return () => { live = false; };
  }, [selected]);

  const pages = Math.max(1, Math.ceil(total / 20));

  async function retriage() {
    if (!detail?.id) return;
    setRetriaging(true);
    try { await api(`/alerts/${encodeURIComponent(detail.id)}/retriage`, { method:'POST' }); await load(); }
    finally { setRetriaging(false); }
  }

  function persistList(key, setter, current, id) {
    const next = current.includes(id) ? current.filter(value => value !== id) : [...current,id];
    setter(next);
    localStorage.setItem(key, JSON.stringify(next));
  }

  function saveView() {
    try {
      writeBrowserAlertView(window.localStorage, { filters, viewMode });
      setNotice('Browser-local alert view saved.');
    } catch {
      setNotice('Unable to save this browser-local alert view.');
    }
  }

  function clearFilters() { setFilters({ search:'', severity:'', triage_status:'', source:'', time_range:'1440', custom_from:'', custom_to:'' }); setPage(1); }
  function updateFilter(key, value) { setFilters(current => ({ ...current, [key]:value })); setPage(1); }
  function updateViewMode(mode) { setViewMode(mode); setPage(1); }
  function selectRowWithKeyboard(event, alert) { if (event.key !== 'Enter' && event.key !== ' ') return; event.preventDefault(); setSelected(alert); }

  return (
    <div className="triage-page ui-page-enter">
      <section className="triage-workspace-header">
        <div><h2>Alert Triage Workspace</h2><p>{total.toLocaleString()} activities available for review</p></div>
        <DecisionQualityPanel />
      </section>

      {notice && <div className="workspace-notice" role="status">{notice}</div>}
      <section className="triage-filter-bar" aria-label="Alert filters">
        <Button variant="secondary" icon={Filter} onClick={clearFilters}>Clear filters</Button>
        <Select aria-label="Alert time range" value={filters.time_range} onChange={event => updateFilter('time_range', event.target.value)}><option value="1">Last 1 minute</option><option value="5">Last 5 minutes</option><option value="15">Last 15 minutes</option><option value="30">Last 30 minutes</option><option value="60">Last 1 hour</option><option value="240">Last 4 hours</option><option value="720">Last 12 hours</option><option value="1440">Last 24 hours</option><option value="10080">Last 7 days</option><option value="43200">Last 30 days</option><option value="129600">Last 90 days</option><option value="all">All time</option><option value="custom">Custom range…</option></Select>
        <Select aria-label="Source severity" value={filters.severity} onChange={event => updateFilter('severity', event.target.value)}><option value="">All severities</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select>
        <Select aria-label="AI status" value={filters.triage_status} onChange={event => updateFilter('triage_status', event.target.value)}><option value="">All AI states</option><option value="pending">Pending</option><option value="triaged">Triaged</option><option value="triage_failed">Failed</option></Select>
        <input className="triage-source-filter" value={filters.source} onChange={event => updateFilter('source', event.target.value)} placeholder="Dataset or source" aria-label="Dataset or source" disabled={viewMode !== 'grouped'} />
        <span className="triage-filter-spacer" />
        <Button variant="secondary" icon={Save} onClick={saveView}>Save view</Button>
        <Button icon={RefreshCw} iconOnly onClick={load} aria-label="Refresh alerts" title="Refresh alerts" className={loading ? 'is-loading' : ''} />
      </section>
      {filters.time_range === 'custom' && <section className="triage-custom-range"><span><Clock3 />Custom range</span><label>From<input type="datetime-local" value={filters.custom_from} onChange={event => updateFilter('custom_from', event.target.value)} /></label><label>To<input type="datetime-local" value={filters.custom_to} onChange={event => updateFilter('custom_to', event.target.value)} /></label></section>}

      <div className={`triage-layout ${expanded ? 'detail-expanded' : ''}`}>
        <section className="triage-queue-panel">
          <header><SegmentedControl label="Alert presentation" value={viewMode} onChange={updateViewMode} options={[{ value:'grouped', label:'Grouped' }, { value:'individual', label:'Individual' }]} /><span>{total.toLocaleString()} results</span></header>
          <div className="triage-queue-scroll">
            {loading && !alerts.length ? <div className="triage-queue-loading"><SkeletonLoader lines={6} /></div> : alerts.length ? (
              <ol className="triage-queue">{alerts.map(alert => {
                const severity = sourceSeverity(alert);
                const active = selected?.id === alert.id;
                return <li key={alert.group_key || alert.id}><button type="button" className={active ? 'is-selected' : ''} aria-pressed={active} aria-label={`Open ${activityTitle(alert)}`} onClick={() => setSelected(alert)} onKeyDown={event => selectRowWithKeyboard(event, alert)}><div className="triage-queue-meta"><code>{shortId(alert)}</code><span>{sourceLabel(alert)}{alert.occurrence_count > 1 ? ` · ${alert.occurrence_count} events` : ''}</span></div><strong>{activityTitle(alert)}</strong><div className="triage-queue-footer"><SeverityBadge severity={severity} /><time title={fmtTs(alert.timestamp)}>{timeOnly(alert.timestamp)}</time></div></button></li>;
              })}</ol>
            ) : <EmptyState icon={AlertTriangle} message="No alerts match these filters" action={<button type="button" onClick={clearFilters}>Clear filters</button>} />}
          </div>
          <footer className="triage-pagination"><span>{total ? `${(page - 1) * 20 + 1}–${Math.min(page * 20, total)} of ${total.toLocaleString()}` : '0 alerts'}</span><div><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</Button><StatusChip>{page} / {pages}</StatusChip><Button variant="secondary" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Next</Button></div></footer>
        </section>

        <AlertDetail alert={detail || selected} journey={journey} journeyLoading={journeyLoading} journeyError={journeyError} onJourneyChange={setJourney} onClose={() => { setSelected(null); setDetail(null); setJourney(null); setExpanded(false); }} onRetriage={retriage} busy={retriaging} expanded={expanded} onExpand={() => setExpanded(value => !value)} pinned={pinnedIds.includes((detail || selected)?.id)} onPin={() => persistList('bmb-pinned-alerts', setPinnedIds, pinnedIds, (detail || selected)?.id)} onInvestigate={() => navigate(`/investigations?search=${encodeURIComponent((detail || selected)?.id || entity(detail || selected))}`)} />
      </div>
    </div>
  );
}
