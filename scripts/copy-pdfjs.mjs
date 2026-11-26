// Copies the pdf.js runtime + worker into /public/pdfjs so the browser can
// load them directly (avoids bundler issues with pdfjs-dist ESM builds).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pdfjs-dist', 'build');
const dest = join(root, 'public', 'pdfjs');

if (!existsSync(src)) {
  console.warn('[copy-pdfjs] pdfjs-dist not installed yet, skipping.');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const file of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  copyFileSync(join(src, file), join(dest, file));
}
console.log('[copy-pdfjs] pdf.js copied to public/pdfjs');
