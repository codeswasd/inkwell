# Inkwell: a collaborative document editor

Write, format, import, share, comment on and version documents together. Built for the Ajaia AI-Native Full Stack Developer assignment.

**Live app:** `<add your Netlify URL here>`

## Demo accounts

All accounts use the password **`demo1234`**. The sign-in page also has one-click buttons.

| User | Email | Starts with |
|---|---|---|
| Alice Chen | `alice@ajaia.dev` | Owns **Q3 Launch Plan**, shared with Bob |
| Bob Rivera | `bob@ajaia.dev` | **Q3 Launch Plan** under *Shared with you* (can edit), plus a comment he left on it |
| Carol Okafor | `carol@ajaia.dev` | Nothing yet. Share something with her |

**Try two people at once (2 minutes).** Open the app as Alice in a normal window and as Bob in a private window. Both open *Q3 Launch Plan*.
- Each window shows the other person's avatar.
- Edits appear in the other window within about 4 seconds.
- Select text and choose **Comment**. The reply appears live too.
- If both of you type at the same moment, the second save is caught and you choose which version to keep. Nothing is overwritten silently.
- Open **History** to see who changed what, compare any version with *What changed*, and restore it.

## What it does

| Area | Details |
|---|---|
| **Documents** | Create, rename (click the title), edit, delete (owner only). Autosave about 0.7 s after you stop typing, ⌘/Ctrl+S to save now, a warning before closing with unsaved changes |
| **Rich text** | Bold, italic, underline, strikethrough, Heading 1–3, bulleted and numbered lists, quotes, code blocks, alignment, links, dividers, undo/redo. A menu appears over selected text |
| **File upload** | **.txt, .md or .docx, up to 4 MB.** *Import a file* (or drop one on the home page) creates a new editable document with headings, bold and lists kept. The toolbar's *Insert file* adds a file's content to the current draft. Other types get a clear error |
| **Sharing** | Owner, *Can edit* and *Can view* roles. Only the owner can share, change roles, revoke or delete. The home page separates **Owned by you** from **Shared with you** |
| **Comments** | Comment on selected text. Threads have replies and can be resolved or reopened; resolved threads are kept and can be shown again. Viewers can comment without changing the document |
| **Version history** | Automatic versions: one per person per editing session, plus imports and restores. Preview any version, see a word-level *What changed* diff, and restore (editors and the owner) |
| **Collaboration** | Presence avatars, live updates while you're idle, conflict detection with a choice of version |
| **Export** | Copy as Markdown, Markdown file, HTML file, Print or save as PDF |
| **Keyboard** | ⌘/Ctrl+/ shows every shortcut. Ctrl+Alt+M comments, Ctrl+Alt+H opens history |

## Run it locally

Requires **Node 22+**.

```bash
npm install
npm run build        # React client → dist/
npm start            # API + client on http://localhost:3000 (data in ./data)
```

Development with hot reload: `npm run dev`, then open http://localhost:5173.

Run the **Netlify setup locally**: static site plus the real function plus a local Netlify Blobs server, with no account needed:

```bash
npm run build && npm run preview:netlify   # http://localhost:8888
```

## Check that it's ship-ready

```bash
npm test             # 16 tests: API rules, all storage backends, the Netlify function itself
npm run verify       # guardrails + tests + build + 41-step end-to-end run on the real server (55 checks)
```

`npm run verify` runs four stages and fails loudly on the first problem:
1. **Guardrails.** No native browser dialogs, no secrets in the repo, no unsafe HTML injection, every API route behind auth (except health and login), Netlify routing order correct, required docs present.
2. **Tests.**
3. **Production build**, including bundle-size and "demo code not shipped" checks.
4. **End to end.** Boots the server with fresh storage and, over HTTP with three users, goes through create, rename, format, reopen, import all three file types, insert into a draft, reject bad and oversize files, share, enforce roles, presence, conflicts, comments, versions and restore, revoke, **restart the server and confirm the data is still there**, then delete.

CI (`.github/workflows/ci.yml`) runs `npm run verify` on every push. The Netlify build runs `npm test` before building, so a failing test stops the deploy.

## Deploy to Netlify (free)

1. Push this folder to a GitHub repository.
2. In Netlify: **Add new site → Import an existing project**, then pick the repo. `netlify.toml` already sets everything: build `npm test && npm run build`, publish `dist`, the API function, and routing.
3. Click **Deploy**. Storage uses **Netlify Blobs**, which is built in, needs no setup and is free. Data persists across deploys.
4. Open the site URL and sign in as Alice.

Alternatively, with the Netlify CLI: `npx netlify-cli deploy --build --prod`.

How it runs on Netlify: the client is served from Netlify's CDN, `/api/*` goes to one serverless function (`netlify/functions/api.mjs`), and data lives in a Blobs store named `inkwell`. Writes use compare-and-swap, so two people saving at once can't erase each other's change.

**Other hosts:** `render.yaml` (Render) and `Dockerfile` (Railway, Fly.io and others) run the same app as a normal Node server that stores JSON files in `DATA_DIR`. Mount a volume there to keep data.

## Project layout

```
shared/       service.js: every product rule (auth, documents, sharing, versions, comments, presence)
              kv.js: storage contract;  html.js: sanitising and text helpers
server/       routes.js: the single route table;  app.js: Express adapter;  fetch-handler.js: web Request/Response adapter
              kv-file.js / kv-blobs.js: storage backends;  importer.js: .txt/.md/.docx → HTML;  users.js: seeded accounts
netlify/      functions/api.mjs: the Netlify Function
client/       React + TipTap UI (Vite);  demoApi.js powers the single-file demo build
test/         API, storage-backend and Netlify-function tests
scripts/      verify.mjs (ship-readiness check), netlify-local.mjs (local Netlify preview), escape-demo.js
samples/      .txt / .md / .docx files for trying uploads
docs/         screenshots
```

See **ARCHITECTURE.md** for the design decisions and **AI_WORKFLOW.md** for how AI tools were used.
