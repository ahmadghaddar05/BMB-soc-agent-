import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Bot, Check, Clock3, Copy, Filter, Maximize2,
  Monitor, Network, Pin, PlayCircle, RefreshCw, Save, Search,
  Shield, ShieldAlert, ShieldCheck, Sparkles, User, X, Zap,
} from 'lucide-react';
import { api, fmtTs, sevClass, verdictLabel } from '../lib/api';
import { createInitialAlertView, normalizeCitations, normalizeTextList, writeBrowserAlertView } from '../lib/analyst';
import { activityTitle, alertReference, severityOf } from '../lib/executive';
import InfoTip from '../components/InfoTip';

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

function timeOnly(timestamp) {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function readableRuleReference(id) {
  if (!id) return 'No technical ID';
  const value = String(id);
  return /^\d+$/.test(value) ? `Rule ${value}` : `Rule ${value.slice(0, 8).toUpperCase()}`;
}

function SourceBadge({ alert }) {
  const source = alert.event_dataset || alert.decoder || alert.agent_name || 'Elastic';
  return <span className="source-badge" title="Observed source label from the stored alert record"><Shield size={12} />{String(source).split('.')[0]}</span>;
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

function AlertDetail({ alert, onClose, onRetriage, onInvestigate, onEscalate, onPin, onExpand, busy, pinned, escalated, expanded }) {
  const [tab, setTab] = useState('overview');
  const [completedActions, setCompletedActions] = useState([]);
  if (!alert) return <aside className="alert-detail empty"><ShieldCheck /><strong>Select an alert</strong><span>Choose an activity to open the investigation workspace.</span></aside>;
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
  const limitations = normalizeTextList(verdict?.limitations);
  const threatIntel = enrichment.src_threat_intel;
  const threatIntelLabel = threatIntel
    ? (threatIntel.found ? (threatIntel.verdict || 'Match reported') : 'No match reported')
    : 'Not supplied';
  const cmdbSupplied = Object.prototype.hasOwnProperty.call(enrichment, 'dst_asset') || Object.prototype.hasOwnProperty.call(enrichment, 'src_asset');
  const cmdbLabel = enrichment.dst_asset || enrichment.src_asset ? 'Match reported' : cmdbSupplied ? 'No match reported' : 'Not supplied';
  const edrTotal = Number(enrichment.edr_recent?.total || 0);
  const edrLabel = enrichment.edr_recent
    ? `${(Number.isFinite(edrTotal) ? edrTotal : 0).toLocaleString()} reported detections`
    : 'Not supplied';
  const evidence = [
    { label: activityTitle(alert), type: 'Observed alert', detail: alert.full_log || 'Human-readable label derived from the stored Elastic alert fields.' },
    alert.process && { label: `Process observed: ${alert.process}`, type: 'Observed process', detail: alert.hostname || alert.agent_name || 'Stored endpoint process field' },
    alert.src_ip && { label: `Network observable: ${alert.src_ip}`, type: 'Observed network', detail: alert.dst_ip ? `Stored destination ${alert.dst_ip}` : 'Stored source network field' },
    verdict?.narrative && { label: 'AI assessment completed', type: 'AI-derived', detail: verdict.narrative },
  ].filter(Boolean);

  return (
    <aside className="alert-detail">
      <div className="detail-header">
        <div><span className="detail-id">{shortId(alert)}</span><span className={`badge ${sevClass(severity)}`} title="Source severity stored with this alert">{severity}</span><h2 title="Human-readable activity name derived from stored alert fields">{activityTitle(alert)}</h2></div>
        <div className="detail-header-actions"><button className={pinned ? 'active' : ''} onClick={onPin} title={pinned ? 'Unpin investigation' : 'Pin investigation'}><Pin /></button><button className={expanded ? 'active' : ''} onClick={onExpand} title={expanded ? 'Restore panel' : 'Expand'}><Maximize2 /></button><button onClick={onClose} title="Close panel"><X /></button></div>
      </div>
      <div className="detail-actions">
        <button className="detail-action primary" onClick={onInvestigate} title="Open the investigation builder with this alert preselected"><PlayCircle />Build investigation</button>
        <button className="detail-action" onClick={onRetriage} disabled={busy}><Sparkles />{busy ? 'Queuing…' : 'Re-run AI'}</button>
        <button className={`detail-action ${escalated ? 'is-complete' : ''}`} onClick={onEscalate} title="Add a browser-only reminder for analyst review"><ShieldCheck />{escalated ? 'Review flagged' : 'Flag for review'}</button>
      </div>
      <div className="detail-tabs">{['overview','evidence','entities','response'].map(item => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</div>

      <div className="detail-scroll">
        {tab === 'overview' && <>
          <div className="detail-summary-grid">
            <section className="detail-card verdict-card">
              <span className="detail-card-label">AI assessment · model-derived</span>
              <div className={`verdict-hero verdict-${verdict?.verdict || 'pending'}`}><Bot /><div><strong>{verdict ? verdictLabel(verdict.verdict) : 'Awaiting triage'}</strong><span>{confidence == null ? 'No confidence score' : `${confidence}% confidence`}</span></div></div>
              {confidence != null && <div className="verdict-meter"><i style={{ width: `${confidence}%` }} /></div>}
            </section>
            <section className="detail-card"><span className="detail-card-label">Observed enrichment</span><dl><div><dt>Threat-intel match</dt><dd>{threatIntelLabel}</dd></div><div><dt>CMDB match</dt><dd>{cmdbLabel}</dd></div><div><dt>EDR context</dt><dd>{edrLabel}</dd></div></dl></section>
            <section className="detail-card"><span className="detail-card-label">Stored MITRE mappings</span><div className="mitre-list">{(alert.mitre_techniques || []).map(item => <span key={item}>{item}</span>)}{!(alert.mitre_techniques || []).length && <em>No technique mapped in the alert</em>}</div></section>
          </div>
          <section className="detail-section"><div className="detail-section-title"><h3>Evidence &amp; Analysis Timeline</h3><span>{evidence.length} displayed items</span></div><div className="evidence-timeline">{evidence.map((item, index) => <article key={`${item.label}-${index}`}><i className={index === evidence.length - 1 ? 'danger' : ''} /><time>{timeOnly(alert.timestamp || alert.last_seen)}</time><div><strong>{item.label}</strong><p>{item.detail}</p></div><span>{item.type}</span></article>)}</div></section>
          <div className="detail-bottom-grid"><section className="detail-section"><div className="detail-section-title"><h3>{aiFindings.length ? 'AI key findings' : 'Observed indicators'}</h3><span>{aiFindings.length ? 'Model-derived' : 'Stored fields only'}</span></div><ul className="finding-list">{findings.length ? findings.map((item, index) => <li key={index}>{item}</li>) : <li>No observed indicators or AI findings are available.</li>}</ul></section><section className="detail-section"><div className="detail-section-title"><h3>{aiActions.length ? 'AI recommended actions' : 'Standard analyst checks'}</h3><span>{aiActions.length ? 'Model-derived' : 'Interface defaults'}</span></div><ul className="action-list">{actions.map((item, index) => <li key={index}><Check />{item}</li>)}</ul></section></div>
          <div className="detail-bottom-grid"><section className="detail-section"><div className="detail-section-title"><h3>AI evidence citations</h3><span>{citations.length} supplied</span></div><ul className="finding-list">{citations.length ? citations.map(item => <li key={`${item.type}:${item.id}`}><code>{item.type}:{item.id}</code></li>) : <li>{verdict ? 'No evidence citations were supplied with this AI result.' : 'No AI result is stored, so no citations are available.'}</li>}</ul></section><section className="detail-section"><div className="detail-section-title"><h3>AI limitations</h3><span>{limitations.length} supplied</span></div><ul className="finding-list">{limitations.length ? limitations.map((item, index) => <li key={`${item}-${index}`}>{item}</li>) : <li>{verdict ? 'No explicit limitations were supplied with this AI result.' : 'No AI result is stored, so limitations are unavailable.'}</li>}</ul></section></div>
        </>}

        {tab === 'evidence' && <StructuredEvent alert={alert} />}
        {tab === 'entities' && <section className="entity-grid tab-section"><article><User /><span>Affected identity</span><strong>{alert.username || 'Unknown'}</strong></article><article><Monitor /><span>Affected host</span><strong>{alert.hostname || alert.agent_name || 'Unknown'}</strong></article><article><Network /><span>Source address</span><strong>{alert.src_ip || 'Unknown'}</strong></article><article><Network /><span>Destination address</span><strong>{alert.dst_ip || 'Unknown'}</strong></article></section>}
        {tab === 'response' && <section className="detail-section tab-section"><div className="detail-section-title"><h3>Response Review Checklist</h3><span>{completedActions.length}/{actions.length} acknowledged</span></div><div className="module-notice"><ShieldAlert />Session-only review notes. No response action is executed by this checklist.</div><ul className="response-list">{actions.map((item,index)=><li key={index} className={completedActions.includes(index) ? 'complete' : ''}><button aria-label="Toggle local review acknowledgement" onClick={() => setCompletedActions(current => current.includes(index) ? current.filter(value => value !== index) : [...current,index])}><Check /></button><span>{item}</span></li>)}</ul></section>}
      </div>
    </aside>
  );
}

export default function Alerts({ workspace = 'alerts' }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [initialView] = useState(() => createInitialAlertView({
    storage: typeof window === 'undefined' ? null : window.localStorage,
    workspace,
    searchParams,
  }));
  const [alerts, setAlerts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [viewMode, setViewMode] = useState(initialView.viewMode);
  const [retriaging, setRetriaging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState(initialView.restored ? 'Restored browser-local alert view.' : '');
  const [pinnedIds, setPinnedIds] = useState(() => { try { return JSON.parse(localStorage.getItem('bmb-pinned-alerts')) || []; } catch { return []; } });
  const [escalatedIds, setEscalatedIds] = useState(() => { try { return JSON.parse(localStorage.getItem('bmb-escalated-alerts')) || []; } catch { return []; } });
  const [filters, setFilters] = useState(initialView.filters);
  const routeSearch = searchParams.has('search') ? searchParams.get('search') || '' : null;
  const previousRouteSearch = useRef(routeSearch);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page, limit: 20 });
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
      const rows = grouped ? (data.groups || []).map(group => ({ ...group, id: group.representative_alert_id, timestamp: group.last_seen, agent_name: group.hostname })) : data.alerts || [];
      setAlerts(rows);
      setTotal(data.total || 0);
      setSelected(current => rows.find(row => row.id === current?.id) || rows[0] || null);
    } catch {
      setAlerts([]); setTotal(0); setSelected(null); setDetail(null);
    } finally { setLoading(false); }
  }, [filters, page, viewMode]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (previousRouteSearch.current === routeSearch) return;
    previousRouteSearch.current = routeSearch;
    setFilters(current => ({ ...current, search: routeSearch || '' }));
    setPage(1);
  }, [routeSearch]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!selected?.id) { setDetail(null); return; }
    let live = true;
    api(`/alerts/${encodeURIComponent(selected.id)}`).then(data => { if (live) setDetail(data); }).catch(() => { if (live) setDetail(selected); });
    return () => { live = false; };
  }, [selected]);

  const pages = Math.max(1, Math.ceil(total / 20));
  const title = workspace === 'triage' ? 'AI Triage Workspace' : workspace === 'investigations' ? 'Investigation Workspace' : 'Alert Triage Workspace';

  async function retriage() {
    if (!detail?.id) return;
    setRetriaging(true);
    try { await api(`/alerts/${encodeURIComponent(detail.id)}/retriage`, { method: 'POST' }); await load(); }
    finally { setRetriaging(false); }
  }

  function persistList(key, setter, current, id) {
    const next = current.includes(id) ? current.filter(value => value !== id) : [...current,id];
    setter(next); localStorage.setItem(key, JSON.stringify(next));
  }

  function saveView() {
    try {
      writeBrowserAlertView(window.localStorage, { filters, viewMode });
      setNotice('Browser-local alert view saved. It is available only in this browser.');
    } catch {
      setNotice('Unable to save this browser-local alert view.');
    }
  }

  function clearFilters() { setFilters({ search:'', severity:'', triage_status:'', source:'', time_range:'1440', custom_from:'', custom_to:'' }); setPage(1); }
  function updateFilter(key, value) { setFilters(current => ({ ...current, [key]: value })); setPage(1); }
  function updateViewMode(mode) { setViewMode(mode); setPage(1); }
  function selectRowWithKeyboard(event, alert) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setSelected(alert);
  }

  return (
    <div className="triage-page">
      <div className="workspace-toolbar">
        <div className="workspace-heading"><div><h2>{title}</h2><span className="workspace-chip">AI-SOC</span></div><p>{total.toLocaleString()} activities available for review</p></div>
        <div className="toolbar-search"><Search /><input value={filters.search} onChange={event => updateFilter('search', event.target.value)} placeholder="Search IP, user, device, hash, alert ID..." /></div>
        <div className="toolbar-status"><span><i />Workspace active</span><small>API-backed alerts</small></div>
      </div>

      {notice && <div className="workspace-notice">{notice}</div>}
      <div className="filter-bar">
        <button className="filter-primary" onClick={clearFilters}><Filter />Clear Filters<InfoTip text="Clear severity, AI state, source, and search filters." /></button>
        <select className="time-range-select" aria-label="Alert time range" value={filters.time_range} onChange={event => updateFilter('time_range', event.target.value)}><option value="1">Last 1 minute</option><option value="5">Last 5 minutes</option><option value="15">Last 15 minutes</option><option value="30">Last 30 minutes</option><option value="60">Last 1 hour</option><option value="240">Last 4 hours</option><option value="720">Last 12 hours</option><option value="1440">Last 24 hours</option><option value="10080">Last 7 days</option><option value="43200">Last 30 days</option><option value="129600">Last 90 days</option><option value="all">All time</option><option value="custom">Custom range…</option></select>
        <select value={filters.severity} onChange={event => updateFilter('severity', event.target.value)}><option value="">Source severity</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
        <select value={filters.triage_status} onChange={event => updateFilter('triage_status', event.target.value)}><option value="">AI status</option><option value="pending">Pending</option><option value="triaged">Triaged</option><option value="triage_failed">Failed</option></select>
        <input className="filter-input" value={filters.source} onChange={event => updateFilter('source', event.target.value)} placeholder="Observed dataset / source" disabled={viewMode !== 'grouped'} />
        <span className="filter-spacer" />
        <button onClick={saveView} title="Save these filters and grouping in this browser only"><Save />Save browser view</button><button onClick={load} aria-label="Refresh"><RefreshCw className={loading ? 'animate-spin' : ''} /></button>
      </div>
      {filters.time_range === 'custom' && <div className="custom-time-range"><span><Clock3 />Custom time range</span><label>From<input type="datetime-local" value={filters.custom_from} onChange={event => updateFilter('custom_from', event.target.value)} /></label><label>To<input type="datetime-local" value={filters.custom_to} onChange={event => updateFilter('custom_to', event.target.value)} /></label><small>Times use your browser's local timezone.</small></div>}

      <div className={`triage-layout ${expanded ? 'detail-expanded' : ''}`}>
        <section className="alert-list-panel">
          <div className="list-mode-bar"><div><button className={viewMode === 'grouped' ? 'active' : ''} onClick={() => updateViewMode('grouped')}>Grouped</button><button className={viewMode === 'individual' ? 'active' : ''} onClick={() => updateViewMode('individual')}>Individual</button></div><span>{total.toLocaleString()} results</span></div>
          <div className="alert-table-scroll">
            <table className="alert-workspace-table">
              <thead><tr><th aria-label="Selected row" /><th>Activity</th><th>Source severity</th><th>Observed source</th><th>AI assessment</th><th>Primary observed entity</th><th>Time</th><th aria-hidden="true" /></tr></thead>
              <tbody>{alerts.map(alert => {
                const verdict = json(alert.verdict); const severity = sourceSeverity(alert); const active = selected?.id === alert.id; const confidence = verdict?.confidence != null ? Math.round(verdict.confidence * 100) : null;
                return <tr key={alert.group_key || alert.id} className={active ? 'selected' : ''} tabIndex={0} aria-selected={active} aria-label={`Open ${activityTitle(alert)}`} onClick={() => setSelected(alert)} onKeyDown={event => selectRowWithKeyboard(event, alert)}><td><span className={`fake-check ${active ? 'checked' : ''}`} aria-hidden="true">{active && <Check />}</span></td><td><strong>{shortId(alert)}</strong><span title="Human-readable label derived from stored alert fields">{activityTitle(alert)}</span>{alert.occurrence_count > 1 && <em>{alert.occurrence_count}×</em>}</td><td><span className={`badge ${sevClass(severity)}`}>{severity}</span></td><td><SourceBadge alert={alert} /></td><td><span className={`table-verdict verdict-${verdict?.verdict || 'pending'}`}><Zap />{verdict ? verdictLabel(verdict.verdict) : 'Pending'}</span>{confidence != null && <small>{confidence}% model confidence</small>}</td><td><strong>{entity(alert)}</strong><span>{alert.hostname || alert.src_ip || '—'}</span></td><td><strong>{timeOnly(alert.timestamp)}</strong><span>{new Date(alert.timestamp || Date.now()).toLocaleDateString()}</span></td><td aria-hidden="true" /></tr>;
              })}</tbody>
            </table>
            {!loading && !alerts.length && <div className="workspace-empty"><AlertTriangle /><strong>No alerts match these filters</strong><span>Clear filters or change the selected time range.</span></div>}
          </div>
          <div className="workspace-pagination"><span>{total ? `${(page - 1) * 20 + 1}–${Math.min(page * 20, total)} of ${total.toLocaleString()}` : '0 alerts'}</span><div><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>‹</button><b>{page}</b><button disabled={page >= pages} onClick={() => setPage(value => value + 1)}>›</button></div></div>
        </section>
        <AlertDetail alert={detail || selected} onClose={() => { setSelected(null); setDetail(null); setExpanded(false); }} onRetriage={retriage} busy={retriaging} expanded={expanded} onExpand={() => setExpanded(value => !value)} pinned={pinnedIds.includes((detail || selected)?.id)} onPin={() => persistList('bmb-pinned-alerts',setPinnedIds,pinnedIds,(detail || selected)?.id)} escalated={escalatedIds.includes((detail || selected)?.id)} onEscalate={() => { const id=(detail || selected)?.id; persistList('bmb-escalated-alerts',setEscalatedIds,escalatedIds,id); setNotice(escalatedIds.includes(id) ? 'Analyst-review flag removed.' : 'Flagged for analyst review in this browser. This does not execute a response action.'); }} onInvestigate={() => navigate(`/investigations?search=${encodeURIComponent((detail || selected)?.id || entity(detail || selected))}`)} />
      </div>
    </div>
  );
}
