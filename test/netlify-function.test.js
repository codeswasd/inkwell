// Runs the real Netlify Function module the way Netlify does: web Request in, Response out,
// Blobs configured through NETLIFY_BLOBS_CONTEXT, against a local Netlify Blobs server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlobsServer } from '@netlify/blobs/server';

let server;
let handler;
const dir = mkdtempSync(join(tmpdir(), 'inkwell-fn-'));

const realContext = process.env.NETLIFY_BLOBS_CONTEXT; // restored after; replaced so a build never hits live data
delete globalThis.netlifyBlobsContext;

before(async () => {
  server = new BlobsServer({ directory: dir, token: 'fn-token', port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(
    JSON.stringify({ siteID: 'site', token: 'fn-token', edgeURL: url, uncachedEdgeURL: url })
  ).toString('base64');
  handler = (await import('../netlify/functions/api.mjs')).default;
});
after(async () => {
  await server.stop();
  if (realContext) process.env.NETLIFY_BLOBS_CONTEXT = realContext;
  else delete process.env.NETLIFY_BLOBS_CONTEXT;
  rmSync(dir, { recursive: true, force: true });
});

const BASE = 'https://inkwell.example';
const call = async (method, path, { token, json, form } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await handler(new Request(BASE + path, { method, headers, body }));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
};

test('netlify function: full flow over web Request/Response on Netlify Blobs', async () => {
  assert.equal((await call('GET', '/api/health')).status, 200);
  // Netlify can deliver the rewritten path; both spellings must route.
  assert.equal((await call('GET', '/.netlify/functions/api/health')).status, 200);
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.equal((await call('PUT', '/api/documents')).status, 405);
  assert.equal((await call('GET', '/api/documents')).status, 401);

  const alice = (await call('POST', '/api/auth/login', { json: { email: 'alice@ajaia.dev', password: 'demo1234' } })).body.token;
  const bob = (await call('POST', '/api/auth/login', { json: { email: 'bob@ajaia.dev', password: 'demo1234' } })).body.token;
  assert.ok(alice && bob);

  const created = await call('POST', '/api/documents', { token: alice, json: { title: 'From the edge' } });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('x-content-type-options'), 'nosniff');
  const id = created.body.id;
  assert.equal((await call('PATCH', `/api/documents/${id}`, { token: alice, json: { content: '<p><strong>hi</strong></p>', baseVersion: 1 } })).status, 200);
  assert.equal((await call('POST', `/api/documents/${id}/shares`, { token: alice, json: { email: 'bob@ajaia.dev', role: 'editor' } })).status, 201);
  assert.equal((await call('PATCH', `/api/documents/${id}`, { token: bob, json: { content: '<p>stale</p>', baseVersion: 1 } })).status, 409);

  // multipart upload through the web handler
  const form = new FormData();
  form.append('file', new Blob([readFileSync(new URL('./fixtures/sample.docx', import.meta.url))]), 'brief.docx');
  const imported = await call('POST', '/api/documents/import', { token: bob, form });
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  assert.match(imported.body.content, /<h1>Docx Title<\/h1>/);
  const bad = new FormData();
  bad.append('file', new Blob(['x']), 'photo.png');
  assert.equal((await call('POST', '/api/documents/import', { token: bob, form: bad })).status, 415);

  assert.equal((await call('POST', `/api/documents/${id}/comments`, { token: bob, json: { body: 'Ship it' } })).status, 201);
  assert.equal((await call('GET', `/api/documents/${id}/versions`, { token: alice })).body.entries.length >= 2, true);
  assert.equal((await call('POST', '/api/documents', { token: alice, json: '{bad' })).status, 400);
  const malformed = await handler(new Request(`${BASE}/api/documents`, {
    method: 'POST', headers: { authorization: `Bearer ${alice}`, 'content-type': 'application/json' }, body: '{nope',
  }));
  assert.equal(malformed.status, 400);

  const lists = (await call('GET', '/api/documents', { token: bob })).body;
  assert.ok(lists.shared.some((d) => d.id === id));
  assert.ok(lists.owned.some((d) => d.id === imported.body.id));
});
