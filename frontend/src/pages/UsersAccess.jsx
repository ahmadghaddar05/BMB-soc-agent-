import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Clock3, KeyRound, Loader2, LockKeyhole, RefreshCw, ShieldCheck,
  Trash2, UserPlus, UserRoundCog, UsersRound, X,
} from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import { api } from '../lib/api';

const ROLE_OPTIONS = Object.freeze([
  { value:'executive', label:'Executive', description:'Business risk, decisions, and executive reports' },
  { value:'soc_analyst', label:'SOC Analyst', description:'Monitoring, triage, investigations, incidents, and cases' },
  { value:'administrator', label:'Security Administrator', description:'Integrations, access, governance, and platform settings' },
]);

function timestamp(value, fallback = 'Never') {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toLocaleString();
}

function roleLabel(role) {
  return ROLE_OPTIONS.find(option => option.value === role)?.label || role || 'Unknown role';
}

function initialForm() {
  return { display_name:'', username:'', role:'soc_analyst', password:'' };
}

export default function UsersAccess() {
  const [runtime, setRuntime] = useState(null);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [runtimeValue, directoryValue] = await Promise.all([
        api('/admin/runtime'),
        api('/admin/users'),
      ]);
      setRuntime(runtimeValue);
      setUsers(directoryValue.users || []);
    } catch (loadError) {
      setError(loadError.message || 'The user directory could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const authentication = runtime?.authentication;
  const activeUsers = useMemo(() => users.filter(user => user.active), [users]);
  const roleCounts = useMemo(() => Object.fromEntries(
    ROLE_OPTIONS.map(option => [option.value, activeUsers.filter(user => user.role === option.value).length])
  ), [activeUsers]);

  async function createUser(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await api('/admin/users', {
        method:'POST',
        body:JSON.stringify(form),
      });
      setUsers(current => [...current, result.user].sort((a, b) => a.username.localeCompare(b.username)));
      setForm(initialForm());
      setNotice(`${result.user.display_name} was created as ${roleLabel(result.user.role)}.`);
    } catch (createError) {
      setError(createError.message || 'The account could not be created.');
    } finally {
      setSaving(false);
    }
  }

  async function removeUser() {
    if (!pendingDelete) return;
    setDeleting(true);
    setError('');
    setNotice('');
    try {
      await api(`/admin/users/${pendingDelete.id}`, { method:'DELETE', body:'{}' });
      setUsers(current => current.filter(user => user.id !== pendingDelete.id));
      setNotice(`${pendingDelete.display_name} was removed. Existing browser sessions for that account are no longer valid.`);
      setPendingDelete(null);
    } catch (deleteError) {
      setError(deleteError.message || 'The account could not be removed.');
    } finally {
      setDeleting(false);
    }
  }

  const developmentMode = authentication?.mode === 'development_disabled';

  return (
    <div className="module-page">
      <div className="module-hero compact">
        <div>
          <span className="eyebrow"><UserRoundCog />Identity administration</span>
          <h2>Users &amp; Access</h2>
          <p>Create role-bound accounts and control who can enter each BMB workspace.</p>
        </div>
        <button type="button" className="ghost-action" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} />Refresh directory
        </button>
      </div>

      {error && <div className="module-notice danger" role="alert"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X /></button></div>}
      {notice && <div className="module-notice success" role="status"><ShieldCheck /><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Dismiss message"><X /></button></div>}

      {loading && !runtime ? (
        <section className="module-panel"><div className="module-empty small" role="status"><RefreshCw className="animate-spin" /><strong>Loading user directory</strong><span>Reading server-managed accounts and roles.</span></div></section>
      ) : (
        <>
          <div className={`module-notice${developmentMode ? ' danger' : ''}`} role="status">
            {developmentMode ? <LockKeyhole /> : <ShieldCheck />}
            <span>{developmentMode
              ? 'Authentication is disabled in this development runtime. User records cannot protect access until authentication is enabled.'
              : 'Roles are assigned here and enforced by the API. Users sign in through one login page and are redirected automatically to their authorized workspace.'}</span>
          </div>

          <div className="module-metrics">
            <article className="metric-card tone-blue"><span><UsersRound /></span><div><small>Active accounts</small><strong>{activeUsers.length}</strong></div></article>
            <article className="metric-card tone-green"><span><UserRoundCog /></span><div><small>SOC analysts</small><strong>{roleCounts.soc_analyst || 0}</strong></div></article>
            <article className="metric-card tone-purple"><span><ShieldCheck /></span><div><small>Administrators</small><strong>{roleCounts.administrator || 0}</strong></div></article>
            <article className="metric-card tone-orange"><span><Clock3 /></span><div><small>Session lifetime</small><strong>{authentication?.session_ttl_minutes ? `${authentication.session_ttl_minutes} min` : 'Unavailable'}</strong></div></article>
          </div>

          <div className="access-layout">
            <section className="module-panel access-create-panel">
              <div className="panel-heading">
                <div><UserPlus /><span><strong>Add a user</strong><small>The selected role determines navigation, landing page, and API permissions.</small></span></div>
              </div>
              <form className="access-form" onSubmit={createUser}>
                <label>
                  Full name
                  <input
                    value={form.display_name}
                    onChange={event => setForm(current => ({ ...current, display_name:event.target.value }))}
                    maxLength={120}
                    placeholder="e.g. Maya Georges"
                    required
                  />
                </label>
                <label>
                  Username
                  <input
                    value={form.username}
                    onChange={event => setForm(current => ({ ...current, username:event.target.value }))}
                    minLength={3}
                    maxLength={64}
                    pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,63}"
                    autoComplete="off"
                    placeholder="e.g. maya.georges"
                    required
                  />
                  <small>Letters, numbers, dots, underscores, and hyphens</small>
                </label>
                <label>
                  Role
                  <select value={form.role} onChange={event => setForm(current => ({ ...current, role:event.target.value }))}>
                    {ROLE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <small>{ROLE_OPTIONS.find(option => option.value === form.role)?.description}</small>
                </label>
                <label>
                  Initial password
                  <input
                    type="password"
                    value={form.password}
                    onChange={event => setForm(current => ({ ...current, password:event.target.value }))}
                    minLength={12}
                    maxLength={256}
                    autoComplete="new-password"
                    placeholder="At least 12 characters"
                    required
                  />
                </label>
                <div className="access-form-boundary"><KeyRound /><span>Password hashes are stored using scrypt. The original password cannot be viewed after creation.</span></div>
                <button type="submit" className="primary-action access-submit" disabled={saving || developmentMode}>
                  {saving ? <Loader2 className="animate-spin" /> : <UserPlus />}
                  {saving ? 'Creating account…' : 'Create role-bound account'}
                </button>
              </form>
            </section>

            <section className="module-panel access-directory-panel">
              <div className="panel-heading">
                <div><UsersRound /><span><strong>Managed users</strong><small>{users.length} account{users.length === 1 ? '' : 's'} · passwords are never returned</small></span></div>
                <StatusBadge tone={developmentMode ? 'attention' : 'success'}>{developmentMode ? 'Development bypass' : 'RBAC enforced'}</StatusBadge>
              </div>
              <div className="module-table-wrap">
                <table className="module-table access-table">
                  <thead><tr><th>User</th><th>Role</th><th>Last sign-in</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {users.map(user => {
                      const currentUser = String(user.id) === String(authentication?.current_user_id);
                      return (
                        <tr key={user.id}>
                          <td><strong>{user.display_name}</strong><small>@{user.username}{currentUser ? ' · You' : ''}</small></td>
                          <td><strong>{roleLabel(user.role)}</strong><small>{user.active ? 'Active account' : 'Inactive account'}</small></td>
                          <td><strong>{timestamp(user.last_login_at)}</strong><small>Server-recorded authentication</small></td>
                          <td><strong>{timestamp(user.created_at, 'Not reported')}</strong><small>By {user.created_by || 'system'}</small></td>
                          <td>
                            <button
                              type="button"
                              className="access-remove"
                              onClick={() => setPendingDelete(user)}
                              disabled={currentUser}
                              title={currentUser ? 'You cannot remove your own account' : `Remove ${user.display_name}`}
                              aria-label={currentUser ? 'Current account cannot be removed' : `Remove ${user.display_name}`}
                            >
                              <Trash2 />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {!users.length && <tr><td colSpan="5"><div className="module-empty small"><UsersRound /><strong>No managed users were returned</strong><span>Bootstrap an administrator before enabling authentication.</span></div></td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}

      {pendingDelete && (
        <div className="access-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !deleting) setPendingDelete(null); }}>
          <section className="access-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-user-title">
            <div className="access-dialog-icon"><Trash2 /></div>
            <div>
              <span className="eyebrow">Remove access</span>
              <h3 id="remove-user-title">Remove {pendingDelete.display_name}?</h3>
              <p>The account <strong>@{pendingDelete.username}</strong> will be deleted and its active BMB sessions will be rejected immediately. Historical audit records remain available.</p>
            </div>
            <div className="access-dialog-actions">
              <button type="button" className="ghost-action" onClick={() => setPendingDelete(null)} disabled={deleting}>Cancel</button>
              <button type="button" className="danger-action" onClick={removeUser} disabled={deleting}>
                {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                {deleting ? 'Removing…' : 'Remove user'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
