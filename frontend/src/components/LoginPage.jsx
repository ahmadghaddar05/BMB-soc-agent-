import { useEffect, useState } from 'react';
import { ArrowLeft, BriefcaseBusiness, KeyRound, Loader2, ShieldCheck, UserRoundCheck, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { ROLES } from '../lib/roles';

export const LOGIN_PORTALS = Object.freeze({
  [ROLES.EXECUTIVE]: {
    path:'/login/executive',
    eyebrow:'Executive access',
    title:'Executive security briefing',
    description:'Sign in to review business risk, security performance, decisions, and executive reports.',
    icon:BriefcaseBusiness,
    accent:'executive',
  },
  [ROLES.SOC_ANALYST]: {
    path:'/login/soc-analyst',
    eyebrow:'Security operations',
    title:'SOC analyst workspace',
    description:'Sign in to monitor alerts, investigate evidence, manage incidents, and review response proposals.',
    icon:UserRoundCheck,
    accent:'analyst',
  },
  [ROLES.ADMINISTRATOR]: {
    path:'/login/administrator',
    eyebrow:'Platform administration',
    title:'Security administrator console',
    description:'Sign in to manage integrations, collection health, AI configuration, access, and governance.',
    icon:Wrench,
    accent:'administrator',
  },
});

function PortalChooser() {
  return (
    <main className="login-page">
      <section className="login-chooser" aria-labelledby="login-heading">
        <div className="login-brand"><span className="login-brand-mark" aria-hidden="true"><ShieldCheck /></span><span><small>BMB Security Operations</small><strong>Secure access portal</strong></span></div>
        <div className="login-intro">
          <span>Role-protected workspaces</span>
          <h1 id="login-heading">Choose your authorized workspace</h1>
          <p>Each portal requires its own credentials. Your permissions are assigned by the server and cannot be changed from the dashboard.</p>
        </div>
        <div className="login-portals">
          {Object.entries(LOGIN_PORTALS).map(([role, portal]) => {
            const Icon = portal.icon;
            return (
              <Link key={role} to={portal.path} className={`login-portal-card ${portal.accent}`}>
                <span className="login-portal-icon"><Icon /></span>
                <span><small>{portal.eyebrow}</small><strong>{portal.title}</strong><p>{portal.description}</p></span>
                <span className="login-portal-action">Continue <span aria-hidden="true">→</span></span>
              </Link>
            );
          })}
        </div>
        <p className="login-security-note"><ShieldCheck /> Access attempts are validated against the selected role and protected by secure server sessions.</p>
      </section>
    </main>
  );
}

export default function LoginPage({ portalRole, onAuthenticated }) {
  const portal = LOGIN_PORTALS[portalRole];
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setUsername('');
    setPassword('');
    setError('');
  }, [portalRole]);

  if (!portal) return <PortalChooser />;
  const PortalIcon = portal.icon;

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await api('/auth/login', {
        method:'POST',
        body:JSON.stringify({ username:username.trim(), password, portal_role:portalRole }),
      });
      onAuthenticated(session);
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className={`login-card ${portal.accent}`} onSubmit={submit}>
        <Link className="login-back" to="/login"><ArrowLeft /> All secure portals</Link>
        <div className="login-mark"><PortalIcon /></div>
        <div className="login-card-heading">
          <small>{portal.eyebrow}</small>
          <h1>{portal.title}</h1>
          <p>{portal.description}</p>
        </div>
        <div className="login-role-boundary"><ShieldCheck /><span><strong>Role-locked session</strong><small>These credentials can open only this authorized experience.</small></span></div>
        {error && <div className="login-error" role="alert">{error}</div>}
        <label>Username<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required autoFocus /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
        <button disabled={busy || !username.trim() || !password}>{busy ? <Loader2 className="animate-spin" /> : <KeyRound />}{busy ? 'Signing in…' : 'Sign in securely'}</button>
        <p className="login-help">Use the username and password provisioned for this role. Contact a security administrator if access is denied.</p>
      </form>
    </main>
  );
}
