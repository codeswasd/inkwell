#!/usr/bin/env node
// Run the production Netlify setup locally, with no Netlify account or CLI:
//   static dist/ + SPA fallback, /api/* -> netlify/functions/api.mjs, storage in a local Netlify Blobs server.
// Usage: npm run build && npm run preview:netlify   (PORT defaults to 8888)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { BlobsServer } from '@netlify/blobs/server';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const blobsDir = process.env.BLOBS_DIR || join(root, 'data', 'netlify-blobs');
mkdirSync(blobsDir, { recursive: true });

const blobs = new BlobsServer({ directory: blobsDir, token: 'local', port: 0 });
const { port: blobsPort } = await blobs.start();
const edge = `http://localhost:${blobsPort}`;
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ siteID: 'local', token: 'local', edgeURL: edge, uncachedEdgeURL: edge })).toString('base64');
const fn = (await import('../netlify/functions/api.mjs')).default;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    // Same rewrite as netlify.toml: /api/* -> /.netlify/functions/api/:splat
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
    const response = await fn(new Request(new URL(`/.netlify/functions/api${url.pathname.slice(4)}${url.search}`, url), {
      method: req.method, headers: req.headers, body,
    }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  const file = normalize(join(dist, decodeURIComponent(url.pathname)));
  const target = file.startsWith(dist) && (await stat(file).catch(() => null))?.isFile() ? file : join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[extname(target)] || 'application/octet-stream' });
  res.end(await readFile(target));
});

const port = Number(process.env.PORT) || 8888;
server.listen(port, () => console.log(`Netlify-style preview on http://localhost:${port} (Blobs data in ${blobsDir})`));
