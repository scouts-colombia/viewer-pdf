import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const pdfjs = resolve(root, 'node_modules/pdfjs-dist');
const { version } = JSON.parse(readFileSync(resolve(pdfjs, 'package.json'), 'utf8'));
const assets = resolve(root, 'public/pdfjs');
const dest = resolve(assets, version);

if (!existsSync(dest)) mkdirSync(dest, { recursive: true });

// Las rutas sin versión conservan los archivos 5.7.284 ya versionados en Git:
// un visor abierto antes del despliegue todavía puede pedirlos.
for (const entry of readdirSync(assets)) {
  if (/^\d+\.\d+\.\d+/.test(entry) && entry !== version) {
    rmSync(resolve(assets, entry), { recursive: true, force: true });
  }
}

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

// Regla literal: /pdfjs/:version/* también haría inmutables las rutas antiguas
// /pdfjs/cmaps/*, /pdfjs/wasm/* y /pdfjs/standard_fonts/*.
const headersPath = resolve(root, 'public/_headers');
const headers = readFileSync(headersPath, 'utf8');
writeFileSync(headersPath, headers.replace(/^\/pdfjs\/\d[^/]*\/\*$/m, `/pdfjs/${version}/*`));
