import * as pdfjsLib from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { EventBus, PDFLinkService, PDFFindController } from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import { ubicarFragmento, type ItemTexto } from './citas.ts';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';

// Un solo worker para todos los documentos: se crea al arrancar, así compila
// mientras el visor espera, y destruir un documento no lo cierra (pdf.js solo
// destruye el worker que creó él mismo).
let worker: pdfjsLib.PDFWorker | null = null;
export function iniciarWorker() {
  worker ??= new pdfjsLib.PDFWorker();
}

export interface ViewerState {
  totalPages: number;
  currentPage: number;
  scale: number;
  fitMode: 'none' | 'width' | 'page';
  loading: boolean;
  spreadMode: boolean;
}

interface PageMeta {
  viewport1: PageViewport; // at scale=1
}

interface PageCache {
  canvas: HTMLCanvasElement;
  textLayer: HTMLDivElement;
  capaCitas: HTMLDivElement;
  // Ítems de texto de la página alineados con los textDivs del TextLayer.
  textoPagina: { items: ItemTexto[]; divs: Node[] } | null;
  renderTask: { cancel: () => void } | null;
  highlighter: TextHighlighter | null;
}

interface ScrollAnchor {
  pageNum: number;
  ratioFromViewportMid: number;
}

interface ZoomAnimation {
  canvas: HTMLCanvasElement;
  scaleX: number;
  scaleY: number;
}

// TextHighlighter is not exported from pdfjs-dist — replicated from the source.
class TextHighlighter {
  private fc: PDFFindController;
  private eb: EventBus;
  private pageIdx: number;
  private textDivs: Node[] | null = null;
  private textContentItemsStr: string[] | null = null;
  private matches: Array<{ begin: { divIdx: number; offset: number }; end: { divIdx: number; offset: number } }> = [];
  private enabled = false;
  private abortCtrl: AbortController | null = null;

  constructor(fc: PDFFindController, eb: EventBus, pageIndex: number) {
    this.fc = fc;
    this.eb = eb;
    this.pageIdx = pageIndex;
  }

  setTextMapping(divs: Node[], texts: string[]) {
    this.textDivs = divs;
    this.textContentItemsStr = texts;
  }

  enable() {
    if (!this.textDivs || !this.textContentItemsStr || this.enabled) return;
    this.enabled = true;
    if (!this.abortCtrl) {
      this.abortCtrl = new AbortController();
      (this.eb as any)._on('updatetextlayermatches', (evt: { pageIndex: number }) => {
        if (evt.pageIndex === this.pageIdx || evt.pageIndex === -1) this._update();
      }, { signal: this.abortCtrl.signal });
    }
    this._update();
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.abortCtrl?.abort();
    this.abortCtrl = null;
    this._update(true);
  }

  private _convert(matches: number[] | null, lengths: number[] | null) {
    if (!matches || !this.textContentItemsStr) return [];
    const strs = this.textContentItemsStr;
    let i = 0, iIdx = 0;
    const end = strs.length - 1;
    const out: typeof this.matches = [];
    for (let m = 0; m < matches.length; m++) {
      let mIdx = matches[m];
      while (i !== end && mIdx >= iIdx + strs[i].length) { iIdx += strs[i].length; i++; }
      const match: any = { begin: { divIdx: i, offset: mIdx - iIdx } };
      mIdx += lengths![m];
      while (i !== end && mIdx > iIdx + strs[i].length) { iIdx += strs[i].length; i++; }
      match.end = { divIdx: i, offset: mIdx - iIdx };
      out.push(match);
    }
    return out;
  }

  private _render(matches: typeof this.matches) {
    if (!matches.length || !this.textDivs || !this.textContentItemsStr) return;
    const { fc, pageIdx, textDivs: divs, textContentItemsStr: strs } = this;
    const isSelPage = pageIdx === (fc.selected?.pageIdx ?? -1);
    const selIdx = fc.selected?.matchIdx ?? -1;
    const hlAll = (fc as any).state?.highlightAll ?? true;
    let prevEnd: any = null;
    const INF = { divIdx: -1, offset: undefined as any };

    const beginText = (pos: any, cls?: string) => {
      (divs[pos.divIdx] as HTMLElement).textContent = '';
      return appendSpan(pos.divIdx, 0, pos.offset, cls);
    };
    const appendSpan = (dIdx: number, from: number, to: number | undefined, cls?: string) => {
      let el = divs[dIdx] as HTMLElement;
      if (el.nodeType === Node.TEXT_NODE) {
        const wrap = document.createElement('span');
        el.before(wrap); wrap.append(el);
        (divs as HTMLElement[])[dIdx] = wrap; el = wrap;
      }
      const text = document.createTextNode(strs[dIdx].substring(from, to as number));
      if (cls) {
        const sp = document.createElement('span');
        sp.className = cls + ' appended'; sp.append(text); el.append(sp);
        return cls.includes('selected') ? sp : null;
      }
      el.append(text); return 0 as any;
    };

    let i0 = selIdx, i1 = i0 + 1;
    if (hlAll) { i0 = 0; i1 = matches.length; } else if (!isSelPage) return;

    for (let i = i0; i < i1; i++) {
      const { begin, end } = matches[i];
      const isSel = isSelPage && i === selIdx;
      const sfx = isSel ? ' selected' : '';
      let selSpan: any = null;
      if (!prevEnd || begin.divIdx !== prevEnd.divIdx) {
        if (prevEnd !== null) appendSpan(prevEnd.divIdx, prevEnd.offset, INF.offset);
        beginText(begin);
      } else {
        appendSpan(prevEnd.divIdx, prevEnd.offset, begin.offset);
      }
      if (begin.divIdx === end.divIdx) {
        selSpan = appendSpan(begin.divIdx, begin.offset, end.offset, 'highlight' + sfx);
      } else {
        selSpan = appendSpan(begin.divIdx, begin.offset, INF.offset, 'highlight begin' + sfx);
        for (let n = begin.divIdx + 1; n < end.divIdx; n++)
          (divs[n] as HTMLElement).className = 'highlight middle' + sfx;
        beginText(end, 'highlight end' + sfx);
      }
      prevEnd = end;
      if (isSel && selSpan) fc.scrollMatchIntoView({ element: selSpan, pageIndex: pageIdx, matchIndex: selIdx });
    }
    if (prevEnd) appendSpan(prevEnd.divIdx, prevEnd.offset, INF.offset);
  }

  _update(reset = false) {
    if (!this.enabled && !reset) return;
    const { divs, strs } = { divs: this.textDivs, strs: this.textContentItemsStr };
    if (!divs || !strs) return;
    let cleared = -1;
    for (const m of this.matches) {
      const from = Math.max(cleared, m.begin.divIdx);
      for (let n = from; n <= m.end.divIdx; n++) {
        const d = divs[n] as HTMLElement;
        d.textContent = strs[n]; d.className = '';
      }
      cleared = m.end.divIdx + 1;
    }
    if (!(this.fc as any).highlightMatches || reset) return;
    const pm = (this.fc as any).pageMatches?.[this.pageIdx] ?? null;
    const pl = (this.fc as any).pageMatchesLength?.[this.pageIdx] ?? null;
    this.matches = this._convert(pm, pl);
    this._render(this.matches);
  }
}

let pdfDoc: PDFDocumentProxy | null = null;
// Carga en curso o documento abierto; se destruye al abrir otro.
let tarea: pdfjsLib.PDFDocumentLoadingTask | null = null;
let carga = 0;
let containerEl: HTMLElement;
let observer: IntersectionObserver;
let onStateChange: (s: ViewerState) => void;

// Bus de la barra de búsqueda (search.ts). Cada documento tiene su propio bus
// y su PDFFindController; pdf.js no permite destruir un find controller, así
// que al descartar el documento se corta el reenvío entre los dos buses y una
// búsqueda vieja a medias no puede tocar los resultados del nuevo.
export let eventBus: EventBus;
interface Busqueda {
  bus: EventBus;
  fc: PDFFindController;
  corte: AbortController;
}
let busqueda: Busqueda | null = null;

const state: ViewerState = {
  totalPages: 0,
  currentPage: 1,
  scale: 1.0,
  fitMode: 'width',
  loading: false,
  spreadMode: false,
};

const pageMeta = new Map<number, PageMeta>();
const pageCache = new Map<number, PageCache>();
// El iframe está oculto: el observer da sus páginas por fuera de la vista.
let oculto = false;
// Fragmentos citados por Zulú, por número de página.
const citasPorPagina = new Map<number, string[]>();
// Página pedida antes de que existan los placeholders (?page= o una cita): el
// documento abre y pinta primero esa.
let paginaInicial = 1;
let placeholdersListos = false;
let rerenderVersion = 0;
let rerenderPromise: Promise<void> | null = null;
let rerenderQueued = false;

export function initViewer(container: HTMLElement, onChange: (s: ViewerState) => void) {
  containerEl = container;
  onStateChange = onChange;

  eventBus = new EventBus();

  observer = new IntersectionObserver(handleIntersection, {
    root: null,
    rootMargin: '200% 0px',
    threshold: 0,
  });

  containerEl.addEventListener('scroll', updateCurrentPageFromScroll, { passive: true });
  window.addEventListener('scroll', updateCurrentPageFromScroll, { passive: true });

  window.addEventListener('resize', () => {
    if (state.fitMode === 'none' && state.totalPages > 0) requestRerender();
  }, { passive: true });
}

/**
 * Mientras el iframe estuvo oculto se ignoraron los avisos del observer, que no
 * vuelve a avisar por las páginas que siguen fuera: al mostrarse, libera las
 * pintadas que quedaron a más de dos alturas de la vista.
 */
function liberarLejanas() {
  const margen = window.innerHeight * 2;
  for (const pageNum of [...pageCache.keys()]) {
    const placeholder = containerEl.querySelector<HTMLElement>(`[data-page="${pageNum}"]`);
    if (!placeholder) continue;
    const { top, bottom } = placeholder.getBoundingClientRect();
    if (bottom < -margen || top > window.innerHeight + margen) void cleanupPage(pageNum, placeholder);
  }
}

/**
 * Abre el documento en `pagina` y descarta el que hubiera, cargado o a medio
 * cargar. Las citas se borran aquí, de forma síncrona: las que se guarden
 * después de llamar se subrayan al pintar. `alAbrir` corre en cuanto pdf.js lo
 * abre, antes de pintar nada, para que la página que embebe el visor mande las
 * citas en paralelo. Si otra llamada la reemplaza, termina sin error.
 */
export async function loadDocument(url: URL, pagina: number, alAbrir?: () => void) {
  const id = ++carga;
  descartarDocumento();
  const enPagina = pagina > 0;
  paginaInicial = enPagina ? pagina : 1;
  setState({ totalPages: 0, currentPage: 1, scale: 1, fitMode: 'width', spreadMode: false, loading: true });

  const task = pdfjsLib.getDocument({
    url: url.toString(),
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    // Ningún PDF de la biblioteca usa formularios XFA; apagarlo quita superficie de ataque.
    enableXfa: false,
    useSystemFonts: true,
    useWorkerFetch: true,
    wasmUrl: '/pdfjs/wasm/',
    // Abrir en una página (una cita, ?page=) pide solo los rangos que esa página
    // necesita: el stream completo toma el candado de la caché HTTP de Chrome y
    // los rangos esperan a que baje el archivo entero. Leer desde el principio
    // (biblioteca) conserva el stream y la descarga de fondo para el scroll.
    disableStream: enPagina,
    disableAutoFetch: enPagina,
    rangeChunkSize: enPagina ? 262144 : undefined,
    worker: worker ?? undefined,
  });
  tarea = task;

  try {
    const doc = await task.promise;
    if (id !== carga) return;
    pdfDoc = doc;
    busqueda = crearBusqueda(doc);
    alAbrir?.();

    setState({ totalPages: doc.numPages, currentPage: 1, loading: false });
    await buildPlaceholders();
  } catch (err) {
    // Un documento descartado a medio cargar rechaza sus promesas: no es error.
    if (id === carga) throw err;
  }
}

function crearBusqueda(doc: PDFDocumentProxy): Busqueda {
  const bus = new EventBus();
  const linkService = new PDFLinkService({ eventBus: bus });
  // PDFLinkService.pagesCount uses pdfDocument.pagesMapper (internal viewer API,
  // not on PDFDocumentProxy). PDFLinkService.page needs pdfViewer.currentPageNumber.
  // Neither is set up in our custom viewer — override both on the instance so
  // PDFFindController can iterate pages and navigate to matches.
  Object.defineProperty(linkService, 'pagesCount', {
    get: () => doc.numPages,
    configurable: true,
  });
  Object.defineProperty(linkService, 'page', {
    get: () => (pdfDoc === doc ? state.currentPage : 1),
    set: (n: number) => {
      if (pdfDoc !== doc) return;
      const clamped = Math.max(1, Math.min(state.totalPages, n));
      state.currentPage = clamped;
      scrollPageIntoViewIfNeeded(clamped);
      onStateChange({ ...state });
    },
    configurable: true,
  });
  linkService.setDocument(doc);
  const fc = new PDFFindController({ eventBus: bus, linkService });
  fc.setDocument(doc);

  const corte = new AbortController();
  const { signal } = corte;
  eventBus.on('find', (evt: object) => bus.dispatch('find', evt), { signal });
  for (const nombre of ['updatefindmatchescount', 'updatefindcontrolstate']) {
    bus.on(nombre, (evt: object) => eventBus.dispatch(nombre, evt), { signal });
  }
  return { bus, fc, corte };
}

/** Cancela el documento actual y deja el visor vacío, en el ajuste por defecto. */
function descartarDocumento() {
  void tarea?.destroy();
  tarea = null;
  pdfDoc = null;
  busqueda?.corte.abort();
  // Sin documento, la extracción de texto que el find controller tenga a medias
  // se detiene en la página siguiente en vez de pedirla al documento destruido.
  busqueda?.fc.setDocument(null as unknown as PDFDocumentProxy);
  busqueda = null;
  placeholdersListos = false;
  rerenderVersion++;
  observer.disconnect();
  for (const cached of pageCache.values()) {
    try { cached.renderTask?.cancel(); } catch {}
    cached.highlighter?.disable();
  }
  pageCache.clear();
  pageMeta.clear();
  citasPorPagina.clear();
  containerEl.replaceChildren();
  containerEl.classList.remove('spread-mode', 'is-zooming');
  (document.scrollingElement ?? document.documentElement).scrollTo({ top: 0, behavior: 'auto' });
}

/**
 * Crea los placeholders y pinta primero la página inicial (?page= o la de una
 * cita), sin esperar a medir el resto del documento ni a pintar la página 1.
 */
async function buildPlaceholders() {
  const doc = pdfDoc!;
  containerEl.innerHTML = '';
  pageCache.clear();
  pageMeta.clear();
  observer.disconnect();
  if (state.totalPages === 0) return;

  const medir = async (n: number) => {
    const viewport1 = (await doc.getPage(n)).getViewport({ scale: 1 });
    if (pdfDoc === doc && !pageMeta.has(n)) pageMeta.set(n, { viewport1 });
  };
  const destino = () => Math.max(1, Math.min(state.totalPages, paginaInicial));
  // La página 1 da el tamaño estimado del resto. Si llega una cita mientras se
  // mide, el destino cambia y se mide también.
  await Promise.all([medir(1), medir(destino())]);
  while (pdfDoc === doc && !pageMeta.has(destino())) await medir(destino());
  if (pdfDoc !== doc) return;

  const placeholders: HTMLElement[] = [];
  for (let i = 1; i <= state.totalPages; i++) {
    const placeholder = document.createElement('div');
    placeholder.className = 'page-placeholder';
    placeholder.dataset.page = String(i);
    const { width, height } = effectiveSize(i);
    placeholder.style.width = width + 'px';
    placeholder.style.height = height + 'px';
    placeholders.push(placeholder);
  }
  containerEl.append(...placeholders);

  // Desde aquí goToPage salta en vez de guardar la página.
  placeholdersListos = true;
  const inicial = destino();
  const objetivo = placeholders[inicial - 1];
  if (inicial > 1) {
    state.currentPage = inicial;
    scrollToElement(objetivo, 'auto');
    onStateChange({ ...state });
  }

  // Las demás páginas se pintan en cuanto está el canvas de la inicial, o antes
  // si el usuario o una cita mueven la vista lejos del salto: si no, la página a
  // la que llegan queda en blanco mientras la inicial termina su capa de texto.
  const scrollRoot = document.scrollingElement ?? document.documentElement;
  const ySalto = scrollRoot.scrollTop;
  const escucha = new AbortController();
  let activas = false;
  const activarVecinas = () => {
    escucha.abort();
    if (activas || pdfDoc !== doc) return;
    activas = true;
    for (const p of placeholders) observer.observe(p);
    // Fallback: IntersectionObserver may not fire in hidden/headless contexts.
    renderVisiblePlaceholders();
  };
  const alMover = () => {
    if (Math.abs(scrollRoot.scrollTop - ySalto) > window.innerHeight / 2) activarVecinas();
  };
  window.addEventListener('scroll', alMover, { passive: true, signal: escucha.signal });
  containerEl.addEventListener('scroll', alMover, { passive: true, signal: escucha.signal });

  // Si esa página falla, el resto del documento se sigue mostrando.
  await renderPage(inicial, objetivo, activarVecinas).catch(err => console.error('[viewer]', err));
  // Antes del chequeo: también corta la escucha del scroll si el documento cambió.
  activarVecinas();
  if (pdfDoc !== doc) return;

  medirPaginas(doc).catch(err => {
    if (pdfDoc === doc) console.error('[viewer]', err);
  });
}

/**
 * Lee en segundo plano y por lotes el tamaño real de cada página. Los
 * placeholders arrancan con el de la página 1; en documentos con páginas de
 * otro tamaño (dobles, horizontales) el scroll saltaba al pintarlas e "ir a la
 * página" caía en otro lugar.
 */
async function medirPaginas(doc: PDFDocumentProxy) {
  const base = pageMeta.get(1)!.viewport1;
  const LOTE = 8;
  for (let desde = 2; desde <= doc.numPages; desde += LOTE) {
    if (pdfDoc !== doc) return;
    const lote: number[] = [];
    for (let i = desde; i < desde + LOTE && i <= doc.numPages; i++) {
      if (!pageMeta.has(i)) lote.push(i); // ya pintada: su placeholder tiene el tamaño real
    }
    // Una página a la vez: en paralelo, sus peticiones Range ocupan las
    // conexiones y retrasan las de la página que se está mirando.
    const viewports: PageViewport[] = [];
    for (const i of lote) viewports.push((await doc.getPage(i)).getViewport({ scale: 1 }));
    if (pdfDoc !== doc) return;

    const distintas: number[] = [];
    lote.forEach((i, k) => {
      if (pageMeta.has(i)) return; // la pintó renderPage mientras tanto
      pageMeta.set(i, { viewport1: viewports[k] });
      if (viewports[k].width !== base.width || viewports[k].height !== base.height) distintas.push(i);
    });
    if (distintas.length > 0) {
      sinMoverVista(() => {
        for (const i of distintas) {
          if (pageCache.has(i)) continue; // renderPage le pone su tamaño al pintarla
          const placeholder = containerEl.querySelector<HTMLElement>(`[data-page="${i}"]`);
          if (!placeholder) continue;
          const { width, height } = effectiveSize(i);
          placeholder.style.width = width + 'px';
          placeholder.style.height = height + 'px';
        }
      });
    }
    // Cede el hilo principal entre lotes.
    await new Promise(r => setTimeout(r, 0));
  }
}

/**
 * Cambia tamaños de placeholders sin mover lo que se ve: si la página actual
 * se desplazó en pantalla porque cambió algo encima, el scroll lo compensa.
 * Si el navegador ya lo compensó (scroll anchoring), el delta es 0.
 */
function sinMoverVista(cambiar: () => void) {
  updateCurrentPageFromScroll();
  const ancla = containerEl.querySelector<HTMLElement>(`[data-page="${state.currentPage}"]`);
  const antes = ancla?.getBoundingClientRect().top;
  cambiar();
  if (!ancla || antes === undefined) return;
  const delta = ancla.getBoundingClientRect().top - antes;
  if (delta !== 0) window.scrollBy({ top: delta, behavior: 'auto' });
}

function handleIntersection(entries: IntersectionObserverEntry[]) {
  // Un aviso puede traer varias entradas de la misma página, la más reciente al
  // final (Firefox, al mostrarse el iframe): solo vale esa.
  const ultimas = new Map<Element, IntersectionObserverEntry>();
  for (const entry of entries) ultimas.set(entry.target, entry);
  for (const entry of ultimas.values()) {
    // Oculto (Zulú cierra el panel), las páginas parecen fuera de la vista: se
    // conservan las pintadas para reabrir. Chrome y Firefox las miden 0 × 0;
    // WebKit les deja su tamaño y las da fuera aunque estén en la ventana.
    const { width, height, top, bottom } = entry.boundingClientRect;
    const enVentana = bottom > 0 && top < window.innerHeight;
    if ((width === 0 && height === 0) || (!entry.isIntersecting && enVentana)) {
      oculto = true;
      continue;
    }
    if (oculto) {
      oculto = false;
      liberarLejanas();
    }
    const pageNum = Number((entry.target as HTMLElement).dataset.page);
    if (entry.isIntersecting) {
      renderPage(pageNum, entry.target as HTMLElement);
    } else {
      cleanupPage(pageNum, entry.target as HTMLElement);
    }
  }
}

/** `alPintarCanvas` corre cuando el canvas ya está en la página, antes de la capa de texto. */
async function renderPage(pageNum: number, placeholder: HTMLElement, alPintarCanvas?: () => void) {
  if (pageCache.has(pageNum)) return;

  const doc = pdfDoc;
  const { fc, bus } = busqueda ?? {};
  if (!doc || !fc || !bus) return;
  const page = await doc.getPage(pageNum).catch(() => null);
  if (!page) return;
  // El observer y renderVisiblePlaceholders pueden pedir la misma página a la vez.
  if (pdfDoc !== doc || pageCache.has(pageNum)) return;
  if (!pageMeta.has(pageNum)) {
    pageMeta.set(pageNum, { viewport1: page.getViewport({ scale: 1 }) });
  }

  const scale = effectiveScale(page);
  const viewport = page.getViewport({ scale });
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.floor(viewport.width * dpr);
  const ph = Math.floor(viewport.height * dpr);
  const cssW = Math.floor(viewport.width);
  const cssH = Math.floor(viewport.height);
  const transform: [number, number, number, number, number, number] | undefined =
    dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;

  const canvas = document.createElement('canvas');
  canvas.width = pw;
  canvas.height = ph;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.dataset.scale = String(scale);

  const textLayerDiv = document.createElement('div');
  textLayerDiv.className = 'textLayer';
  textLayerDiv.style.width = cssW + 'px';
  textLayerDiv.style.height = cssH + 'px';

  const capaCitas = document.createElement('div');
  capaCitas.className = 'capa-citas';

  pageCache.set(pageNum, {
    canvas, textLayer: textLayerDiv, capaCitas, textoPagina: null, renderTask: null, highlighter: null,
  });
  const isCurrentRender = () => pageCache.get(pageNum)?.canvas === canvas;

  // A single pass: pdf.js resolves the render promise only after every image
  // (JPEG2000 included) is decoded and painted. The canvas is still detached,
  // so a zoom rerender keeps the old one visible until this one is ready.
  // onContinue replaces requestAnimationFrame so renders complete in headless
  // and background-tab browser contexts.
  // El texto se pide después del canvas, no en paralelo: el worker de pdf.js es
  // uno solo y en paralelo retrasa el canvas sin adelantar el texto (medido).
  const task = page.render({ canvas, transform, viewport });
  task.onContinue = (cont: () => void) => setTimeout(cont, 0);
  pageCache.get(pageNum)!.renderTask = task;
  try { await task.promise; } catch { return; }
  if (!isCurrentRender()) return;

  // Swap only after the first new render is ready, keeping the previous canvas
  // visible during zoom rerenders instead of flashing a blank page.
  // Una página de tamaño distinto al estimado cambia de alto; si está encima
  // de la vista, no debe mover lo que se ve.
  if (placeholder.style.width !== cssW + 'px' || placeholder.style.height !== cssH + 'px') {
    sinMoverVista(() => {
      placeholder.style.width = cssW + 'px';
      placeholder.style.height = cssH + 'px';
    });
  }
  placeholder.innerHTML = '';
  // --total-scale-factor is consumed by pdfjs textLayer CSS to size text spans.
  // Without it the spans render at scale=1 regardless of zoom, making highlights
  // appear at the wrong size and position relative to the canvas.
  placeholder.style.setProperty('--total-scale-factor', String(scale));
  // La capa de citas va entre el canvas y el textLayer para no tapar la selección.
  placeholder.append(canvas, capaCitas, textLayerDiv);
  alPintarCanvas?.();

  let textContent: Awaited<ReturnType<PDFPageProxy['getTextContent']>>;
  let tl: TextLayer;
  try {
    textContent = await page.getTextContent();
    if (!isCurrentRender()) return;
    tl = new TextLayer({ textContentSource: textContent, container: textLayerDiv, viewport });
    await tl.render();
  } catch (err) {
    // Un documento descartado a mitad de la capa de texto rechaza: no es error.
    if (pdfDoc === doc) console.error('[viewer]', err);
    return;
  }

  if (!isCurrentRender()) return;
  pageCache.get(pageNum)!.textoPagina = {
    // Mismo filtro que TextLayer: solo los ítems con `str` tienen textDiv.
    items: textContent.items.flatMap(i => ('str' in i ? [{ str: i.str, hasEOL: i.hasEOL }] : [])),
    divs: tl.textDivs,
  };
  pintarCitas(pageNum);
  const hl = new TextHighlighter(fc, bus, pageNum - 1);
  hl.setTextMapping(tl.textDivs, tl.textContentItemsStr);
  hl.enable();
  const cache = pageCache.get(pageNum);
  if (cache) cache.highlighter = hl;
}

async function cleanupPage(pageNum: number, placeholder: HTMLElement) {
  const cached = pageCache.get(pageNum);
  if (!cached) return;

  try { cached.renderTask?.cancel(); } catch {}
  cached.highlighter?.disable();

  // Sale de la caché antes del await: si el mismo aviso del observer la vuelve
  // a pedir, renderPage la pinta de nuevo en vez de darla por pintada.
  pageCache.delete(pageNum);
  cached.canvas.width = 0;
  cached.canvas.height = 0;
  cached.canvas.remove();
  cached.capaCitas.remove();
  cached.textLayer.remove();

  const { width, height } = effectiveSize(pageNum);
  placeholder.style.width = width + 'px';
  placeholder.style.height = height + 'px';
  placeholder.innerHTML = '';

  const doc = pdfDoc;
  try {
    const page = await doc?.getPage(pageNum);
    // Mientras tanto pudo cambiar el documento o volver a pintarse la página.
    if (pdfDoc === doc && !pageCache.has(pageNum)) page?.cleanup();
  } catch {}
}

function effectiveScale(page: PDFPageProxy): number {
  return effectiveScaleForPage(page.pageNumber);
}

function effectiveScaleForPage(pageNum: number): number {
  const meta = pageMeta.get(pageNum) ?? pageMeta.get(1);
  if (!meta) return state.scale;
  const vp1 = meta.viewport1;

  // En spread mode la portada (pág. 1) sigue con ancho completo;
  // el resto usa la mitad del contenedor menos el gap (24 px a cada lado + 16 gap).
  const isSpreadPage = state.spreadMode && pageNum !== 1;
  const usableWidth = isSpreadPage
    ? Math.floor((containerEl.clientWidth - 64) / 2)
    : containerEl.clientWidth - 32;

  if (state.fitMode === 'width') return usableWidth / vp1.width;
  if (state.fitMode === 'page') {
    const scaleW = usableWidth / vp1.width;
    const scaleH = (window.innerHeight - 80) / vp1.height;
    return Math.min(scaleW, scaleH);
  }
  return state.scale;
}

function effectiveSize(pageNum: number): { width: number; height: number } {
  const meta = pageMeta.get(pageNum) ?? pageMeta.get(1);
  if (!meta) return { width: 600, height: 800 };

  const vp1 = meta.viewport1;
  const scale = effectiveScaleForPage(pageNum);

  return {
    width: Math.floor(vp1.width * scale),
    height: Math.floor(vp1.height * scale),
  };
}

export async function rerenderAll() {
  if (!pdfDoc) return;

  const version = ++rerenderVersion;
  updateCurrentPageFromScroll();
  const scrollAnchor = captureScrollAnchor();
  containerEl.classList.add('is-zooming');

  // Cancel stale render work, but leave the old canvases in the DOM until the
  // replacement render is ready. That prevents blank flashes during zoom.
  for (const cached of pageCache.values()) {
    try { cached.renderTask?.cancel(); } catch {}
    cached.highlighter?.disable();
    cached.textLayer.style.display = 'none';
    cached.capaCitas.style.display = 'none';
  }
  pageCache.clear();

  if (version !== rerenderVersion) {
    containerEl.classList.remove('is-zooming');
    return;
  }

  // Update placeholder sizes
  const placeholders = containerEl.querySelectorAll<HTMLElement>('.page-placeholder');
  const zoomAnimations: ZoomAnimation[] = [];

  for (const p of placeholders) {
    const pageNum = Number(p.dataset.page);
    const { width, height } = effectiveSize(pageNum);

    const staleCanvas = p.querySelector<HTMLCanvasElement>('canvas');
    if (staleCanvas) {
      const oldRect = staleCanvas.getBoundingClientRect();
      const oldWidth = oldRect.width || parseFloat(staleCanvas.style.width);
      const oldHeight = oldRect.height || parseFloat(staleCanvas.style.height);

      if (oldWidth > 0 && oldHeight > 0) {
        staleCanvas.classList.add('stale-render');
        staleCanvas.style.width = oldWidth + 'px';
        staleCanvas.style.height = oldHeight + 'px';
        staleCanvas.style.transform = 'scale(1)';
        zoomAnimations.push({
          canvas: staleCanvas,
          scaleX: width / oldWidth,
          scaleY: height / oldHeight,
        });
      }
    }

    p.style.width = width + 'px';
    p.style.height = height + 'px';
  }

  restoreScrollAnchor(scrollAnchor);

  requestAnimationFrame(() => {
    if (version !== rerenderVersion) return;

    for (const animation of zoomAnimations) {
      animation.canvas.style.transform = `scale(${animation.scaleX}, ${animation.scaleY})`;
    }
  });

  // Re-observe to trigger intersection
  observer.disconnect();
  for (const p of placeholders) observer.observe(p);
  renderVisiblePlaceholders();
  checkAutoSpread();
  window.setTimeout(() => {
    if (version === rerenderVersion) containerEl.classList.remove('is-zooming');
  }, 180);
}

export function goToPage(pageNum: number, behavior: ScrollBehavior = 'smooth') {
  if (!placeholdersListos) {
    paginaInicial = pageNum;
    return;
  }
  const clamped = Math.max(1, Math.min(state.totalPages, pageNum));
  state.currentPage = clamped;

  const placeholder = containerEl.querySelector<HTMLElement>(`[data-page="${clamped}"]`);
  if (placeholder) scrollToElement(placeholder, behavior);
  onStateChange({ ...state });
}

/** Reemplaza los fragmentos citados y vuelve a subrayar las páginas pintadas. */
export function setCitas(citas: Array<{ pagina: number; texto: string }>) {
  citasPorPagina.clear();
  for (const { pagina, texto } of citas) {
    citasPorPagina.set(pagina, [...(citasPorPagina.get(pagina) ?? []), texto]);
  }
  for (const pageNum of pageCache.keys()) pintarCitas(pageNum);
}

function pintarCitas(pageNum: number) {
  const cached = pageCache.get(pageNum);
  if (!cached?.textoPagina) return;
  const { items, divs } = cached.textoPagina;
  const capa = cached.capaCitas;
  capa.replaceChildren();
  const origen = capa.getBoundingClientRect();

  for (const texto of citasPorPagina.get(pageNum) ?? []) {
    // Sin capa de texto o con una transcripción muy distinta no hay tramo:
    // el visor solo abre la página.
    const tramo = ubicarFragmento(items, texto);
    if (!tramo) continue;
    const rango = document.createRange();
    rango.setStart(...puntoEnTexto(divs[tramo.desde.item], tramo.desde.offset));
    rango.setEnd(...puntoEnTexto(divs[tramo.hasta.item], tramo.hasta.offset));
    for (const r of unirPorLinea([...rango.getClientRects()])) {
      const marca = document.createElement('div');
      marca.style.left = r.left - origen.left + 'px';
      marca.style.top = r.top - origen.top + 'px';
      marca.style.width = r.right - r.left + 'px';
      marca.style.height = r.bottom - r.top + 'px';
      capa.append(marca);
    }
  }
}

type Caja = { left: number; top: number; right: number; bottom: number };

/**
 * Un rectángulo por palabra deja huecos en el texto justificado. Une los que
 * comparten línea y están a menos de una altura de letra de distancia.
 */
function unirPorLinea(rects: DOMRect[]): Caja[] {
  const cajas: Caja[] = [];
  const ordenados = rects
    .filter(r => r.width >= 1 && r.height >= 1)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  for (const r of ordenados) {
    const alto = r.bottom - r.top;
    const linea = cajas.find(c =>
      Math.abs(c.top - r.top) < alto / 2 && r.left - c.right < alto && c.left - r.right < alto);
    if (linea) {
      linea.left = Math.min(linea.left, r.left);
      linea.right = Math.max(linea.right, r.right);
      linea.top = Math.min(linea.top, r.top);
      linea.bottom = Math.max(linea.bottom, r.bottom);
    } else {
      cajas.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
  }
  return cajas;
}

/**
 * Nodo de texto y offset dentro de un textDiv. El resaltador de la búsqueda
 * parte el texto del div en varios nodos, así que no basta con firstChild.
 */
function puntoEnTexto(div: Node, offset: number): [Node, number] {
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
  let resto = offset;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const largo = n.textContent!.length;
    if (resto <= largo) return [n, resto];
    resto -= largo;
  }
  return [div, div.childNodes.length];
}

function scrollPageIntoViewIfNeeded(pageNum: number) {
  const placeholder = containerEl.querySelector<HTMLElement>(`[data-page="${pageNum}"]`);
  if (!placeholder) return;

  const containerRect = containerEl.getBoundingClientRect();
  const { top, bottom } = placeholder.getBoundingClientRect();
  const isVisible = bottom > containerRect.top && top < containerRect.bottom;
  if (isVisible) return;

  scrollToElement(placeholder, 'auto');
}

/**
 * Scroll the viewport to a page placeholder without using scrollIntoView(),
 * which can propagate through iframe boundaries and scroll the parent page.
 */
function scrollToElement(el: HTMLElement, behavior: ScrollBehavior) {
  const scrollRoot = document.scrollingElement ?? document.documentElement;
  const elTop = el.getBoundingClientRect().top + scrollRoot.scrollTop;
  // Offset by the toolbar height (≈60 px) so the page isn't hidden behind it
  const offset = 68;
  scrollRoot.scrollTo({ top: elTop - offset, behavior });
}

export function setScale(newScale: number) {
  state.scale = Math.max(0.25, Math.min(4, newScale));
  state.fitMode = 'none';
  requestRerender();
  onStateChange({ ...state });
}

export function setFitMode(mode: 'width' | 'page') {
  state.fitMode = mode;
  requestRerender();
  onStateChange({ ...state });
}

export function setSpreadMode(enabled: boolean) {
  if (state.spreadMode === enabled) return;
  state.spreadMode = enabled;
  containerEl.classList.toggle('spread-mode', enabled);
  requestRerender();
  onStateChange({ ...state });
}

export function getState(): Readonly<ViewerState> {
  return { ...state };
}

export function getCurrentScale(): number {
  const renderedCanvas = containerEl?.querySelector<HTMLCanvasElement>(
    `[data-page="${state.currentPage}"] canvas`,
  );
  const renderedScale = Number(renderedCanvas?.dataset.scale);
  if (Number.isFinite(renderedScale) && renderedScale > 0) return renderedScale;

  return effectiveScaleForPage(state.currentPage);
}

export function getPdfDocument(): PDFDocumentProxy | null {
  return pdfDoc;
}

function setState(partial: Partial<ViewerState>) {
  Object.assign(state, partial);
  onStateChange({ ...state });
}

function requestRerender() {
  if (rerenderPromise) {
    rerenderQueued = true;
    return;
  }

  rerenderPromise = (async () => {
    do {
      rerenderQueued = false;
      await rerenderAll();
    } while (rerenderQueued);
  })().finally(() => {
    rerenderPromise = null;
  });
}

function updateCurrentPageFromScroll() {
  if (!state.totalPages) return;
  const placeholders = containerEl.querySelectorAll<HTMLElement>('.page-placeholder');
  const viewMid = window.innerHeight / 2;

  for (const p of placeholders) {
    const { top, bottom } = p.getBoundingClientRect();
    if (top <= viewMid && bottom > viewMid) {
      const pageNum = Number(p.dataset.page);
      if (pageNum !== state.currentPage) {
        state.currentPage = pageNum;
        onStateChange({ ...state });
      }
      return;
    }
  }
}

function captureScrollAnchor(): ScrollAnchor | null {
  const pageNum = state.currentPage;
  const placeholder = containerEl.querySelector<HTMLElement>(`[data-page="${pageNum}"]`);
  if (!placeholder) return null;

  const rect = placeholder.getBoundingClientRect();
  if (rect.height <= 0) return null;

  const viewportMid = window.innerHeight / 2;
  const ratio = (viewportMid - rect.top) / rect.height;

  return {
    pageNum,
    ratioFromViewportMid: Math.max(0, Math.min(1, ratio)),
  };
}

function restoreScrollAnchor(anchor: ScrollAnchor | null) {
  if (!anchor) return;

  const placeholder = containerEl.querySelector<HTMLElement>(`[data-page="${anchor.pageNum}"]`);
  if (!placeholder) return;

  const rect = placeholder.getBoundingClientRect();
  const pageTop = window.scrollY + rect.top;
  const targetTop = pageTop + rect.height * anchor.ratioFromViewportMid - window.innerHeight / 2;
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;

  window.scrollTo({
    top: Math.max(0, Math.min(maxScroll, targetTop)),
    behavior: 'auto',
  });
}

/**
 * Auto-activa/desactiva el spread mode en zoom manual:
 * si dos páginas caben lado a lado, activa; si no, desactiva.
 * No hace rerender (se llama desde dentro de rerenderAll).
 */
function checkAutoSpread() {
  if (state.fitMode !== 'none') return;
  const meta = pageMeta.get(1);
  if (!meta) return;
  const pageW = Math.floor(meta.viewport1.width * state.scale);
  const twoFit = pageW * 2 + 64 <= containerEl.clientWidth - 32;
  if (twoFit === state.spreadMode) return;
  state.spreadMode = twoFit;
  containerEl.classList.toggle('spread-mode', twoFit);
  onStateChange({ ...state });
}

function renderVisiblePlaceholders() {
  const threshold = window.innerHeight * 3;
  containerEl.querySelectorAll<HTMLElement>('.page-placeholder').forEach(p => {
    const rect = p.getBoundingClientRect();
    if (rect.top < threshold && rect.bottom > -threshold) {
      void renderPage(Number(p.dataset.page!), p);
    }
  });
}
