// Netlify Function (modern format): the shared route table with Netlify Blobs as storage.
// netlify.toml rewrites /api/* here; the static client is served by Netlify's CDN.
// Blobs credentials (including the uncached URL that strong-consistency reads need) are
// provided to modern functions automatically, so no setup is required in the Netlify UI.
import { createFetchHandler } from '../../server/fetch-handler.js';
import { blobsKV } from '../../server/kv-blobs.js';

const handle = createFetchHandler({ kv: blobsKV() });

export default (request) => handle(request);
