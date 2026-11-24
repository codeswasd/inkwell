import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import { CommentMark } from './CommentMark.js';

/** One schema for the editor and the read-only version viewer, so both render identically. */
export const editorExtensions = ({ placeholder = 'Start writing, or insert a file from the toolbar' } = {}) => [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true } }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Placeholder.configure({ placeholder }),
  CommentMark,
];
