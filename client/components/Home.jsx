import { useEffect, useRef, useState } from 'react';
import { api, ACCEPTED_FILES, ACCEPTED_LABEL } from '../api.js';
import { navigate } from '../router.js';
import { Avatar, RoleTag, UserMenu, Wordmark, timeAgo } from './common.jsx';
import { useToast } from './Toast.jsx';
import { useDialog } from './Dialog.jsx';

export default function Home({ user, onSignOut }) {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);
  const dragDepth = useRef(0);
  const toast = useToast();
  const dialog = useDialog();

  const load = () => api.listDocs().then(setDocs).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const create = async () => {
    setBusy(true);
    try {
      const doc = await api.createDoc();
      navigate(`#/doc/${doc.id}`);
    } catch (e) {
      toast(`Couldn’t create a document. ${e.message}`, 'error');
      setBusy(false);
    }
  };

  const importFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const doc = await api.importDoc(file);
      toast(`Imported ${file.name}`, 'success');
      navigate(`#/doc/${doc.id}`);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  };

  const remove = async (doc) => {
    const ok = await dialog.confirm({
      title: `Delete “${doc.title}”?`,
      message: doc.shareCount
        ? `It’s shared with ${doc.shareCount} ${doc.shareCount === 1 ? 'person' : 'people'}, who will lose access. This can’t be undone.`
        : 'This can’t be undone.',
      confirmLabel: 'Delete document',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteDoc(doc.id);
      toast(`Deleted “${doc.title}”`, 'success');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div
      className="home"
      onDragEnter={(e) => { e.preventDefault(); dragDepth.current += 1; setDragging(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => { dragDepth.current -= 1; if (dragDepth.current <= 0) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); importFile(e.dataTransfer.files[0]); }}
    >
      <header className="appbar">
        <Wordmark asLink />
        <UserMenu user={user} onSignOut={onSignOut} />
      </header>

      <main className="library">
        <div className="library-head">
          <h1>Documents</h1>
          <div className="library-actions">
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>Import a file</button>
            <button className="btn btn-primary" onClick={create} disabled={busy}>New document</button>
            <input ref={fileRef} type="file" accept={ACCEPTED_FILES} hidden
              onChange={(e) => { importFile(e.target.files[0]); e.target.value = ''; }} />
          </div>
        </div>
        <p className="hint">Import a {ACCEPTED_LABEL} to turn it into a document you can edit, or drop one onto this page.</p>

        {error && <p className="form-error" role="alert">Couldn’t load your documents. {error}</p>}
        {!docs && !error && <div className="ledger-loading" aria-label="Loading"><span /><span /><span /></div>}

        {docs && (
          <>
            <Ledger
              title="Owned by you"
              docs={docs.owned}
              user={user}
              onDelete={remove}
              empty={
                <>
                  You haven’t written anything yet.{' '}
                  <button className="text-btn" onClick={create} disabled={busy}>Start a new document</button>
                </>
              }
            />
            <Ledger
              title="Shared with you"
              docs={docs.shared}
              user={user}
              empty="Documents other people share with you will appear here."
            />
          </>
        )}
      </main>

      {dragging && (
        <div className="dropzone" aria-hidden>
          <p>Drop to import</p>
          <span>{ACCEPTED_LABEL}</span>
        </div>
      )}
    </div>
  );
}

function Ledger({ title, docs, user, empty, onDelete }) {
  return (
    <section className="ledger" aria-label={title}>
      <h2>{title} <span className="ledger-count">{docs.length}</span></h2>
      {docs.length === 0 ? (
        <p className="ledger-empty">{empty}</p>
      ) : (
        <ul>
          <li className="row row-head" aria-hidden>
            <span>Title</span><span>Owner</span><span>Access</span><span>Edited</span><span />
          </li>
          {docs.map((d) => (
            <li key={d.id} className="row">
              <a className="row-link" href={`#/doc/${d.id}`}>
                <span className="row-title">{d.title}</span>
                <span className="row-sub">
                  {d.source ? `Imported from ${d.source}` : d.lastEditedBy && d.lastEditedBy.id !== user.id
                    ? `Last edited by ${d.lastEditedBy.name.split(' ')[0]}` : 'Edited by you'}
                </span>
              </a>
              <span className="row-owner">
                {d.role === 'owner' ? <span className="muted">You</span> : (
                  <><Avatar user={d.owner} size={22} /> {d.owner.name}</>
                )}
              </span>
              <span className="row-role"><RoleTag role={d.role} /></span>
              <span className="row-time">{timeAgo(d.updatedAt)}</span>
              <span className="row-actions">
                {onDelete && (
                  <button className="icon-btn" title="Delete document" aria-label={`Delete ${d.title}`} onClick={() => onDelete(d)}>
                    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L14 6" /></svg>
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
