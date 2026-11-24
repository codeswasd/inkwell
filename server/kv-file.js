// File-system backend: one JSON file per key under DATA_DIR. Used for local dev, Render and Docker.
import { mkdir, readFile, writeFile, rename, rm, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { keyedMutex } from '../shared/kv.js';

const enc = (key) => key.split('/').map(encodeURIComponent).join('/') + '.json';
const dec = (rel) => rel.replace(/\.json$/, '').split('/').map(decodeURIComponent).join('/');

export function fileKV(dir) {
  const lock = keyedMutex();
  const pathOf = (key) => join(dir, enc(key));

  async function read(key) {
    try {
      return JSON.parse(await readFile(pathOf(key), 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }
  async function write(key, value) {
    const p = pathOf(key);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, JSON.stringify(value));
    await rename(tmp, p); // atomic replace: readers never see a half-written file
  }
  async function walk(base, prefix) {
    let out = [];
    let entries;
    try {
      entries = await readdir(base, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) out = out.concat(await walk(join(base, e.name), rel));
      else if (e.name.endsWith('.json')) out.push(dec(rel));
    }
    return out;
  }

  return {
    get: read,
    set: (key, value) => lock(key, () => write(key, value)),
    del: (key) => lock(key, () => rm(pathOf(key), { force: true })),
    async list(prefix) {
      // Walk only the deepest directory the prefix fully names.
      const parts = prefix.split('/');
      const dirParts = parts.slice(0, -1);
      const base = join(dir, ...dirParts.map(encodeURIComponent));
      const keys = await walk(base, dirParts.join('/'));
      return keys.filter((k) => k.startsWith(prefix)).sort();
    },
    update: (key, fn) =>
      lock(key, async () => {
        const cur = await read(key);
        const next = await fn(cur);
        if (next === undefined) return cur;
        await write(key, next);
        return next;
      }),
  };
}
