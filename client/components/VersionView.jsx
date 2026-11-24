import { useEffect, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { diffWords } from 'diff';
import { formatWhen } from './common.jsx';
import { htmlToText } from '../../shared/html.js';
import { editorExtensions } from '../extensions/index.js';

const plain = (html) => htmlToText(html).replace(/\n{2,}/g, '\n').trim();

/** Read-only rendering of an older version, with an optional word-level diff against the current text. */
export default function VersionView({ version, currentHtml, mode }) {
  const editor = useEditor({
    extensions: editorExtensions({ placeholder: '' }),
    content: version.content || '',
    editable: false,
    editorProps: { attributes: { class: 'prose prose-version' } },
  });
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.commands.setContent(version.content || '', { emitUpdate: false });
  }, [editor, version.content]);

  const parts = useMemo(
    () => (mode === 'changes' ? diffWords(plain(version.content), plain(currentHtml)) : []),
    [mode, version.content, currentHtml]
  );
  const added = parts.filter((p) => p.added).reduce((n, p) => n + p.value.trim().split(/\s+/).filter(Boolean).length, 0);
  const removed = parts.filter((p) => p.removed).reduce((n, p) => n + p.value.trim().split(/\s+/).filter(Boolean).length, 0);

  return (
    <>
      <div className="sheet-meta">
        <span className="role role-viewer">{formatWhen(version.at)}</span>
        <span>{version.label} by {version.by?.name ?? 'a former member'}</span>
      </div>
      <h1 className="sheet-title sheet-title-static">{version.title}</h1>
      {mode === 'changes' ? (
        <>
          <p className="diff-summary">
            Since this version: <ins>{added} {added === 1 ? 'word' : 'words'} added</ins>, <del>{removed} removed</del>.
          </p>
          <div className="prose diff">
            {parts.length === 0 || (added === 0 && removed === 0)
              ? <p>No text changes since this version.</p>
              : parts.map((p, i) =>
                p.added ? <ins key={i}>{p.value}</ins> : p.removed ? <del key={i}>{p.value}</del> : <span key={i}>{p.value}</span>)}
          </div>
        </>
      ) : (
        <EditorContent editor={editor} />
      )}
    </>
  );
}
