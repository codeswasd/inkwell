#!/usr/bin/env node
// Inkwell ship-readiness check: `npm run verify`
//   1. Guardrails: static checks on the repo (no native dialogs, no secrets, deploy config, docs present)
//   2. Unit + integration tests (node --test)
//   3. Production build
//   4. Boots the real server on a temp data dir and drives the whole product over HTTP
//      with three users, then restarts it to prove persistence.
// Exits non-zero on the first failure, so CI and Netlify refuse to ship a broken build.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
let failed = false;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
  return ok;
}
const section = (t) => console.log(`\n${t}`);
const bail = () => {
  console.log(`\n✗ Verification failed (${results.filter((r) => !r.ok).length} problem(s)).`);
  process.exit(1);
};

// ---------- 1. guardrails ----------
section('1. Guardrails');
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (['node_modules', 'dist', 'demo-dist', 'data', '.git'].includes(f)) return [];
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(root);
const src = files.filter((f) => /\.(m?js|jsx)$/.test(f) && !f.includes(`${join('scripts', 'verify.mjs')}`));
const read = (f) => readFileSync(f, 'utf8');

check('no window.alert/confirm/prompt in the client (blocked in sandboxed frames)',
  !src.filter((f) => f.includes(`${join(root, 'client')}`)).some((f) => /window\.(alert|confirm|prompt)\s*\(/.test(read(f))));
check('no hard-coded secrets or tokens',
  !files.some((f) => /\.(m?js|jsx|json|toml|ya?ml|md)$/.test(f) && !f.endsWith('package-lock.json') && !f.endsWith('verify.mjs') &&
    /(sk_live_|ghp_[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA )?PRIVATE KEY)/.test(read(f))));
check('no dangerouslySetInnerHTML (stored HTML is rendered only through the editor schema)',
  !src.some((f) => read(f).includes('dangerouslySetInnerHTML')));
check('every API route except health and login requires auth',
  (() => {
    const r = read(join(root, 'server', 'routes.js'));
    const open = [...r.matchAll(/\['(GET|POST|PATCH|DELETE)', '([^']+)', \{[^}]*auth: false/g)].map((m) => m[2]);
    return open.length === 2 && open.includes('/api/health') && open.includes('/api/auth/login');
  })());
const toml = existsSync(join(root, 'netlify.toml')) ? read(join(root, 'netlify.toml')) : '';
check('netlify.toml routes /api/* to the function before the SPA fallback',
  toml.indexOf('from = "/api/*"') > -1 && toml.indexOf('from = "/api/*"') < toml.indexOf('from = "/*"'));
check('netlify build runs the tests before building', /command = "npm test && npm run build"/.test(toml));
check('Netlify function exists (modern format)', existsSync(join(root, 'netlify', 'functions', 'api.mjs')) &&
  /export default/.test(read(join(root, 'netlify', 'functions', 'api.mjs'))));
for (const doc of ['README.md', 'ARCHITECTURE.md', 'AI_WORKFLOW.md', 'SUBMISSION.md', 'VIDEO_URL.txt']) {
  check(`${doc} present`, existsSync(join(root, doc)));
}
const pkg = JSON.parse(read(join(root, 'package.json')));
check('Node engine pinned to 22+', /^>=22/.test(pkg.engines?.node || ''));
if (failed) bail();

// ---------- 2. tests ----------
section('2. Tests');
const t = spawnSync(process.execPath, ['--test', ...readdirSync(join(root, 'test')).filter((f) => f.endsWith('.test.js')).map((f) => join('test', f))],
  { cwd: root, encoding: 'utf8' });
const pass = Number(/# pass (\d+)/.exec(t.stdout)?.[1] ?? 0);
const fail = Number(/# fail (\d+)/.exec(t.stdout)?.[1] ?? 1);
check(`test suite (${pass} passed, ${fail} failed)`, t.status === 0 && fail === 0);
if (failed) { console.log(t.stdout.split('\n').filter((l) => /not ok|error|expected|actual/.test(l)).join('\n')); bail(); }

// ---------- 3. build ----------
section('3. Production build');
const b = spawnSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: root, encoding: 'utf8' });
check('vite build', b.status === 0, b.status === 0 ? '' : b.stderr.slice(-400));
const assets = existsSync(join(root, 'dist', 'assets')) ? readdirSync(join(root, 'dist', 'assets')) : [];
const js = assets.filter((a) => a.endsWith('.js')).map((a) => statSync(join(root, 'dist', 'assets', a)).size);
check('dist/index.html and assets emitted', existsSync(join(root, 'dist', 'index.html')) && js.length > 0);
check('client bundle under 1.2 MB (uncompressed)', js.reduce((a, n) => a + n, 0) < 1.2e6, `${Math.round(js.reduce((a, n) => a + n, 0) / 1024)} KB`);
check('demo backend not shipped in the production bundle',
  !assets.some((a) => a.startsWith('demoApi')) && !assets.filter((a) => a.endsWith('.js')).some((a) => read(join(root, 'dist', 'assets', a)).includes('inkwell.demo.v2')));
if (failed) bail();

// ---------- 4. end-to-end over HTTP ----------
section('4. End-to-end on the real server');
const freePort = () => new Promise((res) => { const s = createServer().listen(0, () => { const { port } = s.address(); s.close(() => res(port)); }); });
const dataDir = mkdtempSync(join(tmpdir(), 'inkwell-verify-'));
let proc;
let base;
async function boot() {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, [join(root, 'server', 'index.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}
const stop = () => new Promise((r) => { proc.once('exit', r); proc.kill(); });

async function api(method, path, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(base + path, { method, headers, body });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, body: data, headers: res.headers };
}
const upload = (name, content) => {
  const fd = new FormData();
  fd.append('file', new Blob([content]), name);
  return fd;
};

try {
  await boot();
  check('server boots and /api/health is OK', true);
  const page = await fetch(`${base}/doc/anything`);
  check('client served with SPA fallback on deep links', page.ok && (await page.text()).includes('<div id="root">'));
  check('security headers present', page.headers.get('x-content-type-options') === 'nosniff');

  const login = async (u) => (await api('POST', '/api/auth/login', { json: { email: `${u}@ajaia.dev`, password: 'demo1234' } })).body?.token;
  const [alice, bob, carol] = [await login('alice'), await login('bob'), await login('carol')];
  check('three seeded users can sign in', Boolean(alice && bob && carol));
  check('wrong password is refused', (await api('POST', '/api/auth/login', { json: { email: 'alice@ajaia.dev', password: 'x' } })).status === 401);
  check('seeded doc is shared with Bob', (await api('GET', '/api/documents', { token: bob })).body.shared.some((d) => d.id === 'welcome'));

  // create → rename → format → reopen
  const doc = (await api('POST', '/api/documents', { token: alice, json: {} })).body;
  check('create document', Boolean(doc?.id) && doc.title === 'Untitled document');
  check('rename document', (await api('PATCH', `/api/documents/${doc.id}`, { token: alice, json: { title: 'Launch brief' } })).body.title === 'Launch brief');
  const rich = '<h1>Brief</h1><h2>Scope</h2><p><strong>Bold</strong> <em>italic</em> <u>underline</u></p><ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol>';
  check('save rich text', (await api('PATCH', `/api/documents/${doc.id}`, { token: alice, json: { content: rich, baseVersion: 1 } })).status === 200);
  check('reopen keeps bold/italic/underline/headings/lists', (await api('GET', `/api/documents/${doc.id}`, { token: alice })).body.content === rich);

  // uploads
  const samples = join(root, 'samples');
  for (const f of readdirSync(samples)) {
    const r = await api('POST', '/api/documents/import', { token: alice, form: upload(f, readFileSync(join(samples, f))) });
    check(`import ${f} as a new document`, r.status === 201 && r.body.content.length > 20, r.status !== 201 ? JSON.stringify(r.body) : '');
  }
  const conv = await api('POST', '/api/import/convert', { token: alice, form: upload('n.md', '## Inserted') });
  check('insert a file into an existing draft (convert)', conv.status === 200 && conv.body.html.includes('<h2>Inserted</h2>'));
  check('unsupported file type refused (415)', (await api('POST', '/api/documents/import', { token: alice, form: upload('x.pdf', 'x') })).status === 415);
  check('oversize upload refused (413)', (await api('POST', '/api/documents/import', { token: alice, form: upload('big.txt', 'a'.repeat(4 * 1024 * 1024 + 10)) })).status === 413);

  // sharing
  check('share with Bob as editor', (await api('POST', `/api/documents/${doc.id}/shares`, { token: alice, json: { email: 'bob@ajaia.dev', role: 'editor' } })).status === 201);
  check('share with Carol as viewer', (await api('POST', `/api/documents/${doc.id}/shares`, { token: alice, json: { email: 'carol@ajaia.dev', role: 'viewer' } })).status === 201);
  const carolList = (await api('GET', '/api/documents', { token: carol })).body;
  check('Carol sees it under “Shared with you”, not “Owned by you”', carolList.shared.some((d) => d.id === doc.id) && !carolList.owned.some((d) => d.id === doc.id));
  check('viewer cannot edit (403)', (await api('PATCH', `/api/documents/${doc.id}`, { token: carol, json: { content: '<p>x</p>' } })).status === 403);
  check('editor cannot share or delete (403)',
    (await api('POST', `/api/documents/${doc.id}/shares`, { token: bob, json: { email: 'carol@ajaia.dev' } })).status === 403 &&
    (await api('DELETE', `/api/documents/${doc.id}`, { token: bob })).status === 403);

  // two people at once
  await api('POST', `/api/documents/${doc.id}/heartbeat`, { token: alice });
  const hb = (await api('POST', `/api/documents/${doc.id}/heartbeat`, { token: bob })).body;
  check('presence: Alice and Bob see each other', hb.active.map((u) => u.id).sort().join() === 'alice,bob');
  const v = hb.version;
  check('Bob edits', (await api('PATCH', `/api/documents/${doc.id}`, { token: bob, json: { content: `${rich}<p>Bob was here</p>`, baseVersion: v } })).status === 200);
  check('Alice’s stale save is caught as a conflict (409), not lost', (await api('PATCH', `/api/documents/${doc.id}`, { token: alice, json: { content: '<p>mine</p>', baseVersion: v } })).status === 409);
  check('Alice’s heartbeat reports Bob’s newer version', (await api('POST', `/api/documents/${doc.id}/heartbeat`, { token: alice })).body.version === v + 1);

  // comments
  const th = (await api('POST', `/api/documents/${doc.id}/comments`, { token: bob, json: { body: 'Is scope final?', quote: 'Scope', anchored: true } })).body;
  check('editor adds an anchored comment', th?.anchored === true);
  check('viewer can comment (unanchored)', (await api('POST', `/api/documents/${doc.id}/comments`, { token: carol, json: { body: 'Looks good', anchored: true } })).body.anchored === false);
  check('reply to a thread', (await api('POST', `/api/documents/${doc.id}/comments`, { token: alice, json: { body: 'Yes', parentId: th.id } })).status === 201);
  check('viewer cannot resolve someone else’s thread', (await api('PATCH', `/api/documents/${doc.id}/comments/${th.id}`, { token: carol, json: { resolved: true } })).status === 403);
  check('owner resolves', (await api('PATCH', `/api/documents/${doc.id}/comments/${th.id}`, { token: alice, json: { resolved: true } })).body.resolved === true);

  // versions
  const versions = (await api('GET', `/api/documents/${doc.id}/versions`, { token: alice })).body.entries;
  check('version history records Created + edits by each person', versions.length >= 3 && versions.at(-1).label === 'Created');
  const first = versions.at(-1).n;
  check('preview an old version', (await api('GET', `/api/documents/${doc.id}/versions/${first}`, { token: carol })).body.content === '');
  check('viewer cannot restore (403)', (await api('POST', `/api/documents/${doc.id}/versions/${first}/restore`, { token: carol })).status === 403);
  const editVersion = versions.find((e) => e.by.id === 'alice' && e.label === 'Edited');
  const restored = await api('POST', `/api/documents/${doc.id}/versions/${editVersion.n}/restore`, { token: alice });
  check('owner restores an earlier version', restored.status === 200 && restored.body.content === rich);

  // revoke + delete
  await api('DELETE', `/api/documents/${doc.id}/shares/carol`, { token: alice });
  check('revoked viewer loses access (404)', (await api('GET', `/api/documents/${doc.id}`, { token: carol })).status === 404);

  // persistence across a restart
  await stop();
  await boot();
  const after = await api('GET', `/api/documents/${doc.id}`, { token: alice });
  check('data survives a server restart (sessions, docs, shares)', after.status === 200 && after.body.content === rich &&
    (await api('GET', `/api/documents/${doc.id}/comments`, { token: bob })).body.items.length === 2);
  check('delete removes it for everyone', (await api('DELETE', `/api/documents/${doc.id}`, { token: alice })).status === 204 &&
    (await api('GET', `/api/documents/${doc.id}`, { token: bob })).status === 404);
} catch (e) {
  check('end-to-end run completed', false, e.message);
} finally {
  if (proc && proc.exitCode === null) await stop();
  rmSync(dataDir, { recursive: true, force: true });
}

const ok = results.filter((r) => r.ok).length;
if (failed) bail();
console.log(`\n✓ Ship-ready: ${ok}/${results.length} checks passed.`);
