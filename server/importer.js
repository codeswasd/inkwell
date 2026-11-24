import mammoth from 'mammoth';
import { marked } from 'marked';
import { extname, basename } from 'node:path';
import { HttpError } from '../shared/service.js';
import { escapeHtml, sanitizeHtml, SUPPORTED_EXTENSIONS, MAX_UPLOAD_BYTES } from '../shared/html.js';

export { SUPPORTED_EXTENSIONS, MAX_UPLOAD_BYTES };

/** Convert an uploaded file into { title, html }. Throws HttpError on unsupported or unreadable input. */
export async function fileToHtml(originalName, buffer) {
  const ext = extname(originalName).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new HttpError(415, `Unsupported file type “${ext || 'none'}”. Use a .txt, .md or .docx file.`);
  }
  if (buffer.length > MAX_UPLOAD_BYTES) throw new HttpError(413, 'File is too large (4 MB max).');
  const title = basename(originalName, extname(originalName)).trim().slice(0, 200) || 'Imported document';
  let html;
  if (ext === '.docx') {
    try {
      ({ value: html } = await mammoth.convertToHtml({ buffer }));
    } catch {
      throw new HttpError(422, 'That .docx file couldn’t be read. Check that it opens in Word, then try again.');
    }
  } else {
    const text = buffer.toString('utf8');
    if (text.includes('\u0000')) throw new HttpError(422, 'That file isn’t plain text.');
    html =
      ext === '.txt'
        ? text.split(/\r?\n\s*\r?\n/).map((p) => `<p>${escapeHtml(p).replace(/\r?\n/g, '<br>')}</p>`).join('')
        : await marked.parse(text);
  }
  return { title, html: sanitizeHtml(html?.trim() ? html : '<p></p>') };
}
