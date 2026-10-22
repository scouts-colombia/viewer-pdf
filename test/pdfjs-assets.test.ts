import { readFileSync, mkdirSync, cpSync, writeFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';

test('copia la versión instalada y conserva las versiones y rutas anteriores', () => {
  const base = resolve(process.env.TEMP ?? process.env.TMP ?? '/tmp');
  // En Windows los temporales del proyecto viven en D:\\tmp.
  const parent = process.platform === 'win32' ? 'D:/tmp' : base;
  const root = mkdtempSync(resolve(parent, 'visor-assets-test-'));
  try {
    mkdirSync(resolve(root, 'scripts'), { recursive: true });
    cpSync(new URL('../scripts/copy-pdfjs-assets.mjs', import.meta.url), resolve(root, 'scripts/copy-pdfjs-assets.mjs'));
    const pkg = resolve(root, 'node_modules/pdfjs-dist');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(resolve(pkg, 'package.json'), JSON.stringify({ version: '6.0.123' }));
    for (const name of ['build', 'cmaps', 'wasm', 'standard_fonts']) mkdirSync(resolve(pkg, name));
    writeFileSync(resolve(pkg, 'build/pdf.worker.min.mjs'), 'worker nuevo');
    for (const name of ['cmaps', 'wasm', 'standard_fonts']) writeFileSync(resolve(pkg, name, 'recurso'), name);
    mkdirSync(resolve(root, 'public/pdfjs/5.7.284'), { recursive: true });
    writeFileSync(resolve(root, 'public/pdfjs/pdf.worker.min.mjs'), 'worker anterior');
    writeFileSync(resolve(root, 'public/_headers'), '/pdfjs/5.7.284/*\n  Cache-Control: public, max-age=31536000, immutable\n');
    execFileSync(process.execPath, [resolve(root, 'scripts/copy-pdfjs-assets.mjs')]);
    assert.equal(existsSync(resolve(root, 'public/pdfjs/5.7.284')), true);
    assert.equal(readFileSync(resolve(root, 'public/pdfjs/pdf.worker.min.mjs'), 'utf8'), 'worker anterior');
    assert.equal(readFileSync(resolve(root, 'public/pdfjs/6.0.123/pdf.worker.min.mjs'), 'utf8'), 'worker nuevo');
    for (const name of ['cmaps', 'wasm', 'standard_fonts']) assert.equal(readFileSync(resolve(root, 'public/pdfjs/6.0.123', name, 'recurso'), 'utf8'), name);
    assert.match(readFileSync(resolve(root, 'public/_headers'), 'utf8'), /^\/pdfjs\/6\.0\.123\/\*/);
  } finally {
    // root proviene de mkdtemp dentro del directorio temporal definido arriba.
    rmSync(root, { recursive: true, force: true });
  }
});
