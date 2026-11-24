import { useState } from 'react';
import { api, IS_DEMO } from '../api.js';
import { Avatar, Wordmark } from './common.jsx';

const DEMO = [
  { id: 'a', name: 'Alice Chen', email: 'alice@ajaia.dev', color: '#c4a7ff', note: 'Owns “Q3 Launch Plan” and shares it with Bob' },
  { id: 'b', name: 'Bob Rivera', email: 'bob@ajaia.dev', color: '#7cc7ff', note: 'Can edit Alice’s plan' },
  { id: 'c', name: 'Carol Okafor', email: 'carol@ajaia.dev', color: '#ffb07a', note: 'New here — nothing shared yet' },
];
const DEMO_PASSWORD = 'demo1234';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [manual, setManual] = useState(false);

  const signIn = async (creds, who = 'form') => {
    if (!creds.email || !creds.password) return setError('Enter your email and password.');
    setBusy(who);
    setError('');
    try {
      onLogin(await api.login(creds.email, creds.password));
    } catch (err) {
      setError(err.status === 401 ? 'That email and password don’t match a demo account.' : err.message);
      setBusy(null);
    }
  };

  return (
    <main className="login">
      <section className="login-specimen" aria-hidden>
        <Wordmark />
        <div className="specimen-sheet">
          <p className="specimen-title">Q3 Launch Plan</p>
          <p>We ship the editor beta to three pilot teams in September. Each team gets a shared workspace, and owners decide who can read and who can edit.</p>
          <ul>
            <li>Import existing notes from Word or Markdown</li>
            <li>Share with a teammate in one step</li>
          </ul>
          <p>Bob is reviewing the timeline<span className="specimen-cursor" /></p>
        </div>
        <p className="specimen-foot">Shared documents for the Ajaia team.</p>
      </section>

      <section className="login-panel">
        <div className="login-panel-inner">
          <h1>Sign in</h1>
          <p className="muted">Pick a demo account. Open a second account in a private window to try sharing.</p>

          <ul className="account-list">
            {DEMO.map((u) => (
              <li key={u.id}>
                <button
                  className="account"
                  disabled={Boolean(busy)}
                  onClick={() => signIn({ email: u.email, password: DEMO_PASSWORD }, u.id)}
                >
                  <Avatar user={u} size={36} title="" />
                  <span className="account-text">
                    <span className="account-name">{u.name}</span>
                    <span className="account-note">{u.note}</span>
                  </span>
                  <span className="account-action">{busy === u.id ? 'Signing in…' : 'Sign in'}</span>
                </button>
              </li>
            ))}
          </ul>

          {!manual ? (
            <button className="text-btn" onClick={() => setManual(true)}>Use email and password instead</button>
          ) : (
            <form
              className="login-form"
              noValidate
              onSubmit={(e) => { e.preventDefault(); signIn({ email, password }); }}
            >
              <label>
                Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus />
              </label>
              <label>
                Password
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </label>
              <button className="btn btn-primary" disabled={Boolean(busy)}>{busy === 'form' ? 'Signing in…' : 'Sign in'}</button>
              <p className="hint">Every demo account uses the password <strong>{DEMO_PASSWORD}</strong>.</p>
            </form>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          {IS_DEMO && (
            <p className="demo-note">This preview runs entirely in your browser, and documents are saved on this device only. The deployed app uses a real server and database.</p>
          )}
        </div>
      </section>
    </main>
  );
}
