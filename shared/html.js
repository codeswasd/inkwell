// Pure helpers shared by the server and the browser demo.

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Defense in depth for stored HTML. The TipTap schema on the client is the real allow-list. */
export function sanitizeHtml(html) {
  return String(html)
    .replace(/<(script|style|iframe|object|embed|noscript|template)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(script|style|iframe|object|embed|noscript|template|meta|link|base)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src|xlink:href)\s*=\s*("|')\s*(javascript|vbscript|data):[^"']*\2/gi, ' $1="#"')
    .replace(/\s(href|src)\s*=\s*(javascript|vbscript|data):[^\s>]+/gi, ' $1="#"');
}

export const htmlToText = (html) =>
  String(html)
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/blockquote|\/pre)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export const countWords = (text) => {
  const t = String(text).trim();
  return t ? t.split(/\s+/).length : 0;
};

export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.markdown', '.docx'];
// 4 MB keeps a base64-encoded upload under the 6 MB request limit of serverless hosts (Netlify).
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
