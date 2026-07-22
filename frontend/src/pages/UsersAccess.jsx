import { useCallback, useEffect, useState } from 'react';
import { Clock3, KeyRound, LockKeyhole, RefreshCw, ShieldCheck, UserRoundCog, UsersRound } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import { api } from '../lib/api';

function timestamp(value) {
  if (!value) return 'Not reported';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Not reported' : parsed.toLocaleString();
}

function modeLabel(mode) {
  if (mode === 'single_user') return 'Single environment-managed account';
  if (mode === 'development_disabled') return 'Authentication disabled for development';
  return mode ? String(mode).replaceAll('_', ' ') : 'Not reported';
}

export default function UsersAccess() {
  const [runtime, setRuntime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRuntime(await api('/admin/runtime'));
    } catch (loadError) {
      setError(loadError.message || 'Access configuration could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const authentication = runtime?.authentication;
  const developmentMode = authentication?.mode === 'development_disabled';

  return (
    <div className="module-page">
      <div className="module-hero compact">
        <div>
          <span className="eyebrow"><UserRoundCog />Identity administration</span>
          <h2>Users &amp; Access</h2>
          <p>Read-only access posture reported by the running server. Credentials and secrets are never displayed.</p>
        </div>
        <button type="button" className="primary-action" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} />Refresh
        </button>
      </div>

      {error && <div className="module-notice danger" role="alert"><span>{error}</span><button type="button" onClick={load} disabled={loading}>Retry</button></div>}

      {loading && !runtime ? (
        <section className="module-panel"><div className="module-empty small" role="status"><RefreshCw className="animate-spin" /><strong>Loading access posture</strong><span>Reading the server-side authentication configuration.</span></div></section>
      ) : authentication ? (
        <>
          <div className={`module-notice${developmentMode ? ' danger' : ''}`} role="status">
            {developmentMode ? <LockKeyhole /> : <ShieldCheck />}
            <span>{developmentMode
              ? 'Authentication is disabled in this development runtime. This is not a production-ready access posture.'
              : 'This deployment authenticates one environment-managed account. User creation, deletion, password changes, and role assignment are not supported in this interface.'}</span>
          </div>

          <div className="module-metrics">
            <article className="metric-card tone-blue"><span><UsersRound /></span><div><small>Directory model</small><strong>{authentication.multi_user_directory_supported ? 'Multi-user' : 'Single-user'}</strong></div></article>
            <article className="metric-card tone-purple"><span><UserRoundCog /></span><div><small>Configured role</small><strong>{authentication.configured_role || 'Not reported'}</strong></div></article>
            <article className="metric-card tone-green"><span><Clock3 /></span><div><small>Session lifetime</small><strong>{Number.isFinite(Number(authentication.session_ttl_minutes)) ? `${authentication.session_ttl_minutes} min` : 'Not reported'}</strong></div></article>
            <article className="metric-card tone-orange"><span><KeyRound /></span><div><small>Service API key</small><strong>{authentication.service_api_key_configured ? 'Configured' : 'Not configured'}</strong></div></article>
          </div>

          <section className="module-panel">
            <div className="panel-heading"><div><UserRoundCog /><span><strong>Current access model</strong><small>Runtime snapshot generated {timestamp(runtime.generated_at)}</small></span></div><StatusBadge tone={developmentMode ? 'attention' : 'neutral'}>{modeLabel(authentication.mode)}</StatusBadge></div>
            <div className="module-table-wrap">
              <table className="module-table">
                <thead><tr><th>Account</th><th>Effective role</th><th>Provisioning</th><th>Management boundary</th></tr></thead>
                <tbody><tr>
                  <td><strong>{authentication.current_user || 'Not reported'}</strong><small>Authenticated session account</small></td>
                  <td><strong>{authentication.current_role || 'Not reported'}</strong><small>Reported by the server session</small></td>
                  <td><strong>Environment configuration</strong><small>Not stored in a UI-managed directory</small></td>
                  <td><strong>Read-only in this application</strong><small>No account CRUD or password controls</small></td>
                </tr></tbody>
              </table>
            </div>
          </section>

          <section className="module-panel" style={{ marginTop:10 }}>
            <div className="panel-heading"><div><ShieldCheck /><span><strong>Authentication controls</strong><small>Configuration presence, not an external compliance certification</small></span></div></div>
            <div className="module-table-wrap">
              <table className="module-table">
                <thead><tr><th>Control</th><th>Reported state</th><th>Interpretation</th></tr></thead>
                <tbody>
                  <tr><td><strong>Secure session cookie</strong></td><td><StatusBadge tone={authentication.secure_cookie ? 'success' : 'attention'}>{authentication.secure_cookie ? 'Enabled' : 'Disabled'}</StatusBadge></td><td>{authentication.secure_cookie ? 'The runtime reports the Secure cookie flag enabled.' : 'The runtime reports the Secure cookie flag disabled.'}</td></tr>
                  <tr><td><strong>Allowed origins</strong></td><td><strong>{Number(authentication.allowed_origins_count || 0)}</strong></td><td>Count of configured origins; origin values are not disclosed here.</td></tr>
                  <tr><td><strong>Service API credential</strong></td><td><StatusBadge tone={authentication.service_api_key_configured ? 'success' : 'neutral'}>{authentication.service_api_key_configured ? 'Configured' : 'Not configured'}</StatusBadge></td><td>Only credential presence is reported. The credential value is never returned.</td></tr>
                  <tr><td><strong>Multi-user directory</strong></td><td><StatusBadge tone="neutral">{authentication.multi_user_directory_supported ? 'Supported' : 'Not supported'}</StatusBadge></td><td>{authentication.multi_user_directory_supported ? 'A server-managed directory is available.' : 'This build does not provide a server-managed user directory.'}</td></tr>
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : !error ? (
        <section className="module-panel"><div className="module-empty"><UsersRound /><strong>Access posture was not returned</strong><span>The server response did not include authentication configuration.</span><button type="button" onClick={load}>Retry</button></div></section>
      ) : null}
    </div>
  );
}
