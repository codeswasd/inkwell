import { useRef } from 'react';
import { useEditorState } from '@tiptap/react';
import { ACCEPTED_FILES } from '../api.js';
import { useDialog } from './Dialog.jsx';
import { Icon } from './icons.jsx';

const Btn = ({ on, active, disabled, title, children }) => (
  <button
    type="button"
    className={`tb-btn${active ? ' is-active' : ''}`}
    onMouseDown={(e) => e.preventDefault()}
    onClick={on}
    disabled={disabled}
    title={title}
    aria-label={title}
    aria-pressed={active ?? undefined}
  >
    {children}
  </button>
);

const Sep = () => <span className="tb-sep" aria-hidden />;

export default function Toolbar({ editor, disabled, onInsertFile, onComment, onShortcuts }) {
  const fileRef = useRef(null);
  const dialog = useDialog();
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive('heading', { level: 1 }) ? 'h1'
        : e.isActive('heading', { level: 2 }) ? 'h2'
        : e.isActive('heading', { level: 3 }) ? 'h3' : 'p',
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      code: e.isActive('codeBlock'),
      link: e.isActive('link'),
      left: e.isActive({ textAlign: 'left' }),
      center: e.isActive({ textAlign: 'center' }),
      right: e.isActive({ textAlign: 'right' }),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  if (!s) return null;
  const c = () => editor.chain().focus();

  const setBlock = (v) => {
    if (v === 'p') c().setParagraph().run();
    else c().toggleHeading({ level: Number(v[1]) }).run();
  };

  const setLink = async () => {
    const prev = editor.getAttributes('link').href || '';
    const url = await dialog.prompt({
      title: prev ? 'Edit link' : 'Add a link',
      message: 'Leave it empty to remove the link.',
      defaultValue: prev,
      placeholder: 'https://example.com',
      confirmLabel: 'Save link',
    });
    if (url === null) return;
    if (!url.trim()) return c().extendMarkRange('link').unsetLink().run();
    const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
    c().extendMarkRange('link').setLink({ href }).run();
  };

  return (
    <div className={`toolbar${disabled ? ' is-disabled' : ''}`} role="toolbar" aria-label="Formatting">
      <Btn title="Undo" on={() => c().undo().run()} disabled={disabled || !s.canUndo}><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M7 5L3.5 8.5 7 12" /><path d="M4 8.5h8a4.5 4.5 0 0 1 0 9H9" /></svg></Btn>
      <Btn title="Redo" on={() => c().redo().run()} disabled={disabled || !s.canRedo}><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M13 5l3.5 3.5L13 12" /><path d="M16 8.5H8a4.5 4.5 0 0 0 0 9h3" /></svg></Btn>
      <Sep />
      <select className="tb-select" value={s.block} onChange={(e) => setBlock(e.target.value)} disabled={disabled} aria-label="Text style">
        <option value="p">Normal text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>
      <Sep />
      <Btn title="Bold (⌘B)" active={s.bold} on={() => c().toggleBold().run()} disabled={disabled}><b>B</b></Btn>
      <Btn title="Italic (⌘I)" active={s.italic} on={() => c().toggleItalic().run()} disabled={disabled}><i className="tb-italic">I</i></Btn>
      <Btn title="Underline (⌘U)" active={s.underline} on={() => c().toggleUnderline().run()} disabled={disabled}><u>U</u></Btn>
      <Btn title="Strikethrough" active={s.strike} on={() => c().toggleStrike().run()} disabled={disabled}><s>S</s></Btn>
      <Btn title="Link (⌘K)" active={s.link} on={setLink} disabled={disabled}><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 11.5a3.2 3.2 0 0 0 4.6 0l2.6-2.6a3.2 3.2 0 0 0-4.6-4.6l-.9.9" /><path d="M11.5 8.5a3.2 3.2 0 0 0-4.6 0l-2.6 2.6a3.2 3.2 0 0 0 4.6 4.6l.9-.9" /></svg></Btn>
      <Sep />
      <Btn title="Bulleted list" active={s.bullet} on={() => c().toggleBulletList().run()} disabled={disabled}>
        <svg viewBox="0 0 20 20" width="16" height="16"><circle cx="4" cy="5" r="1.4" /><circle cx="4" cy="10" r="1.4" /><circle cx="4" cy="15" r="1.4" /><path d="M8 5h9M8 10h9M8 15h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </Btn>
      <Btn title="Numbered list" active={s.ordered} on={() => c().toggleOrderedList().run()} disabled={disabled}>
        <svg viewBox="0 0 20 20" width="16" height="16"><text x="1.5" y="7" fontSize="5.5" fill="currentColor">1</text><text x="1.5" y="12.5" fontSize="5.5" fill="currentColor">2</text><text x="1.5" y="18" fontSize="5.5" fill="currentColor">3</text><path d="M8 5h9M8 10h9M8 15h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </Btn>
      <Btn title="Quote" active={s.quote} on={() => c().toggleBlockquote().run()} disabled={disabled}><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 6v8M9 8h8M9 12h6" /></svg></Btn>
      <Btn title="Code block" active={s.code} on={() => c().toggleCodeBlock().run()} disabled={disabled}><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M7 6l-4 4 4 4M13 6l4 4-4 4" /></svg></Btn>
      <Sep />
      <Btn title="Align left" active={s.left} on={() => c().setTextAlign('left').run()} disabled={disabled}>
        <svg viewBox="0 0 20 20" width="16" height="16"><path d="M3 5h14M3 10h9M3 15h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </Btn>
      <Btn title="Align center" active={s.center} on={() => c().setTextAlign('center').run()} disabled={disabled}>
        <svg viewBox="0 0 20 20" width="16" height="16"><path d="M3 5h14M5.5 10h9M4 15h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </Btn>
      <Btn title="Align right" active={s.right} on={() => c().setTextAlign('right').run()} disabled={disabled}>
        <svg viewBox="0 0 20 20" width="16" height="16"><path d="M3 5h14M8 10h9M5 15h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </Btn>
      <Sep />
      <Btn title="Divider" on={() => c().setHorizontalRule().run()} disabled={disabled}><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10h14" /></svg></Btn>
      <Btn title="Clear formatting" on={() => c().unsetAllMarks().clearNodes().run()} disabled={disabled}><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h10M10 4l-3 12M12.5 12.5l4 4M16.5 12.5l-4 4" /></svg></Btn>
      <Btn title="Insert a .txt, .md or .docx file here" on={() => fileRef.current?.click()} disabled={disabled}>
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2.5H5.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 16 16V7.5z" /><path d="M11 2.5v5h5M10 10v5M7.5 12.5h5" /></svg>
      </Btn>
      <Sep />
      <Btn title="Comment on selection (Ctrl+Alt+M)" on={onComment} disabled={disabled}><Icon name="comment" /></Btn>
      <Btn title="Keyboard shortcuts (Ctrl+/)" on={onShortcuts}><Icon name="keyboard" /></Btn>
      <input ref={fileRef} type="file" accept={ACCEPTED_FILES} hidden
        onChange={(e) => { onInsertFile(e.target.files[0]); e.target.value = ''; }} />
    </div>
  );
}
