import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const pdfjs = resolve(root, 'node_modules/pdfjs-dist');
const dest = resolve(root, 'public/pdfjs');

if (!existsSync(dest)) mkdirSync(dest, { recursive: true });

const copy = (src, dst) => {
  if (!existsSync(src)) {
    console.warn(`[copy-pdfjs] missing: ${src}`);
    return;
  }
  cpSync(src, dst, { recursive: true, force: true });
  console.log(`[copy-pdfjs] copied → ${dst.replace(root, '.')}`);
};

copy(resolve(pdfjs, 'build/pdf.worker.min.mjs'), resolve(dest, 'pdf.worker.min.mjs'));
copy(resolve(pdfjs, 'cmaps'), resolve(dest, 'cmaps'));
copy(resolve(pdfjs, 'standard_fonts'), resolve(dest, 'standard_fonts'));
copy(resolve(pdfjs, 'wasm'), resolve(dest, 'wasm'));
