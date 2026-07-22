import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot, CheckCircle2, CloudCog, ExternalLink, PlugZap, RefreshCw,
  SearchCheck, ShieldAlert, TriangleAlert,
} from 'lucide-react';
import { api, fmtTs } from '../lib/api';

function connectorState(service, { configured = true, simulated = false } = {}) {
  if (simulated) return { key:'simulated', label:'Simulated / lab' };
  if (!configured || service?.configured === false) return { key:'disabled', label:'Not configured' };
  if (service?.status === 'online') return { key:'online', label:'Connected' };
  if (service?.status === 'disabled') return { key:'disabled', label:'Disabled' };
  if (service?.status === 'degraded' || service?.reachable === false) return { key:'attention', label:'Degraded' };
  return { key:'attention', label:'Unavailable' };
}

function ConnectionCard({ icon:Icon, name, category, state, detail, facts, error, action, onAction }) {
  return <article className="integration-card">
    <div className="integration-head"><span><Icon /></span><div><small>{category}</small><h3>{name}</h3></div><em className={`integration-status ${state.key}`}>{state.key === 'online' ? <CheckCircle2 /> : <TriangleAlert />}{state.label}</em></div>
    <p>{detail}</p>
    <dl>{facts.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></div>)}</dl>
    {error && <div className="module-notice danger"><ShieldAlert />{error}</div>}
    <footer>{action ? <button type="button" onClick={onAction}><ExternalLink />{action}</button> : <span>Configuration is environment-managed.</span>}</footer>
  </article>;
}

export default function Integrations() {
  const navigate = useNavigate();
  const [data, setData] = useState({ dependencies:null, collector:null, runtime:null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checkedAt, setCheckedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const results = await Promise.allSettled([
      api('/health/dependencies'), api('/collector/status'), api('/admin/runtime'),
    ]);
    setData({
      dependencies:results[0].status === 'fulfilled' ? results[0].value : null,
      collector:results[1].status === 'fulfilled' ? results[1].value : null,
      runtime:results[2].status === 'fulfilled' ? results[2].value : null,
    });
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) setError(`${failures.length} administration source${failures.length === 1 ? '' : 's'} could not be refreshed.`);
    setCheckedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const services = data.dependencies?.services || {};
  const source = data.runtime?.alert_source || {};
  const ai = data.runtime?.ai_provider || {};
  const collector = data.collector?.collector || {};
  const connectors = useMemo(() => [
    {
      id:'source', icon:CloudCog, name:source.type === 'elastic' ? 'Elastic Security' : source.type === 'wazuh' ? 'Wazuh' : 'Lab alert source',
      category:'Security telemetry', service:services.alert_source,
      state:connectorState(services.alert_source, { configured:source.type === 'elastic' ? source.elastic_configured : source.type === 'wazuh' ? source.wazuh_configured : true, simulated:source.type === 'mock' }),
      detail:'Source used by the BMB collector to retrieve security detections. Credentials remain environment-managed and are never returned to the browser.',
      facts:[['Source',source.type],['Indices',source.elastic_event_indices],['TLS verification',source.tls_verification == null ? 'Not applicable' : source.tls_verification ? 'Enabled' : 'Disabled'],['Last collection',fmtTs(data.collector?.latest_run?.finished_at || data.collector?.latest_run?.started_at)]],
      error:services.alert_source?.error, action:'Review collector health', path:'/collector-health',
    },
    {
      id:'hermes', icon:Bot, name:'Hermes AI provider', category:'AI-assisted analysis', service:services.hermes,
      state:connectorState(services.hermes, { configured:ai.credential_configured || !ai.required }),
      detail:'Evidence-grounded triage and correlation provider. Model policy is visible here; secrets remain outside application settings.',
      facts:[['Model',ai.model],['Required',ai.required ? 'Yes' : 'No'],['Safe profile',services.hermes?.safe === true ? 'Verified' : services.hermes?.safe === false ? 'Failed' : 'Unavailable'],['Latency',services.hermes?.latency_ms != null ? `${services.hermes.latency_ms} ms` : '—']],
      error:services.hermes?.error, action:'Review AI configuration', path:'/ai-configuration',
    },
    {
      id:'enrichment', icon:SearchCheck, name:'Security enrichment service', category:'Context enrichment', service:services.enrichment,
      state:connectorState(services.enrichment),
      detail:'Provides identity, asset, endpoint, threat-intelligence, and vulnerability context when those datasets are available.',
      facts:[['Status',services.enrichment?.status],['Latency',services.enrichment?.latency_ms != null ? `${services.enrichment.latency_ms} ms` : '—'],['AD users',services.enrichment?.counts?.ad_users],['CMDB assets',services.enrichment?.counts?.cmdb_assets]],
      error:services.enrichment?.error,
    },
  ], [ai, collector, data, services, source]);

  const connected = connectors.filter(item => item.state.key === 'online').length;
  return <div className="module-page integrations-page">
    <div className="module-hero compact"><div><span className="eyebrow"><PlugZap />External connections</span><h2>Integrations</h2><p>Connection state for external telemetry, AI, and enrichment services. Internal API, PostgreSQL, and scheduler health are shown under Collector Health.</p></div><button className="primary-action" onClick={load} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh status</button></div>
    {error && <div className="module-notice danger" role="alert"><ShieldAlert />{error}</div>}
    <div className="integration-overview"><span className="integration-score"><b>{connected}</b><small>of {connectors.length} connected</small></span><div><strong>Connector status</strong><p>Last checked {checkedAt ? checkedAt.toLocaleTimeString() : 'not yet'} · simulated sources are not counted as production connections.</p></div></div>
    <div className="integration-grid">{connectors.map(card => <ConnectionCard key={card.id} {...card} onAction={() => navigate(card.path)} />)}</div>
  </div>;
}
