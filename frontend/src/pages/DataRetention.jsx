import { useCallback, useEffect, useState } from 'react';
import { Archive, Clock3, Database, FileClock, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import { api } from '../lib/api';

function timestamp(value) {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Not recorded' : parsed.toLocaleString();
}

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : 'Not reported';
}

function policyState(configured) {
  return configured ? <StatusBadge tone="success">Configured</StatusBadge> : <StatusBadge tone="attention">Not configured in BMB</StatusBadge>;
}

export default function DataRetention() {
  const [governance, setGovernance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setGovernance(await api('/admin/data-governance'));
    } catch (loadError) {
      setError(loadError.message || 'Data-governance information could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const stores = governance?.stores;
  const policies = governance?.policies;

  return (
    <div className="module-page">
      <div className="module-hero compact">
        <div>
          <span className="eyebrow"><Archive />Storage governance</span>
          <h2>Data Retention</h2>
          <p>Observed record coverage and the exact boundary between BMB-managed cache expiry and externally managed lifecycle policy.</p>
        </div>
        <button type="button" className="primary-action" onClick={load} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</button>
      </div>

      {error && <div className="module-notice danger" role="alert"><span>{error}</span><button type="button" onClick={load} disabled={loading}>Retry</button></div>}

      {loading && !governance ? (
        <section className="module-panel"><div className="module-empty small" role="status"><RefreshCw className="animate-spin" /><strong>Loading governance snapshot</strong><span>Reading record coverage and configured lifecycle boundaries.</span></div></section>
      ) : stores && policies ? (
        <>
          <div className="module-notice danger" role="status"><ShieldAlert /><span>BMB automatic retention is not configured for stored alerts, application audit events, or PostgreSQL records. This page is observational and does not delete data.</span></div>
          <div className="module-notice"><ShieldCheck /><span>Elastic source-data lifecycle is managed outside BMB. Verify the applicable Elastic data-stream or index lifecycle policy directly in Elastic.</span></div>

          <div className="module-metrics">
            <article className="metric-card tone-blue"><span><Database /></span><div><small>Stored alerts</small><strong>{count(stores.alerts?.total)}</strong></div></article>
            <article className="metric-card tone-purple"><span><ShieldCheck /></span><div><small>Audit events</small><strong>{count(stores.audit_events?.total)}</strong></div></article>
            <article className="metric-card tone-green"><span><FileClock /></span><div><small>Fetch runs</small><strong>{count(stores.fetch_runs?.total)}</strong></div></article>
            <article className="metric-card tone-orange"><span><Clock3 /></span><div><small>Triage cache entries</small><strong>{count(stores.triage_cache?.total)}</strong></div></article>
          </div>

          <section className="module-panel">
            <div className="panel-heading"><div><Database /><span><strong>Stored data coverage</strong><small>Snapshot generated {timestamp(governance.generated_at)}; coverage dates are not retention guarantees</small></span></div></div>
            <div className="module-table-wrap">
              <table className="module-table">
                <thead><tr><th>Store</th><th>Records</th><th>Oldest observed</th><th>Newest observed</th><th>Interpretation</th></tr></thead>
                <tbody>
                  <tr><td><strong>Stored alerts</strong><small>PostgreSQL evidence store</small></td><td><strong>{count(stores.alerts?.total)}</strong></td><td>{timestamp(stores.alerts?.oldest)}</td><td>{timestamp(stores.alerts?.newest)}</td><td>Application alert records currently present in BMB.</td></tr>
                  <tr><td><strong>Application audit events</strong><small>Supported BMB workflow actions</small></td><td><strong>{count(stores.audit_events?.total)}</strong></td><td>{timestamp(stores.audit_events?.oldest)}</td><td>{timestamp(stores.audit_events?.newest)}</td><td>Not a complete infrastructure or Elastic audit trail.</td></tr>
                  <tr><td><strong>Collection runs</strong><small>Scheduler execution history</small></td><td><strong>{count(stores.fetch_runs?.total)}</strong></td><td>{timestamp(stores.fetch_runs?.oldest)}</td><td>{timestamp(stores.fetch_runs?.newest)}</td><td>Server-side fetch-cycle records currently present.</td></tr>
                  <tr><td><strong>Triage cache</strong><small>Transient AI decision cache</small></td><td><strong>{count(stores.triage_cache?.total)}</strong></td><td>{timestamp(stores.triage_cache?.next_expiry)}<small>Next expiry</small></td><td>{timestamp(stores.triage_cache?.last_expiry)}<small>Latest expiry</small></td><td>Cache expiry does not delete source alerts or audit evidence.</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="module-panel" style={{ marginTop:10 }}>
            <div className="panel-heading"><div><Archive /><span><strong>Retention ownership</strong><small>Reported policy state with no implied enforcement beyond the named owner</small></span></div></div>
            <div className="module-table-wrap">
              <table className="module-table">
                <thead><tr><th>Data boundary</th><th>Reported state</th><th>Policy owner</th><th>What this means</th></tr></thead>
                <tbody>
                  <tr><td><strong>PostgreSQL automatic retention</strong></td><td>{policyState(policies.postgres_automatic_retention_configured)}</td><td>BMB deployment administrator</td><td>No application-managed PostgreSQL deletion schedule is reported.</td></tr>
                  <tr><td><strong>Stored alert retention</strong></td><td>{policyState(policies.alert_retention_configured)}</td><td>BMB deployment administrator</td><td>No application-managed alert deletion policy is reported.</td></tr>
                  <tr><td><strong>Application audit retention</strong></td><td>{policyState(policies.audit_retention_configured)}</td><td>BMB deployment administrator</td><td>No application-managed audit-event deletion policy is reported.</td></tr>
                  <tr><td><strong>Elastic source lifecycle</strong></td><td><StatusBadge tone="neutral">Managed outside BMB</StatusBadge></td><td>Elastic administrator</td><td>{policies.elastic_source_lifecycle === 'managed_outside_bmb' ? 'BMB does not configure or verify source-index lifecycle from this interface.' : `Server reported: ${policies.elastic_source_lifecycle || 'Not reported'}.`}</td></tr>
                  <tr><td><strong>Triage cache expiry</strong></td><td><StatusBadge tone="success">{Number.isFinite(Number(policies.triage_cache_ttl_hours)) ? `${policies.triage_cache_ttl_hours} hours` : 'Not reported'}</StatusBadge></td><td>BMB AI configuration</td><td>Applies only to cached triage results, not alerts, incidents, or audit records.</td></tr>
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : !error ? (
        <section className="module-panel"><div className="module-empty"><Archive /><strong>Governance snapshot was not returned</strong><span>No retention claim can be made until the server reports its storage and policy state.</span><button type="button" onClick={load}>Retry</button></div></section>
      ) : null}
    </div>
  );
}
