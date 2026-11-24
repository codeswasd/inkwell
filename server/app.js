// Express adapter for the shared route table (local dev, Render, Docker).
import express from 'express';
import multer from 'multer';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError } from '../shared/service.js';
import { MAX_UPLOAD_BYTES } from '../shared/html.js';
import { createRoutes, NO_CONTENT, errorPayload, SECURITY_HEADERS, JSON_LIMIT_BYTES, assertObject } from './routes.js';

export function createApp({ kv, staticDir } = {}) {
  const { routes, authenticate } = createRoutes(kv);
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.set(SECURITY_HEADERS); next(); });
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: JSON_LIMIT_BYTES }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }).single('file');

  for (const r of routes) {
    const chain = [];
    if (r.opts.auth) {
      chain.push(async (req, _res, next) => {
        req.token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
        req.user = await authenticate(req.token);
        next();
      });
    }
    if (r.opts.file) chain.push(upload);
    chain.push(async (req, res) => {
      if (!r.opts.file && req.is('application/json')) assertObject(req.body);
      const file = req.file && { name: req.file.originalname, buffer: req.file.buffer };
      const out = await r.handler({ user: req.user, token: req.token, params: req.params, body: req.body, file });
      if (out === NO_CONTENT) return res.status(204).end();
      res.status(r.opts.status).json(out);
    });
    app[r.method.toLowerCase()](r.path, ...chain);
  }

  app.use('/api', () => { throw new HttpError(404, 'Not found.'); });

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir, {
      setHeaders: (res, p) => res.set('Cache-Control', p.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'),
    }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(staticDir, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'File is too large (4 MB max).' : err.message });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That request is too large.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON.' });
    const { status, body } = errorPayload(err);
    res.status(status).json(body);
  });

  return app;
}
