// Web-standard adapter (Request -> Response) for the shared route table.
// Used by the Netlify Function; works in any runtime with fetch primitives.
import { HttpError } from '../shared/service.js';
import { MAX_UPLOAD_BYTES } from '../shared/html.js';
import { createRoutes, matchRoute, NO_CONTENT, errorPayload, SECURITY_HEADERS, JSON_LIMIT_BYTES, assertObject } from './routes.js';

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS },
  });

export function createFetchHandler({ kv }) {
  const { routes, authenticate } = createRoutes(kv);

  return async function handle(request) {
    try {
      const url = new URL(request.url);
      // Netlify may hand us the rewritten function path; normalise it to /api/...
      const path = url.pathname.replace(/^\/\.netlify\/functions\/api/, '/api');
      const { route, params, status } = matchRoute(routes, request.method, path);
      if (!route) return json(status, { error: status === 405 ? 'Method not allowed.' : 'Not found.' });

      const ctx = { params, body: undefined, file: undefined };
      if (route.opts.auth) {
        ctx.token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
        ctx.user = await authenticate(ctx.token);
      }
      const type = request.headers.get('content-type') || '';
      const declared = Number(request.headers.get('content-length') || 0);
      if (route.opts.file) {
        if (declared > MAX_UPLOAD_BYTES + 64 * 1024) throw new HttpError(413, 'File is too large (4 MB max).');
        if (!type.includes('multipart/form-data')) throw new HttpError(400, 'Attach a .txt, .md or .docx file.');
        const form = await request.formData();
        const f = form.get('file');
        if (f && typeof f === 'object') {
          if (f.size > MAX_UPLOAD_BYTES) throw new HttpError(413, 'File is too large (4 MB max).');
          ctx.file = { name: f.name || 'upload', buffer: Buffer.from(await f.arrayBuffer()) };
        }
      } else if (!['GET', 'HEAD'].includes(request.method)) {
        const text = await request.text();
        if (Buffer.byteLength(text) > JSON_LIMIT_BYTES) throw new HttpError(413, 'That request is too large.');
        if (text) {
          try { ctx.body = JSON.parse(text); } catch { throw new HttpError(400, 'Malformed JSON.'); }
          assertObject(ctx.body);
        }
      }

      const out = await route.handler(ctx);
      if (out === NO_CONTENT) return new Response(null, { status: 204, headers: { ...SECURITY_HEADERS, 'Cache-Control': 'no-store' } });
      return json(route.opts.status, out);
    } catch (err) {
      const { status, body } = errorPayload(err);
      return json(status, body);
    }
  };
}
