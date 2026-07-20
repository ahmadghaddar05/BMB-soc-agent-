import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot, Database, ExternalLink, LockKeyhole, RefreshCw, Settings2, ShieldCheck,
} from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import { api } from '../lib/api';

function yesNo(value) {
  if (value == null) return 'Not reported';
  return value === true || value === 'true' ? 'Enabled' : 'Disabled';
}

function Boundary({ title, state, detail, safe = true }) {
  return <article className="integration-card">
    <div className="integration-head"><span>{safe ? <ShieldCheck /> : <LockKeyhole />}</span><div><small>Safety boundary</small><h3>{title}</h3></div><StatusBadge tone={safe ? 'success' : 'attention'}>{state}</StatusBadge></div>
    <p>{detail}</p>
  </article>;
}

export default function Settings() {
  const navigate = useNavigate();
  const [runtime, setRuntime] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const results = await Promise.allSettled([api('/admin/runtime'), api('/settings')]);
    if (results[0].status === 'fulfilled') setRuntime(results[0].value);
    if (results[1].status === 'fulfilled') setSettings(results[1].value?.settings || {});
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) setError(`${failures.length} configuration source${failures.length === 1 ? '' : 's'} could not be loaded.`);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const boundaries = useMemo(() => [
    {
      title:'External writeback', state:settings?.elastic_writeback_enabled === 'true' ? 'Enabled' : 'Read only',
      safe:settings?.elastic_writeback_enabled !== 'true',
      detail:settings?.elastic_writeback_enabled === 'true'
        ? 'Elastic writeback is reported enabled. Review the deployment policy before permitting response workflows.'
        : 'Elastic records are not modified by BMB. Security evidence is collected for analysis only.',
    },
    {
      title:'Automatic alert closure', state:yesNo(settings?.autoclose_enabled),
      safe:settings?.autoclose_enabled !== 'true',
      detail:'Automatic closure is blocked by server policy. AI recommendations remain subject to analyst review.',
    },
    {
      title:'Response execution', state:'Simulation only', safe:true,
      detail:'Safe Response Simulation does not change an endpoint, identity, firewall, or Elastic record.',
    },
  ], [settings]);

  return <div className="module-page">
    <div className="module-hero compact"><div><span className="eyebrow"><Settings2 />Platform boundaries</span><h2>Settings</h2><p>Read-only platform safeguards and configuration ownership. Operational controls are separated into Collector Health and AI Configuration.</p></div><button type="button" className="primary-action" onClick={load} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</button></div>

    {error && <div className="module-notice danger" role="alert"><span>{error}</span><button type="button" onClick={load} disabled={loading}>Retry</button></div>}
    {loading && !runtime && !settings ? <section className="module-panel"><div className="module-empty small" role="status"><RefreshCw className="animate-spin" /><strong>Loading platform configuration</strong></div></section> : <>
      <div className="integration-grid">{boundaries.map(item => <Boundary key={item.title} {...item} />)}</div>

      <section className="module-panel" style={{ marginTop:10 }}>
        <div className="panel-heading"><div><Database /><span><strong>Configuration ownership</strong><small>Secrets and source credentials never enter the browser</small></span></div></div>
        <div className="module-table-wrap"><table className="module-table"><thead><tr><th>Area</th><th>Current state</th><th>Managed through</th><th>Open workspace</th></tr></thead><tbody>
          <tr><td><strong>Security telemetry</strong><small>Elastic, Wazuh, or lab source</small></td><td><StatusBadge tone="neutral">{runtime?.alert_source?.type || 'Not reported'}</StatusBadge></td><td>Environment and collector policy</td><td><button type="button" className="table-link" onClick={() => navigate('/collector-health')}>Collector Health <ExternalLink /></button></td></tr>
          <tr><td><strong>AI-assisted analysis</strong><small>Hermes provider and evidence policies</small></td><td><StatusBadge tone={runtime?.ai_provider?.credential_configured ? 'success' : 'attention'}>{runtime?.ai_provider?.credential_configured ? 'Configured' : 'Not configured'}</StatusBadge></td><td>Environment credentials and database policy</td><td><button type="button" className="table-link" onClick={() => navigate('/ai-configuration')}>AI Configuration <ExternalLink /></button></td></tr>
          <tr><td><strong>Authentication</strong><small>Single environment-managed account</small></td><td><StatusBadge tone={runtime?.authentication?.mode === 'development_disabled' ? 'attention' : 'neutral'}>{runtime?.authentication?.mode?.replaceAll('_', ' ') || 'Not reported'}</StatusBadge></td><td>Environment configuration</td><td><button type="button" className="table-link" onClick={() => navigate('/users-access')}>Users &amp; Access <ExternalLink /></button></td></tr>
        </tbody></table></div>
      </section>

      <div className="module-notice" role="status"><Bot /><span>Changes to collection and AI workflow policies are audited through their dedicated administration pages. Passwords, API keys, TLS material, and retention jobs are intentionally not editable here.</span></div>
    </>}
  </div>;
}
