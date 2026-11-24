# Architecture note

## Shape

```
Browser: React + TipTap (Vite build)
   │  JSON / multipart over /api/*
   ▼
server/routes.js: one route table
   ├── Express adapter        (local, Render, Docker)
   └── Request/Response adapter (Netlify Function)
   ▼
shared/service.js: all product rules
   ▼
KV storage contract: get / set / del / list / update (atomic)
   ├── Netlify Blobs  (production on Netlify; compare-and-swap on ETags)
   ├── JSON files     (local, Render, Docker)
   └── memory         (tests; also behind localStorage in the single-file demo)
```

The idea that holds this together: **the rules live in one place.** `shared/service.js` doesn't know about HTTP, Express, Netlify or browsers. The Express server, the Netlify Function and the in-browser demo all run that same file, so access control, validation, versioning and comments can't drift between environments.

## What I prioritized, and why

1. **The editing loop has to feel trustworthy.** Debounced autosave, a visible save state, ⌘S, a warning before leaving with unsaved changes, and in-app navigation flushes pending edits. A document editor that loses text fails regardless of its other features.
2. **Access rules you can verify.** Roles are ranked viewer < editor < owner. Every service method names the minimum role it needs, and a document you can't access returns **404 rather than 403**, so ids can't be probed. The UI only hides controls; the service enforces everything.
3. **Two people at once, honestly.** Each document has a version that only content changes increment, so a rename never invalidates someone's pending edits. A save carries `baseVersion`. A stale save gets a 409 with the latest copy, and the person chooses which to keep. A 4-second heartbeat carries presence, "a newer version exists" (pulled in automatically if you're idle) and a comments revision (threads refresh live).
4. **Deployable on a free serverless host.** Netlify has no long-running server or writable disk, so storage sits behind a small key-value contract. Every read-modify-write goes through `update()`, which is atomic in each backend:
   - Netlify Blobs: a conditional write on the ETag, retried on conflict.
   - Files and memory: a per-key queue.
   That's what keeps two simultaneous saves, shares or comments from erasing each other. It's proven by a test where a second client writes in the middle of an update and the first write must retry.
5. **Comments and history as product features, not demos.** Comment highlights are a TipTap mark stored in the document HTML, so they move with the text as people edit. Resolving a thread hides its highlight without rewriting the document. Versions fold one person's continuous edits into a single entry (a new one starts when someone else edits, after a 10-minute pause, or on import or restore). That keeps history readable instead of one entry per keystroke. The 50 most recent versions are kept.

## Key decisions and tradeoffs

| Decision | Why | Cost / what I'd change |
|---|---|---|
| **TipTap (ProseMirror)** | Mature schema-based editor. The schema drops unknown markup when loading | About 225 KB gzipped. Could be code-split |
| **Store HTML** | Import and export map naturally to HTML, it's readable, and comment marks travel inside it | ProseMirror JSON would make schema migrations and a later move to CRDTs easier |
| **Key-value store, not SQL** | Runs on Netlify Blobs at zero cost and zero setup, with the same code on files locally | Listing loads each document the user can access. Fine at team scale; at thousands of docs I'd move to Postgres (e.g. Neon) behind the same service |
| **One document per key** | A save is a single atomic write, so content and metadata can't disagree | Large documents are rewritten on every save |
| **Polling heartbeat, not WebSockets or CRDT** | Works on serverless hosts. Small and testable | Up to 4 s latency. Simultaneous typing produces a conflict choice rather than a merge. Next step: Yjs over a WebSocket service |
| **Seeded users + bearer sessions** (scrypt hashes) | Mocked auth is allowed. Real enough to demonstrate sharing | No signup, password reset or session expiry |
| **Server-side sanitising + editor schema** | Defense in depth for imported and pasted HTML. Nothing renders stored HTML outside the editor | A real allow-list sanitizer would be the production choice |
| **4 MB upload limit** | Keeps a base64 upload under Netlify's 6 MB function payload limit | Bigger files would need direct-to-storage uploads |

## How it's verified

- **16 automated tests** (`npm test`):
  - API rules: auth on every route, the seed, the editing round trip, validation and injection, the full sharing matrix, conflicts, versions, comments, uploads (md, docx, bad type, binary, oversize, broken docx), and cascade delete.
  - The storage contract on all three backends, including 25 concurrent increments and a cross-instance compare-and-swap race.
  - The Netlify Function itself over web Request/Response on a real local Blobs server.
- **`npm run verify`**: guardrails, the tests, the production build, then a 41-step end-to-end run on the real server with three users, including a restart to prove persistence. 55 checks.
- **Browser walkthrough** (during development, against the Netlify-style preview): three people, 27 checks covering formatting, comments from the selection menu, live replies, a real conflict, history with diff and restore, viewer restrictions, uploads, delete, mobile layout, and no console errors.

## Deliberately out of scope

True character-by-character co-editing with live cursors, suggestion (track-changes) mode, images and attachments, signup and SSO, share links for people without an account, and folders and search.

## Next 2–4 hours

1. Yjs + WebSocket for real-time co-editing with cursors. The version and conflict layer becomes the fallback.
2. Suggestion mode, built on the comment-mark approach.
3. Postgres (Neon free tier) behind the same service for larger workspaces, plus session expiry.
4. Playwright e2e in CI (the walkthrough exists; it needs packaging as a CI job).
