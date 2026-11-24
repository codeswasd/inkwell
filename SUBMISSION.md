# Submission

**Live URL:** `<add your Netlify URL>`
**Walkthrough video:** see `VIDEO_URL.txt`
**Test accounts:** `alice@ajaia.dev`, `bob@ajaia.dev`, `carol@ajaia.dev`. The password is `demo1234` for all (one-click buttons on the sign-in page).

## Included

| Item | Location |
|---|---|
| Source code | `client/`, `server/`, `shared/`, `netlify/`, `package.json`, `vite.config.js` |
| Setup and run instructions | `README.md` |
| Architecture note | `ARCHITECTURE.md` |
| AI workflow note | `AI_WORKFLOW.md` |
| Automated tests | `test/`: `npm test` (16 tests) |
| Ship-readiness check | `scripts/verify.mjs`: `npm run verify` (55 checks) |
| Deployment config | `netlify.toml` (Netlify), `render.yaml` (Render), `Dockerfile` |
| CI | `.github/workflows/ci.yml` |
| Walkthrough video link | `VIDEO_URL.txt` |
| Screenshots | `docs/screenshots/` |
| Sample upload files | `samples/` (.txt, .md, .docx) |

## Status

**Working end to end** (each item is covered by `npm run verify` and the browser walkthrough):
- Create, rename, edit, autosave, reopen and delete documents.
- Rich text: bold, italic, underline, strikethrough, headings, bulleted and numbered lists, quotes, code, alignment, links.
- Upload .txt, .md or .docx as a new document, or insert a file into the current draft. Unsupported and oversize files are refused clearly.
- Sharing with owner, editor and viewer roles. *Owned by you* and *Shared with you* are separate lists. Access can be revoked.
- Persistence: Netlify Blobs in production, JSON files locally. Data survives refreshes, restarts and redeploys.
- Two people at once: presence, live updates, and conflict detection with a choice of version.
- **Stretch:** comments (anchored threads, replies, resolve and reopen, live refresh).
- **Stretch:** version history (automatic versions, preview, word-level diff, restore).
- **Stretch:** export (Markdown, HTML, PDF via print) and role-based permissions.

**Intentionally not built:** character-by-character co-editing (CRDT), suggestion mode, image uploads, signup and password reset.

**Next 2–4 hours:** Yjs real-time co-editing with cursors, suggestion mode, Postgres for larger workspaces, and Playwright e2e in CI.
