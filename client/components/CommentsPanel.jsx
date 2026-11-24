import { useEffect, useRef, useState } from 'react';
import { Avatar, timeAgo } from './common.jsx';

export default function CommentsPanel({
  comments, user, role, draft, activeId, orphanIds,
  onSubmitDraft, onCancelDraft, onReply, onResolve, onDelete, onSelect, onClose,
}) {
  const [showResolved, setShowResolved] = useState(false);
  const open = comments.items.filter((c) => !c.resolved);
  const resolved = comments.items.filter((c) => c.resolved);
  const canEdit = role !== 'viewer';

  return (
    <aside className="panel" aria-label="Comments">
      <header className="panel-head">
        <h2>Comments</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close comments">
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg>
        </button>
      </header>

      <div className="panel-body">
        {draft && (
          <Composer
            key={draft.key}
            quote={draft.quote}
            placeholder={canEdit ? 'Add a comment' : 'Add a comment (you can view, so it won’t highlight the text)'}
            submitLabel="Comment"
            autoFocus
            onSubmit={onSubmitDraft}
            onCancel={onCancelDraft}
          />
        )}

        {open.length === 0 && !draft && (
          <div className="panel-empty">
            <p>No open comments.</p>
            <p className="hint">Select some text and choose <strong>Comment</strong>, or press <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>M</kbd>.</p>
          </div>
        )}

        <ul className="threads">
          {open.map((c) => (
            <Thread key={c.id} c={c} user={user} role={role} active={c.id === activeId} orphan={orphanIds.has(c.id)}
              onReply={onReply} onResolve={onResolve} onDelete={onDelete} onSelect={onSelect} />
          ))}
        </ul>

        {resolved.length > 0 && (
          <div className="resolved">
            <button className="text-btn" onClick={() => setShowResolved((v) => !v)} aria-expanded={showResolved}>
              {showResolved ? 'Hide' : 'Show'} {resolved.length} resolved {resolved.length === 1 ? 'comment' : 'comments'}
            </button>
            {showResolved && (
              <ul className="threads">
                {resolved.map((c) => (
                  <Thread key={c.id} c={c} user={user} role={role} active={false} orphan={false}
                    onReply={onReply} onResolve={onResolve} onDelete={onDelete} onSelect={onSelect} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function Thread({ c, user, role, active, orphan, onReply, onResolve, onDelete, onSelect }) {
  const [replying, setReplying] = useState(false);
  const ref = useRef(null);
  const canResolve = role !== 'viewer' || c.author?.id === user.id;
  const canDelete = (id) => id === user.id || role === 'owner';

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

  return (
    <li ref={ref} className={`thread${active ? ' is-active' : ''}${c.resolved ? ' is-resolved' : ''}`}
      onClick={() => onSelect(c)}>
      {c.quote && (
        <blockquote className="thread-quote" title={orphan ? 'The highlighted text was deleted' : 'Show in document'}>
          {c.quote}
          {orphan && <span className="thread-orphan">Text removed</span>}
        </blockquote>
      )}
      <Message m={c} canDelete={canDelete(c.author?.id)} onDelete={() => onDelete(c)} />
      {c.replies.map((r) => (
        <Message key={r.id} m={r} reply canDelete={canDelete(r.author?.id)} onDelete={() => onDelete(r, c)} />
      ))}
      {c.resolved && c.resolvedBy && <p className="thread-meta">Resolved by {c.resolvedBy.id === user.id ? 'you' : c.resolvedBy.name}</p>}

      <div className="thread-actions" onClick={(e) => e.stopPropagation()}>
        {replying ? (
          <Composer placeholder="Reply" submitLabel="Reply" autoFocus
            onSubmit={async (body) => { await onReply(c, body); setReplying(false); }}
            onCancel={() => setReplying(false)} />
        ) : (
          <>
            <button className="btn btn-quiet btn-small" onClick={() => setReplying(true)}>Reply</button>
            {canResolve && (
              <button className="btn btn-quiet btn-small" onClick={() => onResolve(c, !c.resolved)}>
                {c.resolved ? 'Reopen' : 'Resolve'}
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

function Message({ m, reply, canDelete, onDelete }) {
  return (
    <div className={`msg${reply ? ' msg-reply' : ''}`}>
      <div className="msg-head">
        <Avatar user={m.author} size={24} />
        <span className="msg-name">{m.author?.name ?? 'Former member'}</span>
        <span className="msg-time">{timeAgo(m.createdAt)}</span>
        {canDelete && (
          <button className="icon-btn msg-delete" onClick={(e) => { e.stopPropagation(); onDelete(); }}
            aria-label={reply ? 'Delete reply' : 'Delete comment'} title={reply ? 'Delete reply' : 'Delete comment'}>
            <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L14 6" /></svg>
          </button>
        )}
      </div>
      <p className="msg-body">{m.body}</p>
    </div>
  );
}

function Composer({ quote, placeholder, submitLabel, autoFocus, onSubmit, onCancel }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e?.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(body.trim());
      setBody('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="composer" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
      {quote && <blockquote className="thread-quote">{quote}</blockquote>}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={2}
        maxLength={2000}
        autoFocus={autoFocus}
        aria-label={placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === 'Escape') onCancel?.();
        }}
      />
      <div className="composer-actions">
        <button type="button" className="btn btn-quiet btn-small" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary btn-small" disabled={!body.trim() || busy}>{busy ? 'Posting…' : submitLabel}</button>
      </div>
    </form>
  );
}
