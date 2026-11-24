import { Mark, mergeAttributes } from '@tiptap/core';

/** Highlights the text a comment thread is attached to: <mark data-comment="threadId">…</mark> */
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false, // typing at the edge of a highlight doesn't extend it
  excludes: '',     // can overlap other comments and formatting

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment'),
        renderHTML: (attrs) => (attrs.commentId ? { 'data-comment': attrs.commentId } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'mark[data-comment]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes, { class: 'comment-mark' }), 0];
  },

  addCommands() {
    return {
      setComment: (commentId) => ({ commands }) => commands.setMark(this.name, { commentId }),
      unsetComment: (commentId) => ({ tr, state, dispatch }) => {
        const type = state.schema.marks[this.name];
        state.doc.descendants((node, pos) => {
          node.marks
            .filter((m) => m.type === type && m.attrs.commentId === commentId)
            .forEach((m) => tr.removeMark(pos, pos + node.nodeSize, m));
        });
        if (dispatch) dispatch(tr);
        return true;
      },
    };
  },
});

/** Find the document range of a comment's highlight, or null if its text was deleted. */
export function findCommentRange(editor, commentId) {
  let from = null;
  let to = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.marks?.some((m) => m.type.name === 'comment' && m.attrs.commentId === commentId)) {
      from = from === null ? pos : Math.min(from, pos);
      to = Math.max(to ?? 0, pos + node.nodeSize);
    }
  });
  return from === null ? null : { from, to };
}
