import { KeyRound, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';

export default function LoginPage({ onAuthenticated }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await api('/auth/login', {
        method:'POST',
        body:JSON.stringify({ username:username.trim(), password }),
      });
      onAuthenticated(session);
    } catch (loginError) {
      setError(loginError.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-layout" aria-labelledby="login-heading">
        <div className="login-story">
          <div className="login-brand">
            <span className="login-brand-mark" aria-hidden="true"><ShieldCheck /></span>
            <span><small>BMB Security Operations</small><strong>Secure operations platform</strong></span>
          </div>
          <span className="login-eyebrow">Identity-protected access</span>
          <h1 id="login-heading">One secure entry point.<br />The right workspace automatically.</h1>
          <p>Your account role is assigned by a security administrator. After authentication, BMB opens only the executive, SOC analyst, or administration experience authorized for your account.</p>
          <div className="login-assurance">
            <LockKeyhole />
            <span><strong>Server-enforced RBAC</strong><small>Roles cannot be selected or changed from this login page.</small></span>
          </div>
        </div>

        <form className="login-card unified" onSubmit={submit}>
          <div className="login-mark"><KeyRound /></div>
          <div className="login-card-heading">
            <small>Authorized users</small>
            <h2>Sign in to BMB</h2>
            <p>Enter the credentials provisioned by your security administrator.</p>
          </div>
          {error && <div className="login-error" role="alert">{error}</div>}
          <label>
            Username
            <input
              autoComplete="username"
              value={username}
              onChange={event => setUsername(event.target.value)}
              maxLength={64}
              required
              autoFocus
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              maxLength={256}
              required
            />
          </label>
          <button disabled={busy || !username.trim() || !password}>
            {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
            {busy ? 'Verifying access…' : 'Sign in securely'}
          </button>
          <p className="login-help">Your role and landing page are determined by your server-side account. Contact a security administrator for access changes.</p>
        </form>
      </section>
    </main>
  );
}
