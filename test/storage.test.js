// The same storage contract, run against every backend the app can use in production.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlobsServer } from '@netlify/blobs/server';
import { memoryKV } from '../shared/kv.js';
import { fileKV } from '../server/kv-file.js';
import { blobsKV } from '../server/kv-blobs.js';

// Never touch a real Netlify store: Netlify builds can expose live Blobs credentials, which the
// client would otherwise prefer over the local test server below.
delete process.env.NETLIFY_BLOBS_CONTEXT;
delete globalThis.netlifyBlobsContext;

const tmp = mkdtempSync(join(tmpdir(), 'inkwell-kv-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

// Full service on top of Netlify Blobs: the production storage path, end to end.
test('service on netlify blobs: seed, share, edit conflict, comment, version', async () => {
  const { kv, stop } = await startBlobs();
  const { createService } = await import('../shared/service.js');
  const users = [
    { id: 'alice', name: 'Alice Chen', email: 'alice@ajaia.dev', color: '#fff' },
    { id: 'bob', name: 'Bob Rivera', email: 'bob@ajaia.dev', color: '#fff' },
  ];
  const svc = createService({ kv, users, checkPassword: (_u, p) => p === 'pw' });
  try {
    const [alice, bob] = users;
    await svc.login('alice@ajaia.dev', 'pw');
    assert.equal((await svc.listDocs(bob)).shared[0].id, 'welcome');
    const doc = await svc.createDoc(alice, { title: 'On blobs' });
    await svc.share(alice, doc.id, { email: 'bob@ajaia.dev', role: 'editor' });
    await svc.updateDoc(alice, doc.id, { content: '<p>a</p>', baseVersion: 1 });
    await assert.rejects(svc.updateDoc(bob, doc.id, { content: '<p>b</p>', baseVersion: 1 }), { status: 409 });
    await svc.addComment(bob, doc.id, { body: 'Looks good' });
    assert.equal((await svc.listComments(alice, doc.id)).items.length, 1);
    assert.ok((await svc.listVersions(alice, doc.id)).entries.length >= 2);
    await svc.deleteDoc(alice, doc.id);
    assert.deepEqual(await kv.list(`doc/${doc.id}/`), []);
  } finally {
    await stop();
  }
});

test('netlify blobs: a write that races another instance is rejected and retried (compare-and-swap)', async () => {
  const { kv: instanceA, stop, storeOptions } = await startBlobs();
  const instanceB = blobsKV({ name: 'inkwell-test', storeOptions }); // a second function instance: separate client, no shared lock
  try {
    await instanceA.set('counter', { n: 0 });
    let calls = 0;
    const result = await instanceA.update('counter', async (cur) => {
      calls += 1;
      if (calls === 1) await instanceB.set('counter', { n: 100 }); // B writes between A's read and A's write
      return { n: cur.n + 1 };
    });
    assert.equal(calls, 2, 'first attempt was rejected because the ETag changed');
    assert.deepEqual(result, { n: 101 });
    assert.deepEqual(await instanceB.get('counter'), { n: 101 }, 'B’s write was not lost');
  } finally {
    await stop();
  }
});

async function startBlobs() {
  const token = 'test-token';
  const server = new BlobsServer({ directory: mkdtempSync(join(tmp, 'blobs-')), token, port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  const storeOptions = { siteID: 'test-site', token, edgeURL: url, uncachedEdgeURL: url };
  return { kv: blobsKV({ name: 'inkwell-test', storeOptions }), storeOptions, stop: () => server.stop() };
}

const backends = {
  memory: async () => ({ kv: memoryKV(), stop: () => {} }),
  file: async () => ({ kv: fileKV(join(tmp, 'files')), stop: () => {} }),
  'netlify blobs': startBlobs,
};

for (const [name, make] of Object.entries(backends)) {
  test(`kv contract: ${name}`, async () => {
    const { kv, stop } = await make();
    try {
      assert.equal(await kv.get('doc/missing'), null);
      await kv.set('doc/a/main', { n: 1 });
      await kv.set('doc/a/snap/1', { x: 1 });
      await kv.set('doc/b/main', { n: 2 });
      await kv.set('index/alice', { ids: [] });
      assert.deepEqual(await kv.get('doc/a/main'), { n: 1 });
      assert.deepEqual(await kv.list('doc/a/'), ['doc/a/main', 'doc/a/snap/1']);
      assert.deepEqual((await kv.list('doc/')).filter((k) => !k.includes('snap')), ['doc/a/main', 'doc/b/main']);

      // update(): abort leaves the value untouched
      assert.deepEqual(await kv.update('doc/a/main', () => undefined), { n: 1 });
      // update(): 25 concurrent increments must not lose a single write
      await Promise.all(Array.from({ length: 25 }, () => kv.update('counter', (c) => ({ n: (c?.n ?? 0) + 1 }))));
      assert.equal((await kv.get('counter')).n, 25);

      await kv.del('doc/a/main');
      assert.equal(await kv.get('doc/a/main'), null);
    } finally {
      await stop();
    }
  });
}
