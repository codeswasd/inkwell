import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Avatar } from './common.jsx';
import { useToast } from './Toast.jsx';

export default function ShareDialog({ doc, owner, shares, onChange, onClose }) {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const ref = useRef(null);

  useEffect(() => {
    api.users().then(setUsers).catch(() => {});
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector('input')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sharedIds = new Set(shares.map((s) => s.id));
  const suggestions = users.filter((u) => !sharedIds.has(u.id));

  const grant = async (e, target = email) => {
    e?.preventDefault();
    const value = target.trim();
    if (!value) return setError('Enter an email address.');
    if (!/^\S+@\S+\.\S+$/.test(value)) return setError('Enter a full email address, like carol@ajaia.dev.');
    setBusy(true);
    setError('');
    try {
      const added = await api.share(doc.id, value, role);
      onChange([...shares.filter((s) => s.id !== added.id), added].sort((a, b) => a.name.localeCompare(b.name)));
      setEmail('');
      toast(`Shared with ${added.name}`, 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (s, newRole) => {
    try {
      await api.share(doc.id, s.email, newRole);
      onChange(shares.map((x) => (x.id === s.id ? { ...x, role: newRole } : x)));
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const revoke = async (s) => {
    try {
      await api.unshare(doc.id, s.id);
      onChange(shares.filter((x) => x.id !== s.id));
      toast(`Removed ${s.name}`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title" ref={ref}>
        <header className="modal-head">
          <h2 id="share-title">Share “{doc.title}”</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <form className="share-form" onSubmit={grant} noValidate>
          <input
            type="email"
            list="share-users"
            placeholder="Add people by email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(''); }}
          />
          <datalist id="share-users">
            {suggestions.map((u) => <option key={u.id} value={u.email}>{u.name}</option>)}
          </datalist>
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Access level">
            <option value="editor">Can edit</option>
            <option value="viewer">Can view</option>
          </select>
          <button className="btn btn-primary" disabled={busy}>Share</button>
        </form>
        {error && <p className="form-error" role="alert">{error}</p>}

        {suggestions.length > 0 && (
          <div className="suggest">
            <span className="suggest-label">Suggested</span>
            {suggestions.map((u) => (
              <button key={u.id} className="suggest-pill" onClick={() => grant(null, u.email)} disabled={busy}>
                <Avatar user={u} size={18} /> {u.name.split(' ')[0]}
              </button>
            ))}
          </div>
        )}

        <h3 className="modal-sub">Who has access</h3>
        <ul className="people">
          <li>
            <Avatar user={owner} size={32} />
            <div className="people-meta"><strong>{owner.name} <span className="muted">(you)</span></strong><small>{owner.email}</small></div>
            <span className="people-role">Owner</span>
          </li>
          {shares.map((s) => (
            <li key={s.id}>
              <Avatar user={s} size={32} />
              <div className="people-meta"><strong>{s.name}</strong><small>{s.email}</small></div>
              <select value={s.role} onChange={(e) => changeRole(s, e.target.value)} aria-label={`Access for ${s.name}`}>
                <option value="editor">Can edit</option>
                <option value="viewer">Can view</option>
              </select>
              <button className="icon-btn" onClick={() => revoke(s)} title="Remove access" aria-label={`Remove ${s.name}`}>✕</button>
            </li>
          ))}
        </ul>
        <p className="hint">People who can edit can change the text and title. People who can view can read and export. Only you can share or delete this document.</p>
      </div>
    </div>
  );
}
