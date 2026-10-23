// Mensajes que Zulú manda al visor por postMessage. Sin DOM ni pdf.js para
// probarlos con el runner de Node.

const MAX_CITAS = 200;
const MAX_LARGO_CITA = 5000;

export interface Cita {
  pagina: number;
  texto: string;
}

export interface MensajeCitas {
  citas: Cita[];
  /** Página a la que saltar; 0 si el mensaje no trae ninguna válida. */
  pagina: number;
  /** Documento que hay que mostrar; null si el mensaje no trae `file`. */
  file: URL | null;
}

export function paginaValida(valor: unknown): number {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * Lee `{ tipo: 'zulu:citas', citas: [{ pagina, texto }], pagina?, file? }`.
 * Devuelve null si no es ese mensaje o si trae un `file` que no pasa `validar`
 * (las mismas reglas que ?file=). Las citas mal formadas se descartan.
 */
export function leerMensajeCitas(data: unknown, validar: (raw: string) => URL | null): MensajeCitas | null {
  const d = data as { tipo?: unknown; citas?: unknown; pagina?: unknown; file?: unknown } | null;
  if (d?.tipo !== 'zulu:citas') return null;

  let file: URL | null = null;
  if (d.file !== undefined) {
    file = typeof d.file === 'string' ? validar(d.file) : null;
    if (!file) return null;
  }

  const citas = (Array.isArray(d.citas) ? d.citas : [])
    .slice(0, MAX_CITAS)
    .flatMap((c: { pagina?: unknown; texto?: unknown } | null) => {
      const pagina = paginaValida(c?.pagina);
      return pagina > 0 && typeof c?.texto === 'string' && c.texto.length <= MAX_LARGO_CITA
        ? [{ pagina, texto: c.texto }]
        : [];
    });
  const pagina = paginaValida(d.pagina) || (citas.length ? Math.min(...citas.map(c => c.pagina)) : 0);
  return { citas, pagina, file };
}

/** El mensaje pide abrir otro documento que el actual (o el visor está vacío). */
export function esOtroDocumento(mensaje: MensajeCitas, actual: URL | null): mensaje is MensajeCitas & { file: URL } {
  return mensaje.file !== null && mensaje.file.href !== actual?.href;
}
