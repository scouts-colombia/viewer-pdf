/**
 * Ubica en la capa de texto de una página un fragmento citado por Zulú.
 *
 * El fragmento viene de una transcripción en markdown de la página, no de la
 * capa de texto del PDF: cambian los saltos de línea, la puntuación, los
 * guiones de corte y a veces palabras sueltas. Por eso no se busca la frase
 * exacta, sino el tramo de la página donde se concentran los trigramas de
 * palabras del fragmento.
 */

/** Ítem de texto de pdf.js, en el mismo orden que `TextLayer.textDivs`. */
export interface ItemTexto {
  str: string;
  hasEOL: boolean;
}

export interface Posicion {
  item: number;
  offset: number;
}

export interface Tramo {
  desde: Posicion;
  hasta: Posicion;
}

interface Palabra {
  texto: string;
  desde: Posicion;
  hasta: Posicion;
}

const LETRA = /[\p{L}\p{N}]/u;
// Palabras no cubiertas que se toleran dentro de un mismo tramo.
const HUECO_MAXIMO = 6;
// Fracción mínima de palabras del fragmento que el tramo debe cubrir.
const COBERTURA_MINIMA = 0.6;

const plano = (c: string) => c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Palabras de la página con su posición en los ítems. Una palabra puede cruzar
 * ítems: pdf.js parte palabras por cambios de fuente o de espaciado, y un
 * guion al final de línea une la palabra con la de la línea siguiente.
 */
export function palabrasDePagina(items: ItemTexto[]): Palabra[] {
  const palabras: Palabra[] = [];
  let actual: Palabra | null = null;
  const cerrar = () => {
    if (actual) palabras.push(actual);
    actual = null;
  };

  // El último ítem con texto terminó en "letra-": posible guion de corte. El
  // fin de línea puede venir en ese ítem o en uno vacío aparte.
  let guion = false;
  items.forEach(({ str, hasEOL }, item) => {
    for (let offset = 0; offset < str.length; offset++) {
      const c = str[offset];
      if (LETRA.test(c)) {
        actual ??= { texto: '', desde: { item, offset }, hasta: { item, offset } };
        actual.texto += plano(c);
        actual.hasta = { item, offset: offset + 1 };
      } else if (!(c === '-' && str.slice(offset + 1).trim() === '')) {
        cerrar();
      }
    }
    if (str !== '') guion = /\p{L}-\s*$/u.test(str);
    if (hasEOL && !guion) cerrar();
  });
  cerrar();
  return palabras;
}

export function palabrasDeTexto(texto: string): string[] {
  return plano(texto).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export function ubicarFragmento(items: ItemTexto[], fragmento: string): Tramo | null {
  const buscadas = palabrasDeTexto(fragmento);
  const pagina = palabrasDePagina(items);
  if (buscadas.length === 0 || pagina.length === 0) return null;

  const tramo = (ini: number, fin: number): Tramo => ({
    desde: pagina[ini].desde,
    hasta: pagina[fin].hasta,
  });

  // Fragmentos de una o dos palabras (un título, un número de artículo): solo
  // si aparecen una única vez en la página, para no subrayar otra cosa.
  if (buscadas.length < 3) {
    const n = buscadas.length;
    const inicios: number[] = [];
    for (let j = 0; j + n <= pagina.length; j++) {
      if (buscadas.every((p, k) => pagina[j + k].texto === p)) inicios.push(j);
    }
    return inicios.length === 1 ? tramo(inicios[0], inicios[0] + n - 1) : null;
  }

  const trigramas = new Set<string>();
  for (let i = 0; i + 2 < buscadas.length; i++) {
    trigramas.add(buscadas.slice(i, i + 3).join(' '));
  }
  const cubiertas = new Array<boolean>(pagina.length).fill(false);
  for (let j = 0; j + 2 < pagina.length; j++) {
    const trigrama = `${pagina[j].texto} ${pagina[j + 1].texto} ${pagina[j + 2].texto}`;
    if (trigramas.has(trigrama)) cubiertas[j] = cubiertas[j + 1] = cubiertas[j + 2] = true;
  }

  // Grupos de palabras cubiertas separadas por huecos cortos; gana el que más
  // palabras cubre.
  let mejor: { ini: number; fin: number; n: number } | null = null;
  let grupo: { ini: number; fin: number; n: number } | null = null;
  for (let j = 0; j < pagina.length; j++) {
    if (!cubiertas[j]) continue;
    if (grupo && j - grupo.fin - 1 <= HUECO_MAXIMO) {
      grupo.fin = j;
      grupo.n++;
    } else {
      grupo = { ini: j, fin: j, n: 1 };
    }
    if (!mejor || grupo.n > mejor.n) mejor = { ...grupo };
  }

  if (!mejor || mejor.n < buscadas.length * COBERTURA_MINIMA) return null;
  return tramo(mejor.ini, mejor.fin);
}
