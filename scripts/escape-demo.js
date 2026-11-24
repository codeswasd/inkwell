// Bundled libraries contain a literal U+FFFD inside JS strings; some hosts reject it in HTML.
// Replace it with the equivalent JS escape so the single-file demo is plain, valid UTF-8.
import { readFileSync, writeFileSync } from 'node:fs';
const file = new URL('../demo-dist/index.html', import.meta.url);
const html = readFileSync(file, 'utf8');
writeFileSync(file, html.replaceAll('�', '\\uFFFD'));
