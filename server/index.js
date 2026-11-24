import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createApp } from './app.js';
import { fileKV } from './kv-file.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(process.env.DATA_DIR || join(root, 'data'));
const app = createApp({ kv: fileKV(dataDir), staticDir: join(root, 'dist') });
const port = Number(process.env.PORT) || 3000;

app.listen(port, () => console.log(`Inkwell running on http://localhost:${port} (data in ${dataDir})`));
