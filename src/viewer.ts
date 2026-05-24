import * as pdfjsLib from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { EventBus, PDFLinkService, PDFFindController } from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';

export interface ViewerState {
  totalPages: number;
  currentPage: number;
  scale: number;
  fitMode: 'none' | 'width' | 'page';
  loading: boolean;
}

interface PageMeta {
  viewport1: PageViewport; // at scale=1
}

interface PageCache {
  canvas: HTMLCanvasElement;
  textLayer: HTMLDivElement;
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
let containerEl: HTMLElement;
let observer: IntersectionObserver;
let onStateChange: (s: ViewerState) => void;

export let eventBus: EventBus;
export let linkService: PDFLinkService;
export let findController: PDFFindController;

const state: ViewerState = {
  totalPages: 0,
  currentPage: 1,
  scale: 1.0,
  fitMode: 'width',
  loading: false,
};

const pageMeta = new Map<number, PageMeta>();
const pageCache = new Map<number, PageCache>();
let rerenderVersion = 0;
let rerenderPromise: Promise<void> | null = null;
let rerenderQueued = false;

export function initViewer(container: HTMLElement, onChange: (s: ViewerState) => void) {
  containerEl = container;
  onStateChange = onChange;

  eventBus = new EventBus();
  linkService = new PDFLinkService({ eventBus });

  // PDFLinkService.pagesCount uses pdfDocument.pagesMapper (internal viewer API,
  // not on PDFDocumentProxy). PDFLinkService.page needs pdfViewer.currentPageNumber.
  // Neither is set up in our custom viewer — override both on the instance so
  // PDFFindController can iterate pages and navigate to matches.
  Object.defineProperty(linkService, 'pagesCount', {
    get: () => state.totalPages,
    configurable: true,
  });
  Object.defineProperty(linkService, 'page', {
    get: () => state.currentPage,
    set: (n: number) => {
      const clamped = Math.max(1, Math.min(state.totalPages, n));
      state.currentPage = clamped;
      scrollPageIntoViewIfNeeded(clamped);
      onStateChange({ ...state });
    },
    configurable: true,
  });

  findController = new PDFFindController({ eventBus, linkService });

  observer = new IntersectionObserver(handleIntersection, {
    root: null,
    rootMargin: '200% 0px',
    threshold: 0,
  });

  containerEl.addEventListener('scroll', updateCurrentPageFromScroll, { passive: true });
  window.addEventListener('scroll', updateCurrentPageFromScroll, { passive: true });
}

export async function loadDocument(url: URL) {
  setState({ loading: true });

  const task = pdfjsLib.getDocument({
    url: url.toString(),
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    enableXfa: true,
    useSystemFonts: true,
    useWorkerFetch: true,
    wasmUrl: '/pdfjs/wasm/',
    disableStream: false,
    disableAutoFetch: false,
  });

  pdfDoc = await task.promise;
  linkService.setDocument(pdfDoc);
  findController.setDocument(pdfDoc);

  setState({ totalPages: pdfDoc.numPages, currentPage: 1, loading: false });
  await buildPlaceholders();
}

async function buildPlaceholders() {
  containerEl.innerHTML = '';
  pageCache.clear();
  pageMeta.clear();
  observer.disconnect();

  if (state.totalPages > 0) {
    const firstPage = await pdfDoc!.getPage(1);
    pageMeta.set(1, { viewport1: firstPage.getViewport({ scale: 1 }) });
    firstPage.cleanup();
  }

  for (let i = 1; i <= state.totalPages; i++) {
    const placeholder = document.createElement('div');
    placeholder.className = 'page-placeholder';
    placeholder.dataset.page = String(i);
    const { width, height } = effectiveSize(i);
    placeholder.style.width = width + 'px';
    placeholder.style.height = height + 'px';
    containerEl.appendChild(placeholder);
    observer.observe(placeholder);
  }

  // Fallback: IntersectionObserver may not fire in hidden/headless contexts.
  setTimeout(renderVisiblePlaceholders, 0);
}

function handleIntersection(entries: IntersectionObserverEntry[]) {
  for (const entry of entries) {
    const pageNum = Number((entry.target as HTMLElement).dataset.page);
    if (entry.isIntersecting) {
      renderPage(pageNum, entry.target as HTMLElement);
    } else {
      cleanupPage(pageNum, entry.target as HTMLElement);
    }
  }
}

async function renderPage(pageNum: number, placeholder: HTMLElement) {
  if (pageCache.has(pageNum)) return;

  const page = await pdfDoc!.getPage(pageNum);
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

  pageCache.set(pageNum, { canvas, textLayer: textLayerDiv, renderTask: null, highlighter: null });
  const isCurrentRender = () => pageCache.get(pageNum)?.canvas === canvas;

  // Renders into an offscreen canvas, then copies atomically to the visible
  // canvas — avoids a blank flash when the second render clears and redraws.
  // onContinue replaces requestAnimationFrame so renders complete in headless
  // and background-tab browser contexts.
  const renderOffscreen = async () => {
    const off = document.createElement('canvas');
    off.width = pw;
    off.height = ph;
    const task = page.render({ canvas: off, transform, viewport });
    task.onContinue = (cont: () => void) => setTimeout(cont, 0);
    const cache = pageCache.get(pageNum);
    if (cache) cache.renderTask = task;
    await task.promise;
    if (!isCurrentRender()) return; // cleaned up or superseded while rendering
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, pw, ph);
    ctx.drawImage(off, 0, 0);
  };

  // First pass: shows page immediately (photo may be absent if still decoding).
  try { await renderOffscreen(); } catch { return; }
  if (!isCurrentRender()) return;

  // Swap only after the first new render is ready, keeping the previous canvas
  // visible during zoom rerenders instead of flashing a blank page.
  placeholder.style.width = cssW + 'px';
  placeholder.style.height = cssH + 'px';
  placeholder.innerHTML = '';
  // --total-scale-factor is consumed by pdfjs textLayer CSS to size text spans.
  // Without it the spans render at scale=1 regardless of zoom, making highlights
  // appear at the wrong size and position relative to the canvas.
  placeholder.style.setProperty('--total-scale-factor', String(scale));
  placeholder.appendChild(canvas);
  placeholder.appendChild(textLayerDiv);

  // Second pass after 400 ms: by then the worker has decoded async images
  // (JPEG2000 / inline images) that were silently skipped on first pass.
  await new Promise<void>(r => setTimeout(r, 400));
  if (!isCurrentRender()) return;
  try { await renderOffscreen(); } catch { return; }

  if (!isCurrentRender()) return;
  const textContent = await page.getTextContent();
  const tl = new TextLayer({ textContentSource: textContent, container: textLayerDiv, viewport });
  await tl.render();

  if (!isCurrentRender()) return;
  const hl = new TextHighlighter(findController, eventBus, pageNum - 1);
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

  const page = await pdfDoc!.getPage(pageNum);
  await page.cleanup();

  cached.canvas.width = 0;
  cached.canvas.height = 0;
  cached.canvas.remove();
  cached.textLayer.remove();
  pageCache.delete(pageNum);

  const { width, height } = effectiveSize(pageNum);
  placeholder.style.width = width + 'px';
  placeholder.style.height = height + 'px';
  placeholder.innerHTML = '';
}

function effectiveScale(page: PDFPageProxy): number {
  return effectiveScaleForPage(page.pageNumber);
}

function effectiveScaleForPage(pageNum: number): number {
  const meta = pageMeta.get(pageNum) ?? pageMeta.get(1);
  if (!meta) return state.scale;
  const vp1 = meta.viewport1;

  if (state.fitMode === 'width') {
    return (containerEl.clientWidth - 32) / vp1.width;
  }
  if (state.fitMode === 'page') {
    const scaleW = (containerEl.clientWidth - 32) / vp1.width;
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
  window.setTimeout(() => {
    if (version === rerenderVersion) containerEl.classList.remove('is-zooming');
  }, 180);
}

export function goToPage(pageNum: number) {
  const clamped = Math.max(1, Math.min(state.totalPages, pageNum));
  state.currentPage = clamped;

  const placeholder = containerEl.querySelector<HTMLElement>(`[data-page="${clamped}"]`);
  if (placeholder) scrollToElement(placeholder, 'smooth');
  onStateChange({ ...state });
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

function renderVisiblePlaceholders() {
  const threshold = window.innerHeight * 3;
  containerEl.querySelectorAll<HTMLElement>('.page-placeholder').forEach(p => {
    const rect = p.getBoundingClientRect();
    if (rect.top < threshold && rect.bottom > -threshold) {
      void renderPage(Number(p.dataset.page!), p);
    }
  });
}
