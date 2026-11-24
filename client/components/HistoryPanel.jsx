import { Avatar, formatWhen } from './common.jsx';

export default function HistoryPanel({ history, user, previewN, onPreview, onClose }) {
  const entries = history?.entries ?? [];
  return (
    <aside className="panel" aria-label="Version history">
      <header className="panel-head">
        <h2>Version history</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close version history">
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg>
        </button>
      </header>
      <div className="panel-body">
        {!history && <div className="panel-loading"><span className="spinner" /></div>}
        {history && entries.length === 0 && <p className="panel-empty">No earlier versions yet.</p>}
        <ol className="timeline">
          {entries.map((e, i) => {
            const current = i === 0;
            return (
              <li key={e.n}>
                <button
                  className={`version${previewN === e.n ? ' is-active' : ''}${current && previewN == null ? ' is-current' : ''}`}
                  onClick={() => onPreview(current ? null : e.n)}
                  aria-current={current ? 'true' : undefined}
                >
                  <span className="version-when">{formatWhen(e.at)}</span>
                  <span className="version-label">{current ? 'Current version' : e.label}</span>
                  <span className="version-by">
                    <Avatar user={e.by} size={18} title="" />
                    {e.by?.id === user.id ? 'You' : e.by?.name ?? 'Former member'}
                    <span className="version-words">{e.words} {e.words === 1 ? 'word' : 'words'}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {entries.length > 0 && (
          <p className="hint panel-foot">A new version starts when someone else edits, after a 10-minute pause, or on import and restore.</p>
        )}
      </div>
    </aside>
  );
}
