import assert from 'node:assert/strict';
import test from 'node:test';
import { palabrasDePagina, ubicarFragmento, type ItemTexto } from '../src/citas.ts';

const linea = (str: string): ItemTexto => ({ str, hasEOL: true });
const trozo = (str: string): ItemTexto => ({ str, hasEOL: false });

/** Texto subrayado por un tramo, para comparar sin depender de offsets. */
function subrayado(items: ItemTexto[], fragmento: string): string | null {
  const t = ubicarFragmento(items, fragmento);
  if (!t) return null;
  let s = '';
  for (let i = t.desde.item; i <= t.hasta.item; i++) {
    const ini = i === t.desde.item ? t.desde.offset : 0;
    const fin = i === t.hasta.item ? t.hasta.offset : items[i].str.length;
    s += items[i].str.slice(ini, fin) + (items[i].hasEOL && i < t.hasta.item ? '\n' : '');
  }
  return s;
}

test('une el guion de corte aunque el fin de línea venga en un ítem vacío', () => {
  const items = [trozo('las organi-'), linea(''), linea('zaciones scouts')];
  assert.deepEqual(
    palabrasDePagina(items).map(p => p.texto),
    ['las', 'organizaciones', 'scouts'],
  );
});

test('no une palabras de líneas distintas sin guion', () => {
  const items = [linea('el grupo'), linea('scout local')];
  assert.deepEqual(palabrasDePagina(items).map(p => p.texto), ['el', 'grupo', 'scout', 'local']);
});

test('ubica un párrafo con markdown, tildes y cortes de línea distintos', () => {
  const items = [
    linea('Capítulo 2'),
    linea('Los jóvenes participan en la toma de deci-'),
    linea('siones del grupo mediante el Consejo de'),
    linea('Unidad, que se reúne cada mes.'),
    linea('Otro tema sin relación.'),
  ];
  const fragmento =
    '**Los jóvenes** participan en la toma de decisiones del grupo mediante el *Consejo de Unidad*, que se reúne cada mes.';
  assert.equal(
    subrayado(items, fragmento),
    'Los jóvenes participan en la toma de deci-\nsiones del grupo mediante el Consejo de\nUnidad, que se reúne cada mes',
  );
});

test('tolera una palabra cambiada en la transcripción', () => {
  const items = [linea('La patrulla elige a su guía por votación de todos sus miembros cada año.')];
  const fragmento = 'La patrulla elige a su guía mediante votación de todos sus miembros cada año.';
  assert.equal(subrayado(items, fragmento), 'La patrulla elige a su guía por votación de todos sus miembros cada año');
});

test('entre dos zonas con trigramas comunes, elige la que más cubre', () => {
  const items = [
    linea('de la organización mundial'),
    linea('Texto intermedio que no tiene nada que ver con la cita buscada aquí.'),
    linea('El Movimiento Scout es parte de la organización mundial del movimiento scout desde 1933.'),
  ];
  const fragmento = 'El Movimiento Scout es parte de la organización mundial del movimiento scout desde 1933.';
  assert.equal(subrayado(items, fragmento), fragmento.slice(0, -1));
});

test('devuelve null si el fragmento no está en la página', () => {
  const items = [linea('Este texto habla de campamentos y de fogatas en el bosque.')];
  assert.equal(ubicarFragmento(items, 'La asamblea nacional aprueba el presupuesto anual del movimiento.'), null);
});

test('un fragmento corto solo se ubica si aparece una sola vez', () => {
  const unico = [linea('Artículo 5'), linea('Texto del artículo.')];
  assert.equal(subrayado(unico, 'Artículo 5'), 'Artículo 5');
  const repetido = [linea('Artículo 5'), linea('ver Artículo 5')];
  assert.equal(ubicarFragmento(repetido, 'Artículo 5'), null);
});
