// Copy non-TS server assets (HTML, client JS) into dist after tsc runs.
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, 'src', 'server');
const to = join(root, 'dist', 'server');

await mkdir(to, { recursive: true });
for (const file of ['index.html', 'app.js']) {
  await cp(join(from, file), join(to, file));
}
console.log('copied server assets to dist/server');
