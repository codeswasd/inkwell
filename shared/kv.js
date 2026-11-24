// Key-value storage contract used by the service layer. Every backend implements:
//   get(key) -> value | null          set(key, value)          del(key)
//   list(prefix) -> string[]          update(key, fn) -> next value (atomic read-modify-write)
// `update` calls fn(current|null); returning undefined aborts and leaves the value unchanged.

/** Serializes async work per key inside one process (used by the memory and file backends). */
export function keyedMutex() {
  const tails = new Map();
  return async function withLock(key, task) {
    const prev = tails.get(key) || Promise.resolve();
    let release;
    const mine = new Promise((r) => (release = r));
    tails.set(key, prev.then(() => mine));
    await prev;
    try {
      return await task();
    } finally {
      release();
      if (tails.get(key) === mine || tails.size > 1000) tails.delete(key);
    }
  };
}

const clone = (v) => (v === null || v === undefined ? null : JSON.parse(JSON.stringify(v)));

/** In-memory backend: tests, and the base for the browser demo's localStorage backend. */
export function memoryKV(initial = {}, { onChange } = {}) {
  const data = new Map(Object.entries(initial));
  const lock = keyedMutex();
  const kv = {
    async get(key) { return clone(data.get(key) ?? null); },
    async set(key, value) { data.set(key, clone(value)); onChange?.(data); },
    async del(key) { data.delete(key); onChange?.(data); },
    async list(prefix) { return [...data.keys()].filter((k) => k.startsWith(prefix)).sort(); },
    async update(key, fn) {
      return lock(key, async () => {
        const next = await fn(clone(data.get(key) ?? null));
        if (next === undefined) return clone(data.get(key) ?? null);
        data.set(key, clone(next));
        onChange?.(data);
        return clone(next);
      });
    },
    _dump: () => Object.fromEntries(data),
  };
  return kv;
}
