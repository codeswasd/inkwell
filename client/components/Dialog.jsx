import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const DialogCtx = createContext(null);
export const useDialog = () => useContext(DialogCtx);

/** In-app confirm and prompt dialogs: styled, accessible, and they work inside sandboxed frames where the native ones are blocked. */
export function DialogProvider({ children }) {
  const [dlg, setDlg] = useState(null);

  const open = useCallback((opts) => new Promise((resolve) => setDlg({ ...opts, resolve })), []);
  const confirm = useCallback((opts) => open({ kind: 'confirm', ...opts }), [open]);
  const prompt = useCallback((opts) => open({ kind: 'prompt', ...opts }), [open]);

  const close = (value) => {
    dlg?.resolve(value);
    setDlg(null);
  };

  return (
    <DialogCtx.Provider value={{ confirm, prompt }}>
      {children}
      {dlg && <DialogView dlg={dlg} onClose={close} />}
    </DialogCtx.Provider>
  );
}

function DialogView({ dlg, onClose }) {
  const [value, setValue] = useState(dlg.defaultValue ?? '');
  const inputRef = useRef(null);
  const okRef = useRef(null);
  const cancelValue = dlg.kind === 'prompt' ? null : false;

  useEffect(() => {
    (dlg.kind === 'prompt' ? inputRef : okRef).current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose(cancelValue);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e) => {
    e.preventDefault();
    onClose(dlg.kind === 'prompt' ? value : true);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose(cancelValue)}>
      <form className="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onSubmit={submit}>
        <h2 id="dlg-title" className="dlg-title">{dlg.title}</h2>
        {dlg.message && <p className="dlg-message">{dlg.message}</p>}
        {dlg.kind === 'prompt' && (
          <input
            ref={inputRef}
            className="dlg-input"
            type="text"
            value={value}
            placeholder={dlg.placeholder}
            onChange={(e) => setValue(e.target.value)}
            aria-label={dlg.title}
          />
        )}
        <div className="dlg-actions">
          <button type="button" className="btn btn-quiet" onClick={() => onClose(cancelValue)}>Cancel</button>
          <button ref={okRef} className={`btn ${dlg.danger ? 'btn-danger' : 'btn-primary'}`}>{dlg.confirmLabel || 'OK'}</button>
        </div>
      </form>
    </div>
  );
}
