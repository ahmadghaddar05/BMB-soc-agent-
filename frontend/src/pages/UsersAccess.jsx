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
  if (mode === 'environment_managed_roles') return 'Environment-managed role accounts';
  if (mode === 'development_disabled') return 'Authentication disabled for development';
  return mode ? String(mode).replaceAll('_', ' ') : 'Not reported';
}

function roleLabel(role) {
  if (role === 'soc_analyst') return 'SOC Analyst';
  if (role === 'administrator') return 'Security Administrator';
  if (role === 'executive') return 'Executive';
  return role || 'Not reported';
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
  const accounts = authentication?.configured_accounts || [];

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
              : 'This deployment uses three environment-managed role accounts. Every account receives a fixed server-side role; credentials and role assignments cannot be changed in the browser.'}</span>
          </div>

          <div className="module-metrics">
            <article className="metric-card tone-blue"><span><UsersRound /></span><div><small>Protected accounts</small><strong>{accounts.length || 'Not reported'}</strong></div></article>
            <article className="metric-card tone-purple"><span><UserRoundCog /></span><div><small>Current role</small><strong>{roleLabel(authentication.current_role)}</strong></div></article>
            <article className="metric-card tone-green"><span><Clock3 /></span><div><small>Session lifetime</small><strong>{Number.isFinite(Number(authentication.session_ttl_minutes)) ? `${authentication.session_ttl_minutes} min` : 'Not reported'}</strong></div></article>
            <article className="metric-card tone-orange"><span><KeyRound /></span><div><small>Service API key</small><strong>{authentication.service_api_key_configured ? 'Configured' : 'Not configured'}</strong></div></article>
          </div>

          <section className="module-panel">
            <div className="panel-heading"><div><UserRoundCog /><span><strong>Current access model</strong><small>Runtime snapshot generated {timestamp(runtime.generated_at)}</small></span></div><StatusBadge tone={developmentMode ? 'attention' : 'neutral'}>{modeLabel(authentication.mode)}</StatusBadge></div>
            <div className="module-table-wrap">
              <table className="module-table">
                <thead><tr><th>Account</th><th>Effective role</th><th>Provisioning</th><th>Management boundary</th></tr></thead>
                <tbody>{accounts.map(account => <tr key={account.role}>
                  <td><strong>{account.username || 'Not reported'}</strong><small>{account.username === authentication.current_user ? 'Current authenticated account' : 'Configured role account'}</small></td>
                  <td><strong>{roleLabel(account.role)}</strong><small>Assigned by the authentication server</small></td>
                  <td><strong>{account.configured ? 'Environment configured' : 'Incomplete'}</strong><small>Credential value is never returned</small></td>
                  <td><strong>Read-only in this application</strong><small>Update server environment to rotate credentials</small></td>
                </tr>)}</tbody>
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
                  <tr><td><strong>Role separation</strong></td><td><StatusBadge tone={authentication.multi_role_accounts_supported ? 'success' : 'attention'}>{authentication.multi_role_accounts_supported ? 'Enforced' : 'Unavailable'}</StatusBadge></td><td>Each dashboard account has one fixed role and a separate credential pair.</td></tr>
                  <tr><td><strong>Managed user directory</strong></td><td><StatusBadge tone="neutral">{authentication.multi_user_directory_supported ? 'Supported' : 'Not connected'}</StatusBadge></td><td>{authentication.multi_user_directory_supported ? 'A server-managed directory is available.' : 'Accounts are environment-managed; this is not an LDAP or identity-provider directory.'}</td></tr>
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
