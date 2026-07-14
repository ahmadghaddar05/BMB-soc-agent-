import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, CheckCircle2, CloudCog, Database, ExternalLink, HeartPulse, PlugZap, RefreshCw, SearchCheck, Server, Settings2, TriangleAlert } from 'lucide-react';
import { api, fmtTs } from '../lib/api';

function IntegrationCard({ icon:Icon, name, category, status, detail, metrics, onTest, busy, onConfigure }) {
  return <article className="integration-card"><div className="integration-head"><span><Icon /></span><div><small>{category}</small><h3>{name}</h3></div><em className={`integration-status ${status}`}>{status === 'online' ? <CheckCircle2 /> : <TriangleAlert />}{status}</em></div><p>{detail}</p><dl>{metrics.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></div>)}</dl><footer><button onClick={onTest} disabled={busy}><SearchCheck />{busy ? 'Testing…' : 'Test connection'}</button><button onClick={onConfigure}><Settings2 />Configure</button></footer></article>;
}

export default function Integrations() {
  const navigate = useNavigate();
  const [data, setData] = useState({ health:null, collector:null, settings:null, scheduler:null });
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const requests = await Promise.allSettled([api('/health'),api('/collector/status'),api('/settings'),api('/scheduler/status')]);
    setData({ health:requests[0].status === 'fulfilled' ? requests[0].value : null, collector:requests[1].status === 'fulfilled' ? requests[1].value : null, settings:requests[2].status === 'fulfilled' ? requests[2].value : null, scheduler:requests[3].status === 'fulfilled' ? requests[3].value : null });
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function test(id, path) { setTesting(id); setNotice(''); try { await api(path); setNotice(`${id} connection responded successfully.`); await load(); } catch (e) { setNotice(`${id}: ${e.message}`); } finally { setTesting(''); } }
  const collector = data.collector?.collector || {};
  const database = data.collector?.database || {};
  const latest = data.collector?.latest_run || {};
  const settings = data.settings?.settings || {};

  const cards = useMemo(() => [
    { id:'Elastic', icon:CloudCog, name:'Elastic alert collector', category:'Security telemetry', status:data.collector && !data.collector.runtime?.last_error ? 'online' : 'attention', detail:'Cursor-based collection of grouped Elastic security activities.', metrics:[['Source',collector.source],['Scheduler',collector.scheduler_running ? 'Running' : 'Stopped'],['Stored alerts',database.elastic_alerts],['Last run',fmtTs(latest.finished_at || latest.started_at)]], path:'/collector/status' },
    { id:'API', icon:HeartPulse, name:'BMB AI-SOC API', category:'Core platform', status:data.health?.status === 'ok' ? 'online' : 'attention', detail:'Frontend gateway for alerts, incidents, reports, configuration, and response actions.', metrics:[['Health',data.health?.status],['Checked',fmtTs(data.health?.ts)],['Grouped activities',database.grouped_activities],['Missing group keys',database.missing_group_keys]], path:'/health' },
    { id:'AI triage', icon:Bot, name:'AI triage provider', category:'Decision intelligence', status:settings.triage_enabled === 'false' ? 'attention' : 'online', detail:'Configured language model used for verdicts, narratives, findings, and recommended actions.', metrics:[['Provider',settings.llm_provider],['Mode',settings.triage_mode],['Model',settings[`${settings.llm_provider}_model`] || settings.groq_model],['Enabled',settings.triage_enabled === 'false' ? 'No' : 'Yes']], path:'/settings' },
    { id:'Enrichment', icon:SearchCheck, name:'Enrichment pipeline', category:'Context services', status:Number(database.enrichment_failed || 0) > 0 ? 'attention' : 'online', detail:'Threat intelligence, asset, EDR, and vulnerability context attached to alert evidence.', metrics:[['Pending',database.enrichment_pending],['Failed',database.enrichment_failed],['Batch size',collector.enrichment_batch_size],['Writeback',data.collector?.safety?.elastic_writeback_enabled ? 'Enabled' : 'Protected']], path:'/collector/status' },
    { id:'Postgres', icon:Database, name:'SOC evidence store', category:'Data platform', status:data.settings ? 'online' : 'attention', detail:'Persistent alerts, incidents, fetch history, settings, and analyst workflow data.', metrics:[['Alert records',data.settings?.stats?.total],['Incidents','Via incident service'],['Recent cycles',data.scheduler?.recent_runs?.length || 0],['API access',data.settings ? 'Available' : 'Unavailable']], path:'/settings' },
  ], [data, collector, database, latest, settings]);

  return <div className="module-page integrations-page"><div className="module-hero compact"><div><span className="eyebrow"><PlugZap />Platform connections</span><h2>Integrations</h2><p>Live operational status for the services that power collection, enrichment, AI, and storage.</p></div><button className="primary-action" onClick={load} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh all</button></div>{notice && <div className="module-notice">{notice}</div>}<div className="integration-overview"><span className="integration-score"><b>{cards.filter(card => card.status === 'online').length}</b><small>of {cards.length} healthy</small></span><div><strong>Integration health</strong><p>Status is loaded from the real API, collector, scheduler, and settings endpoints.</p></div><button onClick={() => navigate('/settings')}><ExternalLink />Open platform settings</button></div><div className="integration-grid">{cards.map(card => <IntegrationCard key={card.id} {...card} busy={testing === card.id} onTest={() => test(card.id, card.path)} onConfigure={() => navigate('/settings')} />)}</div><section className="module-panel integration-run"><div className="panel-heading"><div><Server /><span><strong>Latest collection cycle</strong><small>Most recent server-side fetch run</small></span></div></div><div className="run-strip">{[['Status',latest.status],['Fetched',latest.fetched],['Stored',latest.stored],['Duplicates',latest.duplicates],['Enriched',latest.enriched],['Enrich failures',latest.enrichment_failed],['Triaged',latest.triaged]].map(([label,value]) => <div key={label}><small>{label}</small><strong>{value ?? '—'}</strong></div>)}</div>{data.collector?.runtime?.last_error && <div className="module-notice danger">{data.collector.runtime.last_error}</div>}</section></div>;
}
