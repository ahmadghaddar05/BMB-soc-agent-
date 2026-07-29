import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, Archive, Clock3, Database, FileClock, RefreshCw,
  ShieldCheck, Trash2,
} from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import { api } from '../lib/api';

function timestamp(value) {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Not recorded' : parsed.toLocaleString();
}

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : '0';
}

function CountStrip({ title, values, tone = 'blue' }) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <span><Database /></span>
      <div>
        <small>{title}</small>
        <strong>{count(values?.total)}</strong>
        <small>{count(values?.critical)} critical · {count(values?.high)} high · {count(values?.other)} other</small>
      </div>
    </article>
  );
}

export default function DataRetention() {
  const [governance, setGovernance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState('initial_7_day_purge');
  const [confirmation, setConfirmation] = useState('');
  const [working, setWorking] = useState(false);

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

  async function preview() {
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const result = await api('/admin/data-governance/retention/preview', {
        method:'POST',
        body:JSON.stringify({ mode }),
      });
      setGovernance(current => ({ ...current, retention_preview:result }));
      setNotice(`Preview complete: ${count(result.deletable?.total)} dashboard alerts are eligible for deletion.`);
    } catch (actionError) {
      setError(actionError.message || 'Retention preview failed.');
    } finally {
      setWorking(false);
    }
  }

  async function purge() {
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const result = await api('/admin/data-governance/retention/run', {
        method:'POST',
        body:JSON.stringify({ mode, confirmation }),
      });
      setNotice(`Retention completed: ${count(result.deleted?.total)} dashboard alerts deleted; ${count(result.protected?.total)} linked evidence records preserved.`);
      setConfirmation('');
      await load();
    } catch (actionError) {
      setError(actionError.message || 'Retention run failed.');
    } finally {
      setWorking(false);
    }
  }

  async function setAutomaticRetention(enabled) {
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await api('/settings', {
        method:'PUT',
        body:JSON.stringify({ alert_retention_enabled:String(enabled) }),
      });
      setNotice(`Automatic severity-aware retention ${enabled ? 'enabled' : 'disabled'}.`);
      await load();
    } catch (actionError) {
      setError(actionError.message || 'Retention schedule could not be changed.');
    } finally {
      setWorking(false);
    }
  }

  const stores = governance?.stores;
  const policies = governance?.policies;
  const previewData = governance?.retention_preview;
  const policy = policies?.alert_retention;
  const expectedConfirmation = governance?.purge_confirmation || 'PURGE DASHBOARD ALERTS';

  return (
    <div className="module-page">
      <div className="module-hero compact">
        <div>
          <span className="eyebrow"><Archive />Storage governance</span>
          <h2>Alert Retention</h2>
          <p>Keep the analyst queue current while preserving durable case evidence. This lifecycle applies only to BMB&apos;s PostgreSQL alert copy.</p>
        </div>
        <button type="button" className="primary-action" onClick={load} disabled={loading || working}>
          <RefreshCw className={loading ? 'animate-spin' : ''} />Refresh
        </button>
      </div>

      {error && <div className="module-notice danger" role="alert"><AlertTriangle /><span>{error}</span></div>}
      {notice && <div className="module-notice success" role="status"><ShieldCheck /><span>{notice}</span></div>}
      <div className="module-notice"><ShieldCheck /><span>Elastic indices and data streams are never deleted by this page. Incident, investigation, and response-simulation evidence is protected from alert cleanup.</span></div>

      {loading && !governance ? (
        <section className="module-panel"><div className="module-empty small" role="status"><RefreshCw className="animate-spin" /><strong>Loading retention state</strong></div></section>
      ) : stores && policies ? (
        <>
          <div className="module-metrics">
            <article className="metric-card tone-blue"><span><Database /></span><div><small>Stored dashboard alerts</small><strong>{count(stores.alerts?.total)}</strong><small>Oldest {timestamp(stores.alerts?.oldest)}</small></div></article>
            <article className="metric-card tone-red"><span><Trash2 /></span><div><small>Eligible in current preview</small><strong>{count(previewData?.deletable?.total)}</strong><small>Not deleted until confirmed</small></div></article>
            <article className="metric-card tone-green"><span><ShieldCheck /></span><div><small>Protected evidence</small><strong>{count(previewData?.protected?.total)}</strong><small>Linked records retained</small></div></article>
            <article className="metric-card tone-purple"><span><Clock3 /></span><div><small>Automatic cycle</small><strong>{policy?.enabled ? 'Active' : 'Paused'}</strong><small>Daily at 02:17 UTC</small></div></article>
          </div>

          <section className="module-panel">
            <div className="panel-heading">
              <div><Clock3 /><span><strong>Severity-aware lifecycle</strong><small>Applied daily after activation</small></span></div>
              <StatusBadge tone={policy?.enabled ? 'success' : 'attention'}>{policy?.enabled ? 'Enabled' : 'Disabled'}</StatusBadge>
            </div>
            <div className="module-table-wrap">
              <table className="module-table">
                <thead><tr><th>Alert severity</th><th>Lifetime</th><th>Deletion boundary</th><th>Evidence protection</th></tr></thead>
                <tbody>
                  <tr><td><strong>Critical</strong></td><td>{policy?.critical_days || 14} days</td><td>Last observed time exceeds lifetime</td><td>Always preserve linked durable evidence</td></tr>
                  <tr><td><strong>High</strong></td><td>{policy?.high_days || 10} days</td><td>Last observed time exceeds lifetime</td><td>Always preserve linked durable evidence</td></tr>
                  <tr><td><strong>Other severities</strong></td><td>{policy?.default_days || 7} days</td><td>Last observed time exceeds lifetime</td><td>Always preserve linked durable evidence</td></tr>
                </tbody>
              </table>
            </div>
            <div style={{ display:'flex', gap:8, padding:'12px 14px' }}>
              <button type="button" className="primary-action" disabled={working} onClick={() => setAutomaticRetention(!policy?.enabled)}>
                {policy?.enabled ? 'Pause automatic retention' : 'Enable automatic retention'}
              </button>
            </div>
          </section>

          <section className="module-panel" style={{ marginTop:10 }}>
            <div className="panel-heading"><div><Trash2 /><span><strong>Preview and run cleanup</strong><small>Destructive actions require exact typed confirmation</small></span></div></div>
            <div style={{ display:'grid', gap:12, padding:14 }}>
              <label style={{ display:'grid', gap:6, maxWidth:460 }}>
                <span>Cleanup mode</span>
                <select value={mode} onChange={event => setMode(event.target.value)}>
                  <option value="initial_7_day_purge">One-time purge: older than 7 days</option>
                  <option value="policy">Normal policy: critical 14 / high 10 / other 7 days</option>
                </select>
              </label>
              <div className="module-metrics" style={{ margin:0 }}>
                <CountStrip title="Eligible candidates" values={previewData?.candidates} />
                <CountStrip title="Protected from deletion" values={previewData?.protected} tone="green" />
                <CountStrip title="Will be deleted" values={previewData?.deletable} tone="red" />
              </div>
              <div className="module-notice danger">
                <AlertTriangle />
                <span>This permanently removes eligible alerts from the BMB dashboard database. Back up PostgreSQL first. Type <strong>{expectedConfirmation}</strong> to authorize the run.</span>
              </div>
              <label style={{ display:'grid', gap:6, maxWidth:460 }}>
                <span>Deletion confirmation</span>
                <input value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={expectedConfirmation} autoComplete="off" />
              </label>
              <div style={{ display:'flex', gap:8 }}>
                <button type="button" className="primary-action" onClick={preview} disabled={working}>{working ? 'Working…' : 'Refresh preview'}</button>
                <button type="button" className="danger-action" onClick={purge} disabled={working || confirmation !== expectedConfirmation}><Trash2 />Delete eligible dashboard alerts</button>
              </div>
            </div>
          </section>

          <section className="module-panel" style={{ marginTop:10 }}>
            <div className="panel-heading"><div><FileClock /><span><strong>Retention ledger</strong><small>Recent preview and deletion runs</small></span></div></div>
            <div className="module-table-wrap">
              <table className="module-table">
                <thead><tr><th>Run</th><th>Mode</th><th>Status</th><th>Deleted</th><th>Protected</th><th>Finished</th></tr></thead>
                <tbody>
                  {(governance.recent_retention_runs || []).map(run => (
                    <tr key={run.id}>
                      <td><strong>#{run.id}</strong>{run.dry_run && <small>Preview</small>}</td>
                      <td>{run.mode === 'initial_7_day_purge' ? 'Initial 7-day purge' : 'Severity policy'}</td>
                      <td><StatusBadge tone={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'critical' : 'attention'}>{run.status}</StatusBadge></td>
                      <td>{count(run.deleted_counts?.total)}</td>
                      <td>{count(run.protected_counts?.total)}</td>
                      <td>{timestamp(run.finished_at)}</td>
                    </tr>
                  ))}
                  {!governance.recent_retention_runs?.length && <tr><td colSpan="6">No retention runs have been recorded.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
