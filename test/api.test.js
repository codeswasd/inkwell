import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { memoryKV } from '../shared/kv.js';
import { SEED_PASSWORD } from '../server/users.js';

let app;
beforeEach(() => {
  app = createApp({ kv: memoryKV() });
});

async function login(name) {
  const res = await request(app).post('/api/auth/login').send({ email: `${name}@ajaia.dev`, password: SEED_PASSWORD });
  assert.equal(res.status, 200, res.text);
  return { Authorization: `Bearer ${res.body.token}` };
}
const newDoc = async (who, body = {}) => (await request(app).post('/api/documents').set(who).send(body)).body;

test('auth: bad credentials and missing tokens are rejected on every protected route', async () => {
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'alice@ajaia.dev', password: 'nope' })).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({})).status, 400);
  for (const [method, path] of [['get', '/api/documents'], ['post', '/api/documents'], ['get', '/api/documents/welcome'],
    ['patch', '/api/documents/welcome'], ['get', '/api/documents/welcome/comments'], ['get', '/api/documents/welcome/versions']]) {
    assert.equal((await request(app)[method](path)).status, 401, `${method} ${path}`);
  }
  const alice = await login('alice');
  await request(app).post('/api/auth/logout').set(alice);
  assert.equal((await request(app).get('/api/documents').set(alice)).status, 401, 'token dies on logout');
});

test('seed: Alice owns the welcome doc and Bob sees it as shared, with a comment thread', async () => {
  const bob = await login('bob');
  const list = await request(app).get('/api/documents').set(bob);
  assert.equal(list.body.shared[0].id, 'welcome');
  assert.equal(list.body.shared[0].role, 'editor');
  const comments = await request(app).get('/api/documents/welcome/comments').set(bob);
  assert.equal(comments.body.items.length, 1);
});

test('documents: create, rename, edit, reopen with formatting preserved', async () => {
  const alice = await login('alice');
  const doc = await newDoc(alice);
  assert.equal(doc.title, 'Untitled document');
  const html = '<h2>Heading</h2><p><strong>bold</strong> <em>it</em> <u>u</u></p><ul><li><p>one</p></li></ul><ol><li><p>two</p></li></ol>';
  const saved = await request(app).patch(`/api/documents/${doc.id}`).set(alice).send({ title: '  Road   map ', content: html, baseVersion: doc.version });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.title, 'Road map');
  const reopened = await request(app).get(`/api/documents/${doc.id}`).set(alice);
  assert.equal(reopened.body.content, html);
  assert.equal(reopened.body.version, 2);
});

test('validation: empty title, oversize content, script injection, stale version', async () => {
  const alice = await login('alice');
  const doc = await newDoc(alice, { title: 'A' });
  assert.equal((await request(app).patch(`/api/documents/${doc.id}`).set(alice).send({ title: '  ' })).status, 400);
  assert.equal((await request(app).patch(`/api/documents/${doc.id}`).set(alice).send({})).status, 400);
  assert.equal((await request(app).patch(`/api/documents/${doc.id}`).set(alice).send({ title: 'x'.repeat(201) })).status, 400);
  const evil = await request(app).patch(`/api/documents/${doc.id}`).set(alice)
    .send({ content: '<p onclick="steal()">hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>' });
  assert.doesNotMatch(evil.body.content, /onclick|<script|javascript:/);
  await request(app).patch(`/api/documents/${doc.id}`).set(alice).send({ content: '<p>v3</p>', baseVersion: 2 });
  const stale = await request(app).patch(`/api/documents/${doc.id}`).set(alice).send({ content: '<p>old</p>', baseVersion: 2 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.latest.content, '<p>v3</p>');
  assert.equal((await request(app).get('/api/documents/..%2Fsession').set(alice)).status, 400, 'path-like ids rejected');
  assert.equal((await request(app).post('/api/documents').set(alice).set('Content-Type', 'application/json').send('[1,2]')).status, 400);
  assert.equal((await request(app).post('/api/documents').set(alice).set('Content-Type', 'application/json').send('{bad')).status, 400);
});

test('sharing: owner grants, roles enforced, lists separate owned vs shared, revoke removes access', async () => {
  const [alice, bob, carol] = [await login('alice'), await login('bob'), await login('carol')];
  const doc = await newDoc(alice, { title: 'Secret plan' });
  const path = `/api/documents/${doc.id}`;
  assert.equal((await request(app).get(path).set(bob)).status, 404, 'no access hides existence');
  assert.equal((await request(app).post(`${path}/shares`).set(bob).send({ email: 'carol@ajaia.dev' })).status, 404);
  assert.equal((await request(app).post(`${path}/shares`).set(alice).send({ email: 'nobody@x.dev' })).status, 404);
  assert.equal((await request(app).post(`${path}/shares`).set(alice).send({ email: 'alice@ajaia.dev' })).status, 400);
  assert.equal((await request(app).post(`${path}/shares`).set(alice).send({ email: 'bob@ajaia.dev', role: 'admin' })).status, 400);
  assert.equal((await request(app).post(`${path}/shares`).set(alice).send({ email: 'bob@ajaia.dev', role: 'viewer' })).status, 201);

  const bobList = (await request(app).get('/api/documents').set(bob)).body;
  assert.ok(bobList.shared.some((d) => d.id === doc.id && d.role === 'viewer'));
  assert.ok(!bobList.owned.some((d) => d.id === doc.id));

  assert.equal((await request(app).patch(path).set(bob).send({ content: '<p>hi</p>' })).status, 403, 'viewer cannot edit');
  await request(app).post(`${path}/shares`).set(alice).send({ email: 'bob@ajaia.dev', role: 'editor' });
  assert.equal((await request(app).patch(path).set(bob).send({ content: '<p>hi</p>' })).status, 200, 'editor can edit');
  assert.equal((await request(app).delete(path).set(bob)).status, 403, 'editor cannot delete');
  assert.equal((await request(app).post(`${path}/shares`).set(bob).send({ email: 'carol@ajaia.dev' })).status, 403, 'editor cannot share');
  assert.equal((await request(app).get(path).set(carol)).status, 404);

  await request(app).delete(`${path}/shares/bob`).set(alice);
  assert.equal((await request(app).get(path).set(bob)).status, 404, 'revoked');
  assert.ok(!(await request(app).get('/api/documents').set(bob)).body.shared.some((d) => d.id === doc.id));
});

test('collaboration: two editors see each other, and a stale save is a 409 not a silent overwrite', async () => {
  const [alice, bob] = [await login('alice'), await login('bob')];
  const doc = await newDoc(alice);
  await request(app).post(`/api/documents/${doc.id}/shares`).set(alice).send({ email: 'bob@ajaia.dev' });
  await request(app).post(`/api/documents/${doc.id}/heartbeat`).set(alice);
  const hb = await request(app).post(`/api/documents/${doc.id}/heartbeat`).set(bob);
  assert.deepEqual(hb.body.active.map((u) => u.id).sort(), ['alice', 'bob']);

  const a = await request(app).patch(`/api/documents/${doc.id}`).set(alice).send({ content: '<p>Alice</p>', baseVersion: 1 });
  assert.equal(a.status, 200);
  const b = await request(app).patch(`/api/documents/${doc.id}`).set(bob).send({ content: '<p>Bob</p>', baseVersion: 1 });
  assert.equal(b.status, 409);
  const after = await request(app).post(`/api/documents/${doc.id}/heartbeat`).set(bob);
  assert.equal(after.body.version, 2, 'heartbeat tells Bob a newer version exists');
});

test('versions: edits are snapshotted, previewable and restorable', async () => {
  const alice = await login('alice');
  const doc = await newDoc(alice, { title: 'Draft', content: '<p>first</p>' });
  await request(app).patch(`/api/documents/${doc.id}`).set(alice).send({ content: '<p>second</p>' });
  const bob = await login('bob');
  await request(app).post(`/api/documents/${doc.id}/shares`).set(alice).send({ email: 'bob@ajaia.dev' });
  await request(app).patch(`/api/documents/${doc.id}`).set(bob).send({ content: '<p>third by bob</p>' });

  const list = (await request(app).get(`/api/documents/${doc.id}/versions`).set(alice)).body;
  assert.deepEqual(list.entries.map((e) => e.label), ['Edited', 'Edited', 'Created']);
  assert.equal(list.entries[0].by.id, 'bob', 'a different author starts a new version');
  const created = list.entries.at(-1);
  const v1 = (await request(app).get(`/api/documents/${doc.id}/versions/${created.n}`).set(alice)).body;
  assert.equal(v1.content, '<p>first</p>');

  const carol = await login('carol');
  assert.equal((await request(app).get(`/api/documents/${doc.id}/versions`).set(carol)).status, 404);
  await request(app).post(`/api/documents/${doc.id}/shares`).set(alice).send({ email: 'carol@ajaia.dev', role: 'viewer' });
  assert.equal((await request(app).post(`/api/documents/${doc.id}/versions/${created.n}/restore`).set(carol)).status, 403);

  const restored = await request(app).post(`/api/documents/${doc.id}/versions/${created.n}/restore`).set(alice);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.content, '<p>first</p>');
  const after = (await request(app).get(`/api/documents/${doc.id}/versions`).set(alice)).body;
  assert.match(after.entries[0].label, /^Restored/);
  assert.equal((await request(app).get(`/api/documents/${doc.id}/versions/999`).set(alice)).status, 404);
});

test('comments: threads, replies, resolve rules, delete rules, viewers comment without anchoring', async () => {
  const [alice, bob, carol] = [await login('alice'), await login('bob'), await login('carol')];
  const doc = await newDoc(alice, { content: '<p>Budget is 10k</p>' });
  const base = `/api/documents/${doc.id}`;
  await request(app).post(`${base}/shares`).set(alice).send({ email: 'bob@ajaia.dev', role: 'viewer' });
  await request(app).post(`${base}/shares`).set(alice).send({ email: 'carol@ajaia.dev', role: 'editor' });

  assert.equal((await request(app).post(`${base}/comments`).set(alice).send({ body: '   ' })).status, 400);
  const thread = (await request(app).post(`${base}/comments`).set(carol).send({ body: 'Is this final?', quote: '10k', anchored: true })).body;
  assert.equal(thread.anchored, true);
  const viewerThread = (await request(app).post(`${base}/comments`).set(bob).send({ body: 'Typo?', quote: 'Budget', anchored: true })).body;
  assert.equal(viewerThread.anchored, false, 'viewers cannot write highlights into the doc');

  const reply = await request(app).post(`${base}/comments`).set(alice).send({ body: 'Yes', parentId: thread.id });
  assert.equal(reply.status, 201);
  assert.equal((await request(app).patch(`${base}/comments/${thread.id}`).set(bob).send({ resolved: true })).status, 403);
  assert.equal((await request(app).patch(`${base}/comments/${viewerThread.id}`).set(bob).send({ resolved: true })).status, 200, 'author may resolve own');
  assert.equal((await request(app).patch(`${base}/comments/${thread.id}`).set(carol).send({ resolved: true })).body.resolved, true);

  assert.equal((await request(app).delete(`${base}/comments/${thread.id}`).set(bob)).status, 403);
  assert.equal((await request(app).delete(`${base}/comments/${reply.body.id}`).set(alice)).status, 204);
  assert.equal((await request(app).delete(`${base}/comments/${thread.id}`).set(alice)).status, 204, 'owner may delete any');
  const list = (await request(app).get(`${base}/comments`).set(bob)).body;
  assert.deepEqual(list.items.map((c) => c.id), [viewerThread.id]);
  const hb = (await request(app).post(`${base}/heartbeat`).set(bob)).body;
  assert.equal(hb.commentsRev, list.rev, 'heartbeat exposes the comments revision for live refresh');
});

test('uploads: md and docx become editable docs; bad types, binary and oversize are rejected', async () => {
  const alice = await login('alice');
  const md = Buffer.from('# Notes\n\n- **one**\n- two\n\n<script>alert(1)</script>');
  const ok = await request(app).post('/api/documents/import').set(alice).attach('file', md, 'meeting-notes.md');
  assert.equal(ok.status, 201);
  assert.equal(ok.body.title, 'meeting-notes');
  assert.match(ok.body.content, /<h1>Notes<\/h1>/);
  assert.match(ok.body.content, /<strong>one<\/strong>/);
  assert.doesNotMatch(ok.body.content, /<script/);
  const hist = (await request(app).get(`/api/documents/${ok.body.id}/versions`).set(alice)).body;
  assert.equal(hist.entries[0].label, 'Imported from meeting-notes.md');

  const docx = readFileSync(new URL('./fixtures/sample.docx', import.meta.url));
  const d = await request(app).post('/api/documents/import').set(alice).attach('file', docx, 'brief.docx');
  assert.equal(d.status, 201);
  assert.match(d.body.content, /<h1>Docx Title<\/h1>/);
  assert.match(d.body.content, /<ul><li>/);

  const txt = await request(app).post('/api/import/convert').set(alice).attach('file', Buffer.from('a <b>\n\nnext'), 'x.txt');
  assert.equal(txt.body.html, '<p>a &lt;b&gt;</p><p>next</p>');

  assert.equal((await request(app).post('/api/documents/import').set(alice).attach('file', Buffer.from('x'), 'image.png')).status, 415);
  assert.equal((await request(app).post('/api/documents/import').set(alice).attach('file', Buffer.from([0, 1, 2]), 'bin.txt')).status, 422);
  assert.equal((await request(app).post('/api/documents/import').set(alice).attach('file', Buffer.from('PK broken'), 'bad.docx')).status, 422);
  assert.equal((await request(app).post('/api/documents/import').set(alice).attach('file', Buffer.alloc(4 * 1024 * 1024 + 1, 97), 'big.txt')).status, 413);
  assert.equal((await request(app).post('/api/documents/import').set(alice)).status, 400);
});

test('delete removes the doc, its history, comments and everyone’s access', async () => {
  const [alice, bob] = [await login('alice'), await login('bob')];
  const doc = await newDoc(alice);
  await request(app).post(`/api/documents/${doc.id}/shares`).set(alice).send({ email: 'bob@ajaia.dev' });
  await request(app).post(`/api/documents/${doc.id}/comments`).set(bob).send({ body: 'hi' });
  assert.equal((await request(app).delete(`/api/documents/${doc.id}`).set(alice)).status, 204);
  assert.equal((await request(app).get(`/api/documents/${doc.id}`).set(alice)).status, 404);
  assert.ok(!(await request(app).get('/api/documents').set(bob)).body.shared.some((d) => d.id === doc.id));
});
