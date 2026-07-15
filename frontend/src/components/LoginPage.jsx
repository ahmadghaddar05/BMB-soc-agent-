import { useState } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';

export default function LoginPage({ onAuthenticated }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
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
      <form className="login-card" onSubmit={submit}>
        <div className="login-mark"><ShieldCheck /></div>
        <div><small>BMB AI-SOC</small><h1>Analyst sign in</h1><p>Authenticate to access security evidence and operational controls.</p></div>
        {error && <div className="login-error" role="alert">{error}</div>}
        <label>Username<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
        <button disabled={busy || !username || !password}>{busy ? <Loader2 className="animate-spin" /> : <KeyRound />}{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
