# AI workflow note

> ✏️ Before submitting, edit this note so it reflects **your** process: what you reviewed or changed yourself, and what you checked by hand.

## Tools used

- **Claude (Anthropic)** as a coding agent: scoping, architecture, most of the code, tests, the verification script, and browser testing.
- **Playwright**, driven by the agent, to click through the real UI as three users at once and take screenshots for visual review.
- *(Add anything else you used.)*

## Where AI materially sped things up

- **Scoping.** The brief became a prioritized slice: the core loop first (create, edit, save, share, upload), then collaboration safety, then the two stretch features (comments and version history), with explicit cuts.
- **Volume.** Routes, storage backends, the editor UI, dialogs and the dark theme were produced quickly, which left time for the parts that need judgment: access rules, save semantics, concurrency.
- **Test and verification design.** The sharing-role matrix, the storage contract run against three backends, and the 55-check `npm run verify`.

## AI output that was changed or rejected

- **Rejected reusing CryptPad code.** It was suggested as a reference, but it's AGPL-licensed and built on client-side encryption and its own realtime stack. It was used only as product inspiration.
- **Replaced SQLite with a storage interface when the target became Netlify.** Netlify has no writable disk, so a SQLite file would reset or break.
- **Caught a deploy-breaker before shipping.** The first Netlify Function used the Lambda-style adapter. Reading the Blobs client source showed that mode doesn't supply the URL strong-consistency reads need, so every read would have thrown in production. It was switched to the modern function format.
- **Caught a test-safety bug.** Netlify builds can expose live Blobs credentials, and the client prefers them over test settings. Without a fix, running tests during the Netlify build would have written test data into the production store. The tests now clear those credentials and use a separate store name.
- **Lost-update protection was tightened twice.** First with ETag compare-and-swap. Then, when the local Blobs emulator proved non-atomic under parallel requests, with a per-key queue inside each function instance, backed by a test that forces a cross-instance race.
- **Fixed bugs found in review and testing:**
  - Every rename bumped the version, which made your own pending save fail with a conflict.
  - Simply opening a document showed "Unsaved changes".
  - The conflict banner could scroll out of view.
  - Native `confirm` and `prompt` dialogs were replaced with in-app ones, which also work in sandboxed frames.
  - Non-object JSON bodies were accepted.
- **Design rework.** The first theme (black and gold, an italic accent word in each headline, card grids) read as a generic AI design. It became blue-black ink with a blotting-paper pink accent, an editorial serif for the writing, and a list-style document library.
- *(Add your own edits here.)*

## How correctness and quality were verified

- `npm test`: 16 tests across the API, all storage backends, and the Netlify Function on a real local Blobs server.
- `npm run verify`: guardrails, the tests, the build, then 41 end-to-end steps on the real server with three users, including a restart to prove persistence. 55 of 55 checks pass.
- A browser walkthrough against the Netlify-style preview with three simultaneous users: 27 of 27 checks, including a real edit conflict, live comment replies, history diff and restore, viewer restrictions, uploads, mobile layout, and zero console errors.
- Screenshot review at each step (see `docs/screenshots/`).
- *(Add your manual checks: your own .docx files, mobile, a real Netlify deploy.)*
