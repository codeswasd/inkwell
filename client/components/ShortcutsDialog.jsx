import { useEffect, useRef } from 'react';

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = mac ? '⌘' : 'Ctrl';
const ALT = mac ? '⌥' : 'Alt';

const GROUPS = [
  ['Text', [['Bold', [MOD, 'B']], ['Italic', [MOD, 'I']], ['Underline', [MOD, 'U']], ['Strikethrough', [MOD, '⇧', 'S']], ['Undo', [MOD, 'Z']], ['Redo', [MOD, '⇧', 'Z']]]],
  ['Structure', [['Heading 1–3', [MOD, ALT, '1–3']], ['Normal text', [MOD, ALT, '0']], ['Bulleted list', [MOD, '⇧', '8']], ['Numbered list', [MOD, '⇧', '7']], ['Quote', [MOD, '⇧', 'B']]]],
  ['Document', [['Save now', [MOD, 'S']], ['Comment on selection', [MOD, ALT, 'M']], ['Version history', [MOD, ALT, 'H']], ['Keyboard shortcuts', [MOD, '/']]]],
];

export default function ShortcutsDialog({ onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="kbd-title" tabIndex={-1} ref={ref}>
        <header className="modal-head">
          <h2 id="kbd-title">Keyboard shortcuts</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg>
          </button>
        </header>
        <div className="kbd-grid">
          {GROUPS.map(([name, rows]) => (
            <section key={name}>
              <h3>{name}</h3>
              <dl>
                {rows.map(([label, keys]) => (
                  <div key={label} className="kbd-row">
                    <dt>{label}</dt>
                    <dd>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
