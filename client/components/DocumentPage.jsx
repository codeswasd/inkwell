import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import TurndownService from 'turndown';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { Avatar, RoleTag, Wordmark, timeAgo, formatWhen } from './common.jsx';
import Toolbar from './Toolbar.jsx';
import ShareDialog from './ShareDialog.jsx';
import CommentsPanel from './CommentsPanel.jsx';
import HistoryPanel from './HistoryPanel.jsx';
import VersionView from './VersionView.jsx';
import ShortcutsDialog from './ShortcutsDialog.jsx';
import { useToast } from './Toast.jsx';
import { useDialog } from './Dialog.jsx';
import { editorExtensions } from '../extensions/index.js';
import { findCommentRange } from '../extensions/CommentMark.js';
import { Icon } from './icons.jsx';

const SAVE_DEBOUNCE_MS = 700;
const HEARTBEAT_MS = 4000;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export default function DocumentPage({ id, user }) {
  const toast = useToast();
  const dialog = useDialog();
  const [doc, setDoc] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('saved'); // saved | unsaved | saving | error | conflict
  const [conflict, setConflict] = useState(null);
  const [shares, setShares] = useState([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [active, setActive] = useState([]);
  const [words, setWords] = useState(0);
  const [panel, setPanel] = useState(null); // null | 'comments' | 'history'
  const [comments, setComments] = useState({ rev: 0, items: [] });
  const [draft, setDraft] = useState(null); // { key, quote, range }
  const [activeComment, setActiveComment] = useState(null);
  const [history, setHistory] = useState(null);
  const [preview, setPreview] = useState(null); // { version, mode }
  const [orphans, setOrphans] = useState(new Set());

  const versionRef = useRef(0);
  const seqRef = useRef(0); // increments on every local edit
  const savedSeqRef = useRef(0); // the edit the server has confirmed
  const savingRef = useRef(false);
  const timerRef = useRef(null);
  const conflictRef = useRef(false);
  const commentsRevRef = useRef(0);

  const canEdit = Boolean(doc) && doc.role !== 'viewer';
  const isOwner = doc?.role === 'owner';
  const dirty = () => seqRef.current !== savedSeqRef.current;

  const editor = useEditor({
    extensions: editorExtensions(),
    content: '',
    editable: false,
    editorProps: {
      attributes: { class: 'prose', spellcheck: 'true' },
      handleClick: (view, pos) => {
        const mark = view.state.doc.resolve(pos).marks().find((m) => m.type.name === 'comment');
        if (mark) {
          setActiveComment(mark.attrs.commentId);
          setPanel('comments');
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      setWords(countWords(e.getText()));
      if (!e.isEditable) return;
      seqRef.current += 1;
      setStatus('unsaved');
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => saveRef.current(), SAVE_DEBOUNCE_MS);
    },
  });

  // ---------- load ----------
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getDoc(id), api.comments(id)])
      .then(([d, c]) => {
        if (cancelled) return;
        setDoc(d);
        setTitle(d.title);
        setShares(d.shares || []);
        setComments(c);
        commentsRevRef.current = c.rev;
        versionRef.current = d.version;
      })
      .catch((e) => !cancelled && setLoadError(e));
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!editor || !doc || editor.isDestroyed) return;
    editor.commands.setContent(doc.content || '', { emitUpdate: false });
    editor.setEditable(canEdit, false); // false: don't emit an update (it would mark the doc unsaved)
    setWords(countWords(editor.getText()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, doc?.id, doc?.role]);

  // ---------- save ----------
  const save = useCallback(async () => {
    if (!editor || editor.isDestroyed || !doc || conflictRef.current) return;
    if (savingRef.current) {
      timerRef.current = setTimeout(() => saveRef.current(), SAVE_DEBOUNCE_MS);
      return;
    }
    if (!dirty()) return;
    const seq = seqRef.current;
    savingRef.current = true;
    setStatus('saving');
    try {
      const res = await api.updateDoc(doc.id, { content: editor.getHTML(), baseVersion: versionRef.current });
      versionRef.current = res.version;
      savedSeqRef.current = seq;
      setDoc((d) => ({ ...d, updatedAt: res.updatedAt, lastEditedBy: res.lastEditedBy, version: res.version }));
      setStatus(seqRef.current === seq ? 'saved' : 'unsaved');
    } catch (e) {
      if (e.status === 409) {
        conflictRef.current = true;
        setConflict(e.body.latest);
        setStatus('conflict');
      } else {
        setStatus('error');
        toast(`Your last changes weren’t saved. ${e.message}`, 'error');
      }
    } finally {
      savingRef.current = false;
    }
  }, [editor, doc, toast]);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = async () => {
    clearTimeout(timerRef.current);
    if (dirty()) await saveRef.current();
  };

  // ---------- comments ----------
  const loadComments = useCallback(async () => {
    try {
      const c = await api.comments(id);
      commentsRevRef.current = c.rev;
      setComments(c);
    } catch { /* next heartbeat retries */ }
  }, [id]);

  const startComment = useCallback(() => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      toast('Select the text you want to comment on.', 'info');
      return;
    }
    const quote = editor.state.doc.textBetween(from, to, ' ').trim().slice(0, 300);
    setDraft({ key: Date.now(), quote, range: { from, to } });
    setPanel('comments');
    setPreview(null);
  }, [editor, toast]);

  const submitDraft = async (body) => {
    try {
      const created = await api.addComment(id, { body, quote: draft.quote, anchored: canEdit });
      if (created.anchored && editor && !editor.isDestroyed) {
        const max = editor.state.doc.content.size;
        editor.chain().setTextSelection({ from: Math.min(draft.range.from, max), to: Math.min(draft.range.to, max) })
          .setComment(created.id).run(); // the highlight is saved with the next autosave
      }
      setDraft(null);
      setActiveComment(created.id);
      await loadComments();
    } catch (e) {
      toast(e.message, 'error');
      throw e;
    }
  };

  const reply = async (thread, body) => {
    try {
      await api.addComment(id, { body, parentId: thread.id });
      await loadComments();
    } catch (e) {
      toast(e.message, 'error');
      throw e;
    }
  };

  const resolve = async (thread, resolved) => {
    try {
      await api.resolveComment(id, thread.id, resolved);
      await loadComments();
      toast(resolved ? 'Comment resolved' : 'Comment reopened', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const removeComment = async (item, parent) => {
    const isThread = !parent;
    const ok = await dialog.confirm({
      title: isThread ? 'Delete this comment thread?' : 'Delete this reply?',
      message: isThread && item.replies?.length ? `Its ${item.replies.length} ${item.replies.length === 1 ? 'reply' : 'replies'} will be deleted too.` : 'This can’t be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteComment(id, item.id);
      if (isThread && item.anchored && canEdit && editor) editor.commands.unsetComment(item.id);
      await loadComments();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const selectThread = (c) => {
    setActiveComment(c.id);
    if (!editor || !c.anchored) return;
    const range = findCommentRange(editor, c.id);
    if (!range) return;
    editor.commands.setTextSelection(range);
    editor.view.dom.querySelector(`mark[data-comment="${c.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  // Which anchored threads lost their highlighted text?
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const check = () => {
      const missing = comments.items.filter((c) => c.anchored && !findCommentRange(editor, c.id)).map((c) => c.id);
      setOrphans((prev) => (prev.size === missing.length && missing.every((m) => prev.has(m)) ? prev : new Set(missing)));
    };
    check();
    editor.on('update', check);
    return () => editor.off('update', check);
  }, [editor, comments, doc?.version]);

  // Highlight styling that depends on comment state (resolved threads lose their highlight).
  const commentCss = useMemo(() => {
    const ids = comments.items.filter((c) => c.resolved && SAFE_ID.test(c.id)).map((c) => `.prose mark[data-comment="${c.id}"]`);
    const act = activeComment && SAFE_ID.test(activeComment) ? `.prose mark[data-comment="${activeComment}"]{background:var(--blot-strong);box-shadow:0 2px 0 var(--blot)}` : '';
    return `${ids.length ? `${ids.join(',')}{background:none;box-shadow:none}` : ''}${act}`;
  }, [comments, activeComment]);

  // ---------- version history ----------
  const loadHistory = useCallback(async () => {
    try { setHistory(await api.versions(id)); } catch (e) { toast(e.message, 'error'); }
  }, [id, toast]);

  useEffect(() => {
    if (panel === 'history') loadHistory();
  }, [panel, doc?.version, loadHistory]);

  const openPreview = async (n) => {
    if (n == null) return setPreview(null);
    await flush();
    try {
      const version = await api.version(id, n);
      setPreview({ version, mode: 'preview' });
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const restore = async () => {
    const v = preview.version;
    const ok = await dialog.confirm({
      title: 'Restore this version?',
      message: `The document will go back to how it looked on ${formatWhen(v.at)}. The current text stays in the history, so you can undo this.`,
      confirmLabel: 'Restore version',
    });
    if (!ok) return;
    try {
      await flush();
      const res = await api.restoreVersion(id, v.n);
      editor.commands.setContent(res.content, { emitUpdate: false });
      versionRef.current = res.version;
      savedSeqRef.current = seqRef.current;
      setTitle(res.title);
      setDoc((d) => ({ ...d, title: res.title, version: res.version, updatedAt: res.updatedAt, lastEditedBy: res.lastEditedBy }));
      setWords(countWords(editor.getText()));
      setPreview(null);
      setStatus('saved');
      toast(`Restored the version from ${formatWhen(v.at)}`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        flush();
      } else if (mod && e.altKey && (e.code === 'KeyM')) {
        e.preventDefault();
        startComment();
      } else if (mod && e.key === '/') {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (mod && e.altKey && e.code === 'KeyH') {
        e.preventDefault();
        setPanel((p) => (p === 'history' ? null : 'history'));
      }
    };
    const onUnload = (e) => {
      if (dirty()) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [startComment]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    if (dirty()) { try { saveRef.current(); } catch { /* editor already torn down */ } } // flush on in-app navigation
  }, []);

  // ---------- presence + pull remote changes ----------
  useEffect(() => {
    if (!doc || !editor) return;
    let stop = false;
    const tick = async () => {
      try {
        const hb = await api.heartbeat(doc.id);
        if (stop) return;
        setActive(hb.active.filter((u) => u.id !== user.id));
        if (hb.title !== doc.title && document.activeElement?.id !== 'doc-title') {
          setTitle(hb.title);
          setDoc((d) => ({ ...d, title: hb.title }));
        }
        if (hb.commentsRev !== commentsRevRef.current) loadComments();
        if (hb.version > versionRef.current && !dirty() && !savingRef.current && !conflictRef.current) {
          const fresh = await api.getDoc(doc.id);
          if (stop || dirty() || editor.isDestroyed) return;
          const sel = editor.state.selection;
          editor.commands.setContent(fresh.content, { emitUpdate: false });
          try {
            const max = editor.state.doc.content.size;
            editor.commands.setTextSelection({ from: Math.min(sel.from, max), to: Math.min(sel.to, max) });
          } catch { /* best effort */ }
          versionRef.current = fresh.version;
          setDoc((d) => ({ ...d, updatedAt: fresh.updatedAt, lastEditedBy: fresh.lastEditedBy, version: fresh.version }));
          setWords(countWords(editor.getText()));
        }
      } catch (e) {
        if (e.status === 404 && !stop) setLoadError(e); // access revoked or doc deleted
      }
    };
    tick();
    const t = setInterval(tick, HEARTBEAT_MS);
    return () => { stop = true; clearInterval(t); };
  }, [doc?.id, doc?.title, editor, user.id, loadComments]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- title ----------
  const commitTitle = async () => {
    const next = title.replace(/\s+/g, ' ').trim();
    if (next === doc.title) return setTitle(doc.title);
    if (!next) {
      toast('A document needs a title.', 'error');
      return setTitle(doc.title);
    }
    try {
      const res = await api.updateDoc(doc.id, { title: next });
      setDoc((d) => ({ ...d, title: res.title, updatedAt: res.updatedAt }));
      setTitle(res.title);
    } catch (e) {
      toast(e.message, 'error');
      setTitle(doc.title);
    }
  };

  // ---------- conflict ----------
  const resolveConflict = async (keepMine) => {
    const latest = conflict;
    conflictRef.current = false;
    setConflict(null);
    versionRef.current = latest.version;
    if (keepMine) {
      savedSeqRef.current = -1; // force a save of the local copy on top of the latest version
      await saveRef.current();
    } else {
      editor.commands.setContent(latest.content, { emitUpdate: false });
      savedSeqRef.current = seqRef.current;
      setDoc((d) => ({ ...d, ...latest, role: d.role }));
      setTitle(latest.title);
      setStatus('saved');
    }
  };

  // ---------- insert from file ----------
  const insertFile = async (file) => {
    if (!file) return;
    try {
      const { html } = await api.convertFile(file);
      editor.chain().focus().insertContent(html).run();
      toast(`Inserted ${file.name}`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  // ---------- export ----------
  const exportAs = async (kind) => {
    setExportOpen(false);
    const safe = (doc.title || 'document').replace(/[^\w\- ]+/g, '').trim() || 'document';
    if (kind === 'pdf') return window.print();
    const html = stripCommentMarks(editor.getHTML());
    const md = () => `# ${doc.title}\n\n${new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' }).turndown(html)}\n`;
    if (kind === 'copy-md') {
      try {
        await navigator.clipboard.writeText(md());
        toast('Copied as Markdown', 'success');
      } catch {
        toast('Your browser blocked copying. Use Markdown file instead.', 'error');
      }
      return;
    }
    const [body, type, ext] = kind === 'md'
      ? [md(), 'text/markdown', 'md']
      : [`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title></head><body><h1>${escapeHtml(doc.title)}</h1>${html}</body></html>`, 'text/html', 'html'];
    const url = URL.createObjectURL(new Blob([body], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${safe}.${ext}` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ---------- render ----------
  if (loadError) {
    const gone = loadError.status === 404;
    return (
      <div className="center-state">
        <Wordmark asLink />
        <h1>{gone ? 'You don’t have access to this document' : 'This document didn’t load'}</h1>
        <p className="muted">{gone ? 'It may have been deleted, or the owner hasn’t shared it with you yet.' : `${loadError.message} Try again in a moment.`}</p>
        <button className="btn btn-primary" onClick={() => navigate('#/')}>Back to documents</button>
      </div>
    );
  }
  if (!doc) return <div className="boot"><span className="spinner" /></div>;

  const openThreads = comments.items.filter((c) => !c.resolved).length;
  const togglePanel = (name) => {
    setPanel((p) => (p === name ? null : name));
    if (name !== 'history') setPreview(null);
  };

  return (
    <div className={`docpage${panel ? ' has-panel' : ''}`}>
      <style>{commentCss}</style>
      <header className="docbar">
        <nav className="crumbs" aria-label="Breadcrumb">
          <a href="#/" onClick={(e) => { e.preventDefault(); flush(); navigate('#/'); }} className="crumb-home">
            <Icon name="back" /> Documents
          </a>
          <span className="crumb-sep" aria-hidden>/</span>
          <span className="crumb-current">{title || 'Untitled'}</span>
        </nav>
        <div className="docbar-right">
          <SaveStatus status={status} />
          {active.length > 0 && (
            <div className="presence" aria-label={`Also here: ${active.map((u) => u.name).join(', ')}`}>
              {active.map((u) => <Avatar key={u.id} user={u} size={28} ring title={`${u.name} has this open`} />)}
            </div>
          )}
          <button className={`btn btn-quiet btn-icon-label${panel === 'comments' ? ' is-on' : ''}`} onClick={() => togglePanel('comments')}
            aria-pressed={panel === 'comments'} title="Comments">
            <Icon name="comment" /><span className="label">Comments</span>{openThreads > 0 && <span className="count-pill">{openThreads}</span>}
          </button>
          <button className={`btn btn-quiet btn-icon-label${panel === 'history' ? ' is-on' : ''}`} onClick={() => togglePanel('history')}
            aria-pressed={panel === 'history'} title="Version history (Ctrl+Alt+H)">
            <Icon name="history" /><span className="label">History</span>
          </button>
          <div className="menu-wrap">
            <button className="btn btn-quiet" onClick={() => setExportOpen((v) => !v)} aria-expanded={exportOpen} aria-haspopup="menu">Export</button>
            {exportOpen && (
              <div className="menu" role="menu" onMouseLeave={() => setExportOpen(false)}>
                <button role="menuitem" onClick={() => exportAs('copy-md')}>Copy as Markdown</button>
                <button role="menuitem" onClick={() => exportAs('md')}>Markdown file</button>
                <button role="menuitem" onClick={() => exportAs('html')}>HTML file</button>
                <button role="menuitem" onClick={() => exportAs('pdf')}>Print or save as PDF</button>
              </div>
            )}
          </div>
          {isOwner && (
            <button className="btn btn-primary" onClick={() => setShareOpen(true)}>
              Share{shares.length > 0 && <span className="badge" aria-label={`${shares.length} people`}>{shares.length}</span>}
            </button>
          )}
          <Avatar user={user} size={30} />
        </div>
      </header>

      {preview ? (
        <div className="notice notice-version">
          <span>Viewing the version from <strong>{formatWhen(preview.version.at)}</strong>. Editing is paused.</span>
          <span className="notice-actions">
            <span className="seg" role="group" aria-label="View">
              <button className={preview.mode === 'preview' ? 'is-on' : ''} onClick={() => setPreview((p) => ({ ...p, mode: 'preview' }))}>As it was</button>
              <button className={preview.mode === 'changes' ? 'is-on' : ''} onClick={() => setPreview((p) => ({ ...p, mode: 'changes' }))}>What changed</button>
            </span>
            {canEdit && <button className="btn btn-primary" onClick={restore}>Restore this version</button>}
            <button className="btn btn-quiet" onClick={() => setPreview(null)}>Back to current</button>
          </span>
        </div>
      ) : canEdit ? (
        <Toolbar editor={editor} disabled={!editor || status === 'conflict'} onInsertFile={insertFile}
          onComment={startComment} onShortcuts={() => setShortcutsOpen(true)} />
      ) : (
        <div className="notice">You can read, comment on and export this document. Ask {doc.owner.name.split(' ')[0]} if you need to edit it.</div>
      )}

      {conflict && (
        <div className="notice notice-alert" role="alert">
          <span>{conflict.lastEditedBy?.name || 'Someone'} saved a newer version while you were editing.</span>
          <span className="notice-actions">
            <button className="btn btn-quiet" onClick={() => resolveConflict(false)}>Use their version</button>
            <button className="btn btn-primary" onClick={() => resolveConflict(true)}>Keep my version</button>
          </span>
        </div>
      )}

      <div className="workspace">
        <main className="desk" onMouseDown={(e) => { if (e.target === e.currentTarget && !preview) { e.preventDefault(); editor?.commands.focus('end'); } }}>
          <article className={`sheet${preview ? ' sheet-version' : ''}`}>
            {preview ? (
              <VersionView version={preview.version} currentHtml={editor?.getHTML() ?? ''} mode={preview.mode} />
            ) : (
              <>
                <div className="sheet-meta">
                  <RoleTag role={doc.role} />
                  <span>{isOwner ? 'Your document' : `${doc.owner.name}’s document`}</span>
                </div>
                <textarea
                  id="doc-title"
                  className="sheet-title"
                  rows={1}
                  value={title}
                  placeholder="Untitled document"
                  onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); editor?.commands.focus('start'); }
                    if (e.key === 'Escape') { setTitle(doc.title); e.currentTarget.blur(); }
                  }}
                  readOnly={!canEdit}
                  maxLength={200}
                  aria-label="Document title"
                />
              </>
            )}
            <div hidden={Boolean(preview)}><EditorContent editor={editor} /></div>
          </article>
          {!preview && (
            <footer className="sheet-foot">
              <span>{words} {words === 1 ? 'word' : 'words'}</span>
              {doc.lastEditedBy && <span>Last edited by {doc.lastEditedBy.id === user.id ? 'you' : doc.lastEditedBy.name}, {timeAgo(doc.updatedAt)}</span>}
              {doc.source && <span>Imported from {doc.source}</span>}
            </footer>
          )}
        </main>

        {panel === 'comments' && (
          <CommentsPanel
            comments={comments} user={user} role={doc.role} draft={draft} activeId={activeComment} orphanIds={orphans}
            onSubmitDraft={submitDraft} onCancelDraft={() => setDraft(null)} onReply={reply} onResolve={resolve}
            onDelete={removeComment} onSelect={selectThread} onClose={() => { setPanel(null); setDraft(null); }}
          />
        )}
        {panel === 'history' && (
          <HistoryPanel history={history} user={user} previewN={preview?.version.n ?? null} onPreview={openPreview}
            onClose={() => { setPanel(null); setPreview(null); }} />
        )}
      </div>

      {editor && !preview && (
        <BubbleMenu editor={editor} options={{ placement: 'top', offset: 8 }}
          shouldShow={({ editor: e, state }) => !state.selection.empty && e.view.hasFocus()}>
          <div className="bubble" role="toolbar" aria-label="Selection">
            {canEdit && (
              <>
                <button className={editor.isActive('bold') ? 'is-on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Bold"><b>B</b></button>
                <button className={editor.isActive('italic') ? 'is-on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Italic"><i className="tb-italic">I</i></button>
                <button className={editor.isActive('underline') ? 'is-on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleUnderline().run()} aria-label="Underline"><u>U</u></button>
                <span className="bubble-sep" aria-hidden />
              </>
            )}
            <button className="bubble-comment" onMouseDown={(e) => e.preventDefault()} onClick={startComment}>
              <Icon name="comment" /> Comment
            </button>
          </div>
        </BubbleMenu>
      )}

      {shareOpen && <ShareDialog doc={doc} owner={user} shares={shares} onChange={setShares} onClose={() => setShareOpen(false)} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}

function SaveStatus({ status }) {
  const map = {
    saved: ['Saved', 'ok'],
    unsaved: ['Unsaved changes', 'wet'],
    saving: ['Saving', 'wet'],
    error: ['Not saved. Keep typing to retry', 'bad'],
    conflict: ['Choose a version to keep', 'bad'],
  };
  const [label, tone] = map[status];
  return <span className={`save save-${tone}`} role="status"><span className="save-dot" aria-hidden />{label}</span>;
}

const countWords = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const stripCommentMarks = (html) => html.replace(/<mark[^>]*data-comment="[^"]*"[^>]*>/g, '').replace(/<\/mark>/g, '');
