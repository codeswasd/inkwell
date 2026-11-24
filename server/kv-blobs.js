// Netlify Blobs backend. update() is safe at two levels:
//  - within one function instance, updates to a key are queued (keyedMutex), so they never race;
//  - across instances, writes are conditional on the ETag read (compare-and-swap) and retried on conflict.
import { getStore } from '@netlify/blobs';
import { keyedMutex } from '../shared/kv.js';

const MAX_RETRIES = 10;
const backoff = (attempt) => new Promise((r) => setTimeout(r, 15 * (attempt + 1) + Math.random() * 25));

export function blobsKV({ name = 'inkwell', storeOptions } = {}) {
  // Resolve lazily: on Netlify the store's credentials arrive with each invocation (connectLambda).
  const store = () => getStore({ name, consistency: 'strong', ...storeOptions });
  const lock = keyedMutex();

  return {
    async get(key) {
      return (await store().get(key, { type: 'json' })) ?? null;
    },
    async set(key, value) {
      await store().setJSON(key, value);
    },
    async del(key) {
      await store().delete(key);
    },
    async list(prefix) {
      const { blobs } = await store().list({ prefix });
      return blobs.map((b) => b.key).sort();
    },
    update: (key, fn) => lock(key, () => casUpdate(key, fn)),
  };

  async function casUpdate(key, fn) {
    {
      const s = store();
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const found = await s.getWithMetadata(key, { type: 'json' });
        const cur = found?.data ?? null;
        // Production returns the ETag with the read. Netlify's local dev server only reports it via list().
        const etag = found && (found.etag ?? (await s.list({ prefix: key })).blobs.find((b) => b.key === key)?.etag);
        if (found && !etag) { await backoff(attempt); continue; } // mid-write elsewhere: read again
        const next = await fn(cur === null ? null : structuredClone(cur));
        if (next === undefined) return cur;
        const res = found
          ? await s.setJSON(key, next, { onlyIfMatch: etag })
          : await s.setJSON(key, next, { onlyIfNew: true });
        if (res?.modified !== false) return next;
        await backoff(attempt); // lost the race to another writer: read again
      }
      throw Object.assign(new Error('Storage is busy. Try again.'), { status: 503 });
    }
  }
}
