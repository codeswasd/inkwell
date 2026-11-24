// The whole product's rules live here: auth, documents, sharing, versions, comments, presence.
// Storage-agnostic (see kv.js) and runtime-agnostic, so the Express server, the Netlify function
// and the in-browser demo all run exactly the same logic.
import { sanitizeHtml, htmlToText, countWords } from './html.js';

export class HttpError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export const LIMITS = {
  title: 200,
  contentBytes: 2 * 1024 * 1024,
  comment: 2000,
  quote: 300,
  historyEntries: 50,
  sessionGapMs: 10 * 60 * 1000, // edits by the same person within 10 min fold into one version
  presenceTtlMs: 15_000,
};

const RANK = { viewer: 1, editor: 2, owner: 3 };
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const byteLength = (s) => new TextEncoder().encode(s).length;
const defaultId = () => globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);

const K = {
  session: (t) => `session/${t}`,
  index: (uid) => `index/${uid}`,
  doc: (id) => `doc/${id}/main`, // every key is a leaf (no key is a prefix of another): portable across stores
  history: (id) => `doc/${id}/history`,
  snap: (id, n) => `doc/${id}/snap/${n}`,
  comments: (id) => `doc/${id}/comments`,
  presence: (id, uid) => `presence/${id}/${uid}`,
};

export function createService({ kv, users, checkPassword, newId = defaultId, clock = () => Date.now() }) {
  const userById = new Map(users.map((u) => [u.id, u]));
  const pub = (u) => (u ? { id: u.id, name: u.name, email: u.email, color: u.color } : null);
  const iso = () => new Date(clock()).toISOString();

  // ---------- helpers ----------
  const roleFor = (doc, uid) => (doc.ownerId === uid ? 'owner' : doc.shares?.[uid] ?? null);

  async function loadDoc(user, id, need) {
    if (typeof id !== 'string' || !ID_RE.test(id)) throw new HttpError(400, 'Invalid document id.');
    const doc = await kv.get(K.doc(id));
    const role = doc && roleFor(doc, user.id);
    // 404 rather than 403 when there is no access, so document ids can't be probed.
    if (!doc || !role) throw new HttpError(404, 'Document not found.');
    if (RANK[role] < RANK[need]) {
      throw new HttpError(403, need === 'owner' ? 'Only the owner can do that.' : 'You have view-only access.');
    }
    return { doc, role };
  }

  const serialize = (doc, role, { content = false } = {}) => ({
    id: doc.id,
    title: doc.title,
    ...(content && { content: doc.html }),
    version: doc.version,
    source: doc.source ?? null,
    role,
    owner: pub(userById.get(doc.ownerId)),
    lastEditedBy: pub(userById.get(doc.lastEditedBy)),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    ...(role === 'owner' && { shareCount: Object.keys(doc.shares || {}).length }),
  });

  const validTitle = (t) => {
    if (typeof t !== 'string') throw new HttpError(400, 'Title must be text.');
    const title = t.replace(/\s+/g, ' ').trim();
    if (!title) throw new HttpError(400, 'Title cannot be empty.');
    if (title.length > LIMITS.title) throw new HttpError(400, `Title must be ${LIMITS.title} characters or fewer.`);
    return title;
  };
  const validContent = (c) => {
    if (typeof c !== 'string') throw new HttpError(400, 'Content must be an HTML string.');
    if (byteLength(c) > LIMITS.contentBytes) throw new HttpError(413, 'Document is too large (2 MB max).');
    return sanitizeHtml(c);
  };

  const addToIndex = (uid, id) =>
    kv.update(K.index(uid), (cur) => {
      const ids = cur?.ids ?? [];
      return ids.includes(id) ? undefined : { ids: [id, ...ids] };
    });
  const removeFromIndex = (uid, id) =>
    kv.update(K.index(uid), (cur) => (cur?.ids?.includes(id) ? { ids: cur.ids.filter((x) => x !== id) } : undefined));

  /** Append (or fold into) a version-history entry and store its snapshot. */
  async function recordHistory(doc, userId, { label = 'Edited', fold = true } = {}) {
    const now = clock();
    let target;
    let dropped = [];
    await kv.update(K.history(doc.id), (cur) => {
      const h = cur ?? { next: 1, entries: [] };
      const last = h.entries[h.entries.length - 1];
      const entryBase = { at: new Date(now).toISOString(), by: userId, title: doc.title, words: countWords(htmlToText(doc.html)) };
      if (fold && last && last.label === 'Edited' && label === 'Edited' && last.by === userId &&
          now - Date.parse(last.at) < LIMITS.sessionGapMs) {
        target = last.n;
        Object.assign(last, entryBase);
      } else {
        target = h.next++;
        h.entries.push({ n: target, label, ...entryBase });
        dropped = h.entries.length > LIMITS.historyEntries ? h.entries.splice(0, h.entries.length - LIMITS.historyEntries) : [];
      }
      return h;
    });
    await kv.set(K.snap(doc.id, target), { title: doc.title, html: doc.html });
    await Promise.all(dropped.map((e) => kv.del(K.snap(doc.id, e.n))));
  }

  // ---------- seed ----------
  let seeded = false;
  async function ensureSeed() {
    if (seeded) return;
    const [alice, bob] = users;
    const id = 'welcome';
    const created = await kv.update(K.doc(id), (cur) =>
      cur
        ? undefined
        : {
            id,
            ownerId: alice.id,
            title: 'Q3 Launch Plan',
            html:
              `<p>This document is <strong>owned by ${alice.name.split(' ')[0]}</strong> and <em>shared with ${bob.name.split(' ')[0]}</em>, who can edit it. ` +
              'Sign in as Bob to find it under <u>Shared with you</u>, then open the comments and version history.</p>' +
              '<h2>Goals</h2><ul><li><p>Ship the editor beta</p></li><li><p>Onboard three pilot teams</p></li></ul>' +
              '<h2>Timeline</h2><ol><li><p>Week 1: scope</p></li><li><p><mark data-comment="seed-thread">Week 2: build</mark></p></li><li><p>Week 3: pilot</p></li></ol>',
            version: 1,
            source: null,
            lastEditedBy: alice.id,
            createdAt: iso(),
            updatedAt: iso(),
            shares: { [bob.id]: 'editor' },
            _seed: true,
          }
    );
    if (created?._seed && created.version === 1) {
      await addToIndex(alice.id, id);
      await addToIndex(bob.id, id);
      const hist = await kv.get(K.history(id));
      if (!hist) await recordHistory(created, alice.id, { label: 'Created', fold: false });
      await kv.update(K.comments(id), (cur) =>
        cur
          ? undefined
          : {
              rev: 1,
              items: [{
                id: 'seed-thread', authorId: bob.id, body: 'Can we fit a QA pass into week 2, or should it get its own week?',
                quote: 'Week 2: build', anchored: true, createdAt: iso(), resolved: false, replies: [],
              }],
            }
      );
    }
    seeded = true;
  }

  // ---------- comments serialization ----------
  const serializeComment = (c) => ({
    id: c.id,
    author: pub(userById.get(c.authorId)),
    body: c.body,
    quote: c.quote ?? null,
    anchored: Boolean(c.anchored),
    createdAt: c.createdAt,
    resolved: Boolean(c.resolved),
    resolvedBy: c.resolvedBy ? pub(userById.get(c.resolvedBy)) : null,
    replies: (c.replies || []).map((r) => ({ id: r.id, author: pub(userById.get(r.authorId)), body: r.body, createdAt: r.createdAt })),
  });
  const validBody = (b) => {
    if (typeof b !== 'string' || !b.trim()) throw new HttpError(400, 'Write something before posting.');
    if (b.length > LIMITS.comment) throw new HttpError(400, `Comments are limited to ${LIMITS.comment} characters.`);
    return b.trim();
  };

  // ---------- public API ----------
  return {
    ensureSeed,

    async login(email, password) {
      if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
        throw new HttpError(400, 'Email and password are required.');
      }
      await ensureSeed();
      const user = users.find((u) => u.email === email.trim().toLowerCase());
      if (!user || !(await checkPassword(user, password))) throw new HttpError(401, 'Invalid email or password.');
      const token = `${newId()}${newId()}${newId()}`;
      await kv.set(K.session(token), { userId: user.id, createdAt: iso() });
      return { token, user: pub(user) };
    },

    async authenticate(token) {
      const s = typeof token === 'string' && /^[A-Za-z0-9]{16,128}$/.test(token) ? await kv.get(K.session(token)) : null;
      const user = s && userById.get(s.userId);
      if (!user) throw new HttpError(401, 'Please sign in.');
      return user;
    },

    async logout(token) {
      if (token) await kv.del(K.session(token));
    },

    me: (user) => pub(user),
    listUsers: (user) => users.filter((u) => u.id !== user.id).map(pub),

    async listDocs(user) {
      await ensureSeed();
      const ids = (await kv.get(K.index(user.id)))?.ids ?? [];
      const docs = (await Promise.all(ids.map((id) => kv.get(K.doc(id))))).filter(Boolean);
      const recent = (a, b) => b.updatedAt.localeCompare(a.updatedAt);
      const owned = [];
      const shared = [];
      for (const d of docs.sort(recent)) {
        const role = roleFor(d, user.id);
        if (role === 'owner') owned.push(serialize(d, role));
        else if (role) shared.push(serialize(d, role)); // stale index entries are skipped
      }
      return { owned, shared };
    },

    async createDoc(user, { title, content, source } = {}) {
      const doc = {
        id: newId(),
        ownerId: user.id,
        title: title === undefined ? 'Untitled document' : validTitle(title),
        html: content === undefined ? '' : validContent(content),
        version: 1,
        source: source ? String(source).slice(0, 200) : null,
        lastEditedBy: user.id,
        createdAt: iso(),
        updatedAt: iso(),
        shares: {},
      };
      await kv.set(K.doc(doc.id), doc);
      await addToIndex(user.id, doc.id);
      await recordHistory(doc, user.id, { label: source ? `Imported from ${doc.source}` : 'Created', fold: false });
      return serialize(doc, 'owner', { content: true });
    },

    async getDoc(user, id) {
      const { doc, role } = await loadDoc(user, id, 'viewer');
      const body = serialize(doc, role, { content: true });
      if (role === 'owner') {
        body.shares = Object.entries(doc.shares || {})
          .map(([uid, r]) => ({ ...pub(userById.get(uid)), role: r }))
          .filter((s) => s.id)
          .sort((a, b) => a.name.localeCompare(b.name));
      }
      return body;
    },

    async updateDoc(user, id, { title, content, baseVersion } = {}, { historyLabel } = {}) {
      const { role } = await loadDoc(user, id, 'editor');
      if (title === undefined && content === undefined) throw new HttpError(400, 'Nothing to update.');
      const nextTitle = title === undefined ? undefined : validTitle(title);
      const nextHtml = content === undefined ? undefined : validContent(content);
      let conflict = null;
      let contentChanged = false;
      const saved = await kv.update(K.doc(id), (d) => {
        conflict = null;
        contentChanged = false;
        if (!d) return undefined;
        // Optimistic concurrency: a content write based on a stale version is rejected.
        if (nextHtml !== undefined && baseVersion !== undefined && baseVersion !== d.version) {
          conflict = d;
          return undefined;
        }
        if (nextTitle !== undefined) d.title = nextTitle;
        if (nextHtml !== undefined && nextHtml !== d.html) {
          d.html = nextHtml;
          d.version += 1; // only content bumps the version, so a rename never invalidates pending edits
          contentChanged = true;
        }
        d.lastEditedBy = user.id;
        d.updatedAt = iso();
        return d;
      });
      if (!saved) throw new HttpError(404, 'Document not found.');
      if (conflict) {
        throw new HttpError(409, 'This document was changed by someone else.', {
          error: 'This document was changed by someone else.',
          latest: serialize(conflict, role, { content: true }),
        });
      }
      if (contentChanged || historyLabel) {
        await recordHistory(saved, user.id, historyLabel ? { label: historyLabel, fold: false } : {});
      }
      return serialize(saved, role, { content: true });
    },

    async deleteDoc(user, id) {
      const { doc } = await loadDoc(user, id, 'owner');
      await kv.del(K.doc(id));
      const members = [doc.ownerId, ...Object.keys(doc.shares || {})];
      await Promise.all(members.map((uid) => removeFromIndex(uid, id)));
      const extra = [...(await kv.list(`doc/${id}/`)), ...(await kv.list(`presence/${id}/`))];
      await Promise.all(extra.map((k) => kv.del(k)));
    },

    // ---------- sharing ----------
    async share(user, id, { email, role = 'editor' } = {}) {
      await loadDoc(user, id, 'owner');
      if (typeof email !== 'string' || !email.trim()) throw new HttpError(400, 'Email is required.');
      if (!['viewer', 'editor'].includes(role)) throw new HttpError(400, 'Role must be "viewer" or "editor".');
      const target = users.find((u) => u.email === email.trim().toLowerCase());
      if (!target) throw new HttpError(404, `No account uses ${email.trim()}.`);
      if (target.id === user.id) throw new HttpError(400, 'You already own this document.');
      await kv.update(K.doc(id), (d) => (d ? { ...d, shares: { ...d.shares, [target.id]: role } } : undefined));
      await addToIndex(target.id, id);
      return { ...pub(target), role };
    },

    async unshare(user, id, targetId) {
      await loadDoc(user, id, 'owner');
      await kv.update(K.doc(id), (d) => {
        if (!d?.shares?.[targetId]) return undefined;
        const shares = { ...d.shares };
        delete shares[targetId];
        return { ...d, shares };
      });
      await removeFromIndex(targetId, id);
      await kv.del(K.presence(id, targetId));
    },

    // ---------- presence ----------
    async heartbeat(user, id) {
      const { doc } = await loadDoc(user, id, 'viewer');
      const now = clock();
      await kv.set(K.presence(id, user.id), { at: now });
      const keys = await kv.list(`presence/${id}/`);
      const entries = await Promise.all(keys.map(async (k) => [k.split('/').pop(), await kv.get(k)]));
      const active = entries
        .filter(([uid, p]) => p && now - p.at < LIMITS.presenceTtlMs && roleFor(doc, uid))
        .map(([uid]) => pub(userById.get(uid)))
        .filter(Boolean);
      const comments = await kv.get(K.comments(id));
      return { version: doc.version, title: doc.title, active, commentsRev: comments?.rev ?? 0 };
    },

    // ---------- version history ----------
    async listVersions(user, id) {
      const { doc } = await loadDoc(user, id, 'viewer');
      const h = (await kv.get(K.history(id))) ?? { entries: [] };
      return {
        currentVersion: doc.version,
        entries: [...h.entries].reverse().map((e) => ({ ...e, by: pub(userById.get(e.by)) })),
      };
    },

    async getVersion(user, id, n) {
      await loadDoc(user, id, 'viewer');
      const num = Number(n);
      const h = (await kv.get(K.history(id))) ?? { entries: [] };
      const entry = h.entries.find((e) => e.n === num);
      const snap = entry && (await kv.get(K.snap(id, num)));
      if (!snap) throw new HttpError(404, 'That version is no longer available.');
      return { ...entry, by: pub(userById.get(entry.by)), title: snap.title, content: snap.html };
    },

    async restoreVersion(user, id, n) {
      const v = await this.getVersion(user, id, n);
      const when = new Date(v.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      return this.updateDoc(user, id, { title: v.title, content: v.content }, { historyLabel: `Restored the version from ${when}` });
    },

    // ---------- comments ----------
    async listComments(user, id) {
      await loadDoc(user, id, 'viewer');
      const c = (await kv.get(K.comments(id))) ?? { rev: 0, items: [] };
      return { rev: c.rev, items: c.items.map(serializeComment) };
    },

    async addComment(user, id, { body, quote, anchored, parentId } = {}) {
      const { role } = await loadDoc(user, id, 'viewer');
      const text = validBody(body);
      const now = iso();
      let created = null;
      await kv.update(K.comments(id), (cur) => {
        const c = cur ?? { rev: 0, items: [] };
        if (parentId) {
          const parent = c.items.find((x) => x.id === parentId);
          if (!parent) throw new HttpError(404, 'That comment was deleted.');
          created = { id: newId(), authorId: user.id, body: text, createdAt: now };
          parent.replies = [...(parent.replies || []), created];
          if (parent.resolved) parent.resolved = false; // replying reopens a thread
        } else {
          created = {
            id: newId(),
            authorId: user.id,
            body: text,
            quote: typeof quote === 'string' ? quote.slice(0, LIMITS.quote) : null,
            // Only people who can edit may anchor (anchoring writes a highlight into the document).
            anchored: Boolean(anchored) && RANK[role] >= RANK.editor,
            createdAt: now,
            resolved: false,
            replies: [],
          };
          c.items.push(created);
        }
        c.rev += 1;
        return c;
      });
      return parentId
        ? { id: created.id, author: pub(user), body: created.body, createdAt: created.createdAt }
        : serializeComment(created);
    },

    async setCommentResolved(user, id, commentId, resolved) {
      const { role } = await loadDoc(user, id, 'viewer');
      let out = null;
      await kv.update(K.comments(id), (cur) => {
        const item = cur?.items.find((x) => x.id === commentId);
        if (!item) throw new HttpError(404, 'That comment was deleted.');
        if (RANK[role] < RANK.editor && item.authorId !== user.id) {
          throw new HttpError(403, 'Only editors or the comment’s author can resolve it.');
        }
        item.resolved = Boolean(resolved);
        item.resolvedBy = resolved ? user.id : null;
        cur.rev += 1;
        out = item;
        return cur;
      });
      return serializeComment(out);
    },

    async deleteComment(user, id, commentId) {
      const { role } = await loadDoc(user, id, 'viewer');
      await kv.update(K.comments(id), (cur) => {
        if (!cur) throw new HttpError(404, 'That comment was deleted.');
        for (const item of cur.items) {
          const isThread = item.id === commentId;
          const reply = item.replies?.find((r) => r.id === commentId);
          const target = isThread ? item : reply;
          if (!target) continue;
          if (target.authorId !== user.id && role !== 'owner') {
            throw new HttpError(403, 'Only the author or the document owner can delete a comment.');
          }
          if (isThread) cur.items = cur.items.filter((x) => x.id !== commentId);
          else item.replies = item.replies.filter((r) => r.id !== commentId);
          cur.rev += 1;
          return cur;
        }
        throw new HttpError(404, 'That comment was deleted.');
      });
    },
  };
}
