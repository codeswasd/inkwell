// In-browser backend for the single-file demo (`npm run build:demo`).
// It runs the very same shared/service.js as the server, on a localStorage-backed store,
// so every rule (roles, validation, versions, comments) behaves identically.
import { marked } from 'marked';
import mammoth from 'mammoth/mammoth.browser.js';
import { ApiError } from './apiError.js';
import { getToken } from './api.js';
import { memoryKV } from '../shared/kv.js';
import { createService, HttpError } from '../shared/service.js';
import { escapeHtml, sanitizeHtml, SUPPORTED_EXTENSIONS, MAX_UPLOAD_BYTES } from '../shared/html.js';

const STORE_KEY = 'inkwell.demo.v2';
const PASSWORD = 'demo1234';
const USERS = [
  { id: 'alice', name: 'Alice Chen', email: 'alice@ajaia.dev', color: '#c4a7ff' },
  { id: 'bob', name: 'Bob Rivera', email: 'bob@ajaia.dev', color: '#7cc7ff' },
  { id: 'carol', name: 'Carol Okafor', email: 'carol@ajaia.dev', color: '#ffb07a' },
];

let saved = {};
try { saved = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { /* no storage: in-memory only */ }
const kv = memoryKV(saved, {
  onChange: (data) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(data))); } catch { /* full or blocked */ } },
});
const service = createService({ kv, users: USERS, checkPassword: (_u, pw) => pw === PASSWORD });

async function fileToHtml(file) {
  const ext = (file.name.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) throw new HttpError(415, `Unsupported file type “${ext || 'none'}”. Use a .txt, .md or .docx file.`);
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, 'File is too large (4 MB max).');
  const title = file.name.replace(/\.[^.]+$/, '').trim().slice(0, 200) || 'Imported document';
  let html;
  if (ext === '.docx') {
    try { ({ value: html } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })); }
    catch { throw new HttpError(422, 'That .docx file couldn’t be read. Check that it opens in Word, then try again.'); }
  } else {
    const text = await file.text();
    if (text.includes('\u0000')) throw new HttpError(422, 'That file isn’t plain text.');
    html = ext === '.txt'
      ? text.split(/\r?\n\s*\r?\n/).map((p) => `<p>${escapeHtml(p).replace(/\r?\n/g, '<br>')}</p>`).join('')
      : await marked.parse(text);
  }
  return { title, html: sanitizeHtml(html?.trim() ? html : '<p></p>') };
}

const pause = () => new Promise((r) => setTimeout(r, 90)); // feel like a network round trip
const user = () => service.authenticate(getToken());

/** Run a service call and translate its errors into the same ApiError the HTTP client throws. */
async function call(fn) {
  await pause();
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.status === 401) window.dispatchEvent(new Event('inkwell:unauthorized'));
      throw new ApiError(e.status, e.message, e.body ?? { error: e.message });
    }
    throw e;
  }
}

export const demoApi = {
  login: (email, password) => call(() => service.login(email, password)),
  logout: () => call(() => service.logout(getToken())),
  me: () => call(async () => service.me(await user())),
  users: () => call(async () => service.listUsers(await user())),
  listDocs: () => call(async () => service.listDocs(await user())),
  createDoc: (data = {}) => call(async () => service.createDoc(await user(), data)),
  getDoc: (id) => call(async () => service.getDoc(await user(), id)),
  updateDoc: (id, data) => call(async () => service.updateDoc(await user(), id, data)),
  deleteDoc: (id) => call(async () => service.deleteDoc(await user(), id)),
  importDoc: (file) => call(async () => {
    const u = await user();
    const { title, html } = await fileToHtml(file);
    return service.createDoc(u, { title, content: html, source: file.name });
  }),
  convertFile: (file) => call(async () => { await user(); return fileToHtml(file); }),
  share: (id, email, role) => call(async () => service.share(await user(), id, { email, role })),
  unshare: (id, uid) => call(async () => service.unshare(await user(), id, uid)),
  heartbeat: (id) => call(async () => service.heartbeat(await user(), id)),
  versions: (id) => call(async () => service.listVersions(await user(), id)),
  version: (id, n) => call(async () => service.getVersion(await user(), id, n)),
  restoreVersion: (id, n) => call(async () => service.restoreVersion(await user(), id, n)),
  comments: (id) => call(async () => service.listComments(await user(), id)),
  addComment: (id, data) => call(async () => service.addComment(await user(), id, data)),
  resolveComment: (id, cid, resolved) => call(async () => service.setCommentResolved(await user(), id, cid, resolved)),
  deleteComment: (id, cid) => call(async () => service.deleteComment(await user(), id, cid)),
};
