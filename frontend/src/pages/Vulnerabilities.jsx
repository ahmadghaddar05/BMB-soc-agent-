import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertOctagon, Box, CircleCheck, ExternalLink, Filter, Search, Server, ShieldAlert, TriangleAlert } from 'lucide-react';
import { api, sevClass } from '../lib/api';
import { parseJson, relativeTime, severityOf } from '../lib/soc';
import { alertReference } from '../lib/executive';

const scoreSeverity = score => score >= 9 ? 'critical' : score >= 7 ? 'high' : score >= 4 ? 'medium' : 'low';

function extractFindings(alert) {
  const enrichment = parseJson(alert.enrichment);
  const candidates = enrichment.vulnerabilities || enrichment.vulns || enrichment.vuln_risk?.findings || enrichment.cves || [];
  const list = Array.isArray(candidates) ? candidates : Object.entries(candidates || {}).map(([id,value]) => ({ id, ...(typeof value === 'object' ? value : { value }) }));
  return list.map((item,index) => {
    const score = Number(item.cvss ?? item.score ?? item.cvss_score ?? enrichment.vuln_risk?.score ?? 0);
    return { id: item.cve || item.id || item.name || `Finding ${index + 1}`, title: item.title || item.description || item.name || 'Vulnerability enrichment finding', score, severity: item.severity?.toLowerCase() || scoreSeverity(score), package: item.package || item.product || item.component || 'Unknown component', alert };
  });
}

export default function Vulnerabilities() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [severity, setSeverity] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => { api('/alerts?limit=100').then(data => setAlerts(data.alerts || [])).finally(() => setLoading(false)); }, []);

  const findings = useMemo(() => alerts.flatMap(extractFindings).sort((a,b) => b.score - a.score), [alerts]);
  const exposureSignals = useMemo(() => alerts.filter(alert => { const text = `${alert.rule_desc || ''} ${alert.rule_groups || ''}`.toLowerCase(); return /vulnerab|cve|exploit|patch/.test(text); }), [alerts]);
  const rows = findings.length ? findings : exposureSignals.map(alert => ({ id: alert.rule_id || alert.id, title: alert.rule_desc, score: 0, severity: severityOf(alert), package: alert.process || 'Security exposure signal', alert, signalOnly: true }));
  const filtered = rows.filter(row => (severity === 'all' || row.severity === severity) && `${row.id} ${row.title} ${row.package} ${row.alert.hostname || ''}`.toLowerCase().includes(query.toLowerCase()));
  const selected = rows.find(row => String(row.id) === String(selectedId)) || filtered[0];
  const affected = new Set(rows.map(row => row.alert.hostname || row.alert.agent_name).filter(Boolean)).size;

  return <div className="module-page vuln-page">
    <div className="module-hero compact"><div><span className="eyebrow"><ShieldAlert />Exposure management</span><h2>Vulnerabilities</h2><p>Enrichment-backed vulnerability findings and exploit-related alert signals.</p></div><button className="primary-action" onClick={() => navigate('/settings')}><ExternalLink />Configure enrichment</button></div>
    <div className="module-metrics"><article className="metric-card tone-red"><span><AlertOctagon /></span><div><small>Critical findings</small><strong>{rows.filter(r => r.severity === 'critical').length}</strong></div></article><article className="metric-card tone-orange"><span><TriangleAlert /></span><div><small>High findings</small><strong>{rows.filter(r => r.severity === 'high').length}</strong></div></article><article className="metric-card tone-blue"><span><Server /></span><div><small>Affected assets</small><strong>{affected}</strong></div></article><article className="metric-card tone-purple"><span><Box /></span><div><small>Total evidence</small><strong>{rows.length}</strong></div></article></div>
    {!findings.length && !loading && <section className="vulnerability-coverage module-panel"><div><ShieldAlert /><span><strong>No structured vulnerability inventory is connected</strong><small>This page never invents CVEs. It needs CVE/CVSS findings from the enrichment service or exploit-related Elastic detections.</small></span></div><dl><div><dt>Alert records inspected</dt><dd>{alerts.length}</dd></div><div><dt>Structured CVE findings</dt><dd>{findings.length}</dd></div><div><dt>Exploit signals</dt><dd>{exposureSignals.length}</dd></div><div><dt>Data integrity</dt><dd><CircleCheck /> Real data only</dd></div></dl><button onClick={() => navigate('/settings')}><ExternalLink />Review enrichment settings</button></section>}
    <div className="vuln-layout"><section className="module-panel vuln-list"><div className="panel-heading"><div><ShieldAlert /><span><strong>Exposure findings</strong><small>{filtered.length} results</small></span></div></div><div className="inventory-controls"><label><Search /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search CVE, host, or component" /></label><label className="select-with-icon"><Filter /><select value={severity} onChange={e => setSeverity(e.target.value)}><option value="all">All severities</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label></div><div className="finding-list-panel">{filtered.map((row,index) => <button key={`${row.id}-${index}`} className={selected === row ? 'active' : ''} onClick={() => setSelectedId(row.id)}><span className={`finding-score score-${row.severity}`}>{row.score ? row.score.toFixed(1) : 'SIG'}</span><div><strong>{row.id}</strong><span>{row.title}</span><small>{row.alert.hostname || row.alert.agent_name || 'Unknown asset'} · {row.package}</small></div><span className={`badge ${sevClass(row.severity)}`}>{row.severity}</span></button>)}{!loading && !filtered.length && <div className="module-empty small"><ShieldAlert /><strong>No exposure evidence in this view</strong></div>}</div></section>
      <section className="module-panel vuln-detail">{selected ? <><div className="vuln-detail-head"><span className={`finding-score score-${selected.severity}`}>{selected.score ? selected.score.toFixed(1) : 'SIG'}</span><div><small>{selected.signalOnly ? 'Alert-derived exposure signal' : 'Enrichment finding'}</small><h3>{selected.id}</h3><p>{selected.title}</p></div></div><dl className="vuln-facts"><div><dt>Affected asset</dt><dd>{selected.alert.hostname || selected.alert.agent_name || 'Unknown'}</dd></div><div><dt>Component</dt><dd>{selected.package}</dd></div><div><dt>Severity</dt><dd><span className={`badge ${sevClass(selected.severity)}`}>{selected.severity}</span></dd></div><div><dt>Last observed</dt><dd>{relativeTime(selected.alert.timestamp)}</dd></div><div><dt>Source evidence</dt><dd>{alertReference(selected.alert)}</dd></div><div><dt>AI state</dt><dd>{selected.alert.triage_status || 'pending'}</dd></div></dl><div className="vuln-response"><h4>Analyst actions</h4><button onClick={() => navigate(`/alerts?search=${encodeURIComponent(selected.alert.id)}`)}>Review source alert</button><button onClick={() => navigate(`/investigations?search=${encodeURIComponent(selected.alert.hostname || selected.id)}`)}>Open investigation</button></div></> : <div className="module-empty"><ShieldAlert /><strong>No exposure evidence selected</strong><span>Connect vulnerability enrichment or generate an exploit-related Elastic detection to populate this workspace.</span></div>}</section></div>
  </div>;
}
