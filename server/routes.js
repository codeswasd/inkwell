// One route table, served by two adapters: Express (server/app.js) and the
// web-standard Request/Response handler used on Netlify (netlify/functions/api.mjs).
import { createService, HttpError } from '../shared/service.js';
import { fileToHtml } from './importer.js';
import { USERS, checkPassword } from './users.js';

export const NO_CONTENT = Symbol('no-content');
export const JSON_LIMIT_BYTES = 3 * 1024 * 1024;

export function createRoutes(kv) {
  const s = createService({ kv, users: USERS, checkPassword });
  const needFile = (file) => {
    if (!file) throw new HttpError(400, 'Attach a .txt, .md or .docx file.');
    return file;
  };
  // [method, path, options, handler]; handlers receive { user, token, params, body, file }
  const routes = [
    ['GET', '/api/health', { auth: false }, () => ({ ok: true })],
    ['POST', '/api/auth/login', { auth: false }, ({ body }) => s.login(body?.email, body?.password)],
    ['POST', '/api/auth/logout', {}, async ({ token }) => { await s.logout(token); return NO_CONTENT; }],
    ['GET', '/api/me', {}, ({ user }) => s.me(user)],
    ['GET', '/api/users', {}, ({ user }) => s.listUsers(user)],

    ['GET', '/api/documents', {}, ({ user }) => s.listDocs(user)],
    ['POST', '/api/documents', { status: 201 }, ({ user, body }) => s.createDoc(user, body ?? {})],
    ['POST', '/api/documents/import', { status: 201, file: true }, async ({ user, file }) => {
      const f = needFile(file);
      const { title, html } = await fileToHtml(f.name, f.buffer);
      return s.createDoc(user, { title, content: html, source: f.name });
    }],
    ['POST', '/api/import/convert', { file: true }, ({ file }) => {
      const f = needFile(file);
      return fileToHtml(f.name, f.buffer);
    }],
    ['GET', '/api/documents/:id', {}, ({ user, params }) => s.getDoc(user, params.id)],
    ['PATCH', '/api/documents/:id', {}, ({ user, params, body }) => s.updateDoc(user, params.id, body ?? {})],
    ['DELETE', '/api/documents/:id', {}, async ({ user, params }) => { await s.deleteDoc(user, params.id); return NO_CONTENT; }],

    ['POST', '/api/documents/:id/shares', { status: 201 }, ({ user, params, body }) => s.share(user, params.id, body ?? {})],
    ['DELETE', '/api/documents/:id/shares/:userId', {}, async ({ user, params }) => {
      await s.unshare(user, params.id, params.userId);
      return NO_CONTENT;
    }],

    ['POST', '/api/documents/:id/heartbeat', {}, ({ user, params }) => s.heartbeat(user, params.id)],

    ['GET', '/api/documents/:id/versions', {}, ({ user, params }) => s.listVersions(user, params.id)],
    ['GET', '/api/documents/:id/versions/:n', {}, ({ user, params }) => s.getVersion(user, params.id, params.n)],
    ['POST', '/api/documents/:id/versions/:n/restore', {}, ({ user, params }) => s.restoreVersion(user, params.id, params.n)],

    ['GET', '/api/documents/:id/comments', {}, ({ user, params }) => s.listComments(user, params.id)],
    ['POST', '/api/documents/:id/comments', { status: 201 }, ({ user, params, body }) => s.addComment(user, params.id, body ?? {})],
    ['PATCH', '/api/documents/:id/comments/:cid', {}, ({ user, params, body }) =>
      s.setCommentResolved(user, params.id, params.cid, body?.resolved)],
    ['DELETE', '/api/documents/:id/comments/:cid', {}, async ({ user, params }) => {
      await s.deleteComment(user, params.id, params.cid);
      return NO_CONTENT;
    }],
  ].map(([method, path, opts, handler]) => ({ method, path, opts: { auth: true, status: 200, ...opts }, handler, ...compile(path) }));

  return { service: s, routes, authenticate: (token) => s.authenticate(token) };
}

function compile(path) {
  const keys = [];
  const src = path.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return '([^/]+)'; });
  return { regex: new RegExp(`^${src}/?$`), keys };
}

/** Find the route for a method + path. Returns { route, params } or a 404/405 marker. */
export function matchRoute(routes, method, path) {
  let pathMatched = false;
  for (const r of routes) {
    const m = r.regex.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return { route: r, params };
  }
  return { route: null, status: pathMatched ? 405 : 404 };
}

/** Shape any thrown error into { status, body }; never leak internals on 5xx. */
export function errorPayload(err) {
  const status = err?.status || 500;
  if (status >= 500) console.error(err);
  if (err?.body) return { status, body: err.body };
  return { status, body: { error: status >= 500 ? 'Something went wrong on our side. Try again.' : err.message } };
}

export function assertObject(body) {
  if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body))) {
    throw new HttpError(400, 'Expected a JSON object.');
  }
}

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};
