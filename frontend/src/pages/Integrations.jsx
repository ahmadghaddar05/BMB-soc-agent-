import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, CheckCircle2, CloudCog, Database, ExternalLink, HeartPulse, PlugZap, RefreshCw, SearchCheck, Server, Settings2, TriangleAlert } from 'lucide-react';
import { api, fmtTs } from '../lib/api';

function IntegrationCard({ icon:Icon, name, category, status, detail, metrics, onTest, busy, onConfigure }) {
  return <article className="integration-card"><div className="integration-head"><span><Icon /></span><div><small>{category}</small><h3>{name}</h3></div><em className={`integration-status ${status}`}>{status === 'online' ? <CheckCircle2 /> : <TriangleAlert />}{status}</em></div><p>{detail}</p><dl>{metrics.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></div>)}</dl><footer><button onClick={onTest} disabled={busy}><SearchCheck />{busy ? 'Testing…' : 'Test connection'}</button><button onClick={onConfigure}><Settings2 />Configure</button></footer></article>;
}

export default function Integrations() {
  const navigate = useNavigate();
  const [data, setData] = useState({ health:null, dependencies:null, collector:null, settings:null, scheduler:null });
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const requests = await Promise.allSettled([api('/health'),api('/health/dependencies'),api('/collector/status'),api('/settings'),api('/scheduler/status')]);
    setData({ health:requests[0].status === 'fulfilled' ? requests[0].value : null, dependencies:requests[1].status === 'fulfilled' ? requests[1].value : null, collector:requests[2].status === 'fulfilled' ? requests[2].value : null, settings:requests[3].status === 'fulfilled' ? requests[3].value : null, scheduler:requests[4].status === 'fulfilled' ? requests[4].value : null });
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function test(id, path) { setTesting(id); setNotice(''); try { await api(path); setNotice(`${id} connection responded successfully.`); await load(); } catch (e) { setNotice(`${id}: ${e.message}`); } finally { setTesting(''); } }
  const collector = data.collector?.collector || {};
  const database = data.collector?.database || {};
  const latest = data.collector?.latest_run || {};
  const services = data.dependencies?.services || {};
  const healthStatus = service => service?.status === 'online' || service?.status === 'mock' ? 'online' : service?.status === 'disabled' ? 'disabled' : 'attention';

  const cards = useMemo(() => [
    { id:'Alert source', icon:CloudCog, name:`${collector.source || data.dependencies?.source || 'Alert'} collector`, category:'Security telemetry', status:healthStatus(services.alert_source), detail:'Direct connectivity check to the configured Elastic, Wazuh, or mock alert source.', metrics:[['Status',services.alert_source?.status],['Latency',services.alert_source?.latency_ms != null ? `${services.alert_source.latency_ms} ms` : '—'],['Stored alerts',database.elastic_alerts],['Last run',fmtTs(latest.finished_at || latest.started_at)]], path:'/health/dependencies' },
    { id:'API', icon:HeartPulse, name:'BMB AI-SOC API', category:'Core platform', status:data.health?.status === 'ok' ? 'online' : 'attention', detail:'Frontend gateway for alerts, incidents, reports, configuration, and response actions.', metrics:[['Health',data.health?.status],['Checked',fmtTs(data.health?.ts)],['Grouped activities',database.grouped_activities],['Missing group keys',database.missing_group_keys]], path:'/health' },
    { id:'Hermes', icon:Bot, name:'Hermes AI analyst', category:'Decision intelligence', status:healthStatus(services.hermes), detail:'Hermes Runs API with a tool-less host profile and BMB-owned bounded read-only SOC tools.', metrics:[['Status',services.hermes?.status],['Safe profile',services.hermes?.safe === true ? 'Yes' : 'No'],['SOC tools',services.hermes?.application_tool_count ?? '—'],['Latency',services.hermes?.latency_ms != null ? `${services.hermes.latency_ms} ms` : '—']], path:'/health/dependencies' },
    { id:'Enrichment', icon:SearchCheck, name:'Enrichment pipeline', category:'Context services', status:healthStatus(services.enrichment), detail:'Direct health check of the AD, threat intelligence, asset, EDR, and vulnerability context service.', metrics:[['Status',services.enrichment?.status],['Latency',services.enrichment?.latency_ms != null ? `${services.enrichment.latency_ms} ms` : '—'],['Failed alerts',database.enrichment_failed],['Batch size',collector.enrichment_batch_size]], path:'/health/dependencies' },
    { id:'Postgres', icon:Database, name:'SOC evidence store', category:'Data platform', status:healthStatus(services.postgres), detail:'Direct database query health plus stored alert and cycle context.', metrics:[['Status',services.postgres?.status],['Latency',services.postgres?.latency_ms != null ? `${services.postgres.latency_ms} ms` : '—'],['Alert records',data.settings?.stats?.total],['Recent cycles',data.scheduler?.recent_runs?.length || 0]], path:'/health/dependencies' },
  ], [data, collector, database, latest, services]);

  return <div className="module-page integrations-page"><div className="module-hero compact"><div><span className="eyebrow"><PlugZap />Platform connections</span><h2>Integrations</h2><p>Live operational status for the services that power collection, enrichment, AI, and storage.</p></div><button className="primary-action" onClick={load} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh all</button></div>{notice && <div className="module-notice">{notice}</div>}<div className="integration-overview"><span className="integration-score"><b>{cards.filter(card => card.status === 'online').length}</b><small>of {cards.length} healthy</small></span><div><strong>Integration health</strong><p>Status is loaded from the real API, collector, scheduler, and settings endpoints.</p></div><button onClick={() => navigate('/settings')}><ExternalLink />Open platform settings</button></div><div className="integration-grid">{cards.map(card => <IntegrationCard key={card.id} {...card} busy={testing === card.id} onTest={() => test(card.id, card.path)} onConfigure={() => navigate('/settings')} />)}</div><section className="module-panel integration-run"><div className="panel-heading"><div><Server /><span><strong>Latest collection cycle</strong><small>Most recent server-side fetch run</small></span></div></div><div className="run-strip">{[['Status',latest.status],['Fetched',latest.fetched],['Stored',latest.stored],['Duplicates',latest.duplicates],['Enriched',latest.enriched],['Enrich failures',latest.enrichment_failed],['Triaged',latest.triaged]].map(([label,value]) => <div key={label}><small>{label}</small><strong>{value ?? '—'}</strong></div>)}</div>{data.collector?.runtime?.last_error && <div className="module-notice danger">{data.collector.runtime.last_error}</div>}</section></div>;
}
