import assert from 'node:assert/strict';
import test from 'node:test';
import { esOtroDocumento, leerMensajeCitas } from '../src/mensajes.ts';

// Misma forma que validatePdfUrl, sin import.meta.env.
const validar = (raw: string) => {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname === 'cdnscout.org' ? u : null;
  } catch {
    return null;
  }
};
const MANUAL = 'https://cdnscout.org/manual.pdf';
const GUIA = 'https://cdnscout.org/guia.pdf';

test('ignora mensajes que no son zulu:citas', () => {
  assert.equal(leerMensajeCitas({ tipo: 'otro', file: MANUAL }, validar), null);
  assert.equal(leerMensajeCitas(null, validar), null);
  assert.equal(leerMensajeCitas('zulu:citas', validar), null);
});

test('ignora el mensaje entero si trae un file que no pasa la validación', () => {
  assert.equal(leerMensajeCitas({ tipo: 'zulu:citas', file: 'https://evil.example/x.pdf', pagina: 3 }, validar), null);
  assert.equal(leerMensajeCitas({ tipo: 'zulu:citas', file: 'javascript:alert(1)' }, validar), null);
  assert.equal(leerMensajeCitas({ tipo: 'zulu:citas', file: 42 }, validar), null);
});

test('sin file es el protocolo de siempre: citas del documento abierto', () => {
  const m = leerMensajeCitas({ tipo: 'zulu:citas', citas: [{ pagina: 9, texto: 'b' }, { pagina: 4, texto: 'a' }] }, validar);
  assert.deepEqual(m, { citas: [{ pagina: 9, texto: 'b' }, { pagina: 4, texto: 'a' }], pagina: 4, file: null });
  assert.equal(esOtroDocumento(m!, new URL(MANUAL)), false);
  assert.equal(esOtroDocumento(m!, null), false);
});

test('pagina explícita gana a la primera citada y descarta citas mal formadas', () => {
  const m = leerMensajeCitas({
    tipo: 'zulu:citas',
    pagina: 12,
    citas: [{ pagina: 0, texto: 'x' }, { pagina: 3 }, { pagina: 5, texto: 'y'.repeat(5001) }, null, { pagina: '7', texto: 'ok' }],
  }, validar);
  assert.deepEqual(m, { citas: [{ pagina: 7, texto: 'ok' }], pagina: 12, file: null });
});

test('sin página ni citas válidas la página es 0', () => {
  assert.equal(leerMensajeCitas({ tipo: 'zulu:citas', citas: 'no' }, validar)?.pagina, 0);
});

test('mismo file que el abierto: no recarga', () => {
  const m = leerMensajeCitas({ tipo: 'zulu:citas', file: MANUAL, pagina: 700, citas: [] }, validar)!;
  assert.equal(esOtroDocumento(m, new URL(MANUAL)), false);
});

test('otro file, o visor en espera: abre el documento', () => {
  const m = leerMensajeCitas({ tipo: 'zulu:citas', file: GUIA, pagina: 41, citas: [] }, validar)!;
  assert.equal(esOtroDocumento(m, new URL(MANUAL)), true);
  assert.equal(esOtroDocumento(m, null), true);
});
