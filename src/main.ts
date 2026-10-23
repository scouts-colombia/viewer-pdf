import './styles.css';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { validatePdfUrl } from './security.ts';
import { initViewer, iniciarWorker, loadDocument, getPdfDocument, goToPage, setCitas } from './viewer.ts';
import { bindToolbar, updateToolbar } from './ui.ts';
import { initSearch, openSearch, closeSearch } from './search.ts';
import { loadOutline } from './outline.ts';
import { esOtroDocumento, leerMensajeCitas, paginaValida } from './mensajes.ts';
import type { ViewerState } from './viewer.ts';

const params = new URLSearchParams(window.location.search);
// ?tema=zulu pinta el visor con los colores de Zulú (styles.css).
if (params.get('tema') === 'zulu') document.documentElement.dataset.tema = 'zulu';
const rawUrl = params.get('file') ?? '';
const pdfUrl = validatePdfUrl(rawUrl);
const embebido = window.parent !== window;

const ORIGEN_CITAS = /^https:\/\/([a-z0-9-]+\.)*scout\.org\.co$|^http:\/\/localhost:\d+$/;

const container = document.getElementById('viewer-container')!;
const errorScreen = document.getElementById('error-screen')!;
const loader = document.getElementById('loader')!;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const searchCounter = document.getElementById('search-counter') as HTMLElement;
const toolbar = document.getElementById('toolbar') as HTMLElement;
const outlineList = document.getElementById('outline-list') as HTMLElement;
const outlinePanel = document.getElementById('outline-panel') as HTMLElement;

// Documento que muestra el visor (o que está cargando), sin reescribir en dev.
let documentoActual: URL | null = null;

if (pdfUrl) {
  iniciar();
  // En cuanto el documento abre, avisa a la página que embebe el visor (Zulú)
  // que ya puede mandar citas: llegan mientras se pinta la página inicial.
  abrir(pdfUrl, paginaValida(params.get('page')), () => {
    if (embebido) window.parent.postMessage({ tipo: 'visor:listo' }, '*');
  });
} else if (rawUrl) {
  // Hay un ?file= pero la URL no pasa la validación
  showError('URL de documento no permitida.');
} else if (embebido) {
  // En espera: Zulú mantiene el visor cargado y abre cada cita por mensaje.
  iniciar();
  loader.style.display = 'none';
  window.parent.postMessage({ tipo: 'visor:listo' }, '*');
} else {
  // No se pasó ningún parámetro → mostrar landing
  showLanding();
}

function iniciar() {
  // El worker compila mientras se descarga el documento o mientras el visor espera.
  iniciarWorker();

  initViewer(container, (state: ViewerState) => {
    updateToolbar(state);
    if (state.loading) {
      loader.style.display = 'flex';
    } else {
      loader.style.display = 'none';
      initOutlineWhenReady();
    }
  });

  bindToolbar();

  initSearch(
    searchInput,
    searchCounter,
    document.getElementById('btn-search-prev') as HTMLButtonElement,
    document.getElementById('btn-search-next') as HTMLButtonElement,
    document.getElementById('btn-search-close') as HTMLButtonElement,
    toolbar,
  );

  document.getElementById('btn-search')?.addEventListener('click', () => {
    openSearch(toolbar, searchInput);
  });

  document.getElementById('btn-outline-close')?.addEventListener('click', () => {
    outlinePanel.classList.remove('open');
  });

  window.addEventListener('message', recibirCitas);
}

/** Abre `url` en `pagina` y descarta el documento anterior con su búsqueda e índice. */
async function abrir(url: URL, pagina: number, alAbrir?: () => void) {
  documentoActual = url;
  errorScreen.style.display = 'none';
  closeSearch(toolbar, searchInput);
  searchCounter.textContent = '';
  searchCounter.style.display = 'none';
  outlinePanel.classList.remove('open');
  outlineList.replaceChildren();

  // En dev, reescribir URLs de cdnscout.org al proxy de Vite para evitar CORS
  const loadUrl: URL =
    import.meta.env.DEV && url.hostname.endsWith('cdnscout.org')
      ? new URL('/cdn-proxy' + url.pathname + url.search, window.location.origin)
      : url;

  try {
    await loadDocument(loadUrl, pagina, alAbrir);
  } catch (err) {
    console.error('[viewer]', err);
    // Un mensaje posterior con el mismo `file` lo vuelve a intentar.
    documentoActual = null;
    showError('No se pudo cargar el documento. Verifica que la URL sea válida y que el archivo exista.');
  }
}

// Las teclas pulsadas dentro del iframe no llegan a la página que lo embebe:
// Escape le avisa para que cierre el panel. En un campo (búsqueda, página)
// Escape es de ese campo.
if (embebido) {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) {
      window.parent.postMessage({ tipo: 'visor:escape' }, '*');
    }
  });
}

// Zulú embebe el visor y le manda los fragmentos citados:
// { tipo: 'zulu:citas', citas: [{ pagina, texto }], pagina?, file? }. Si `file`
// es otro documento, lo abre en `pagina`. Subraya cada fragmento en su página y
// salta a `pagina`, o a la primera página citada.
function recibirCitas(e: MessageEvent) {
  if (e.source !== window.parent || !ORIGEN_CITAS.test(e.origin)) return;
  const mensaje = leerMensajeCitas(e.data, validatePdfUrl);
  if (!mensaje) return;

  if (esOtroDocumento(mensaje, documentoActual)) {
    // loadDocument borra las citas al empezar; las guardadas después se
    // subrayan al pintar cada página.
    void abrir(mensaje.file, mensaje.pagina);
    setCitas(mensaje.citas);
    return;
  }
  setCitas(mensaje.citas);
  if (mensaje.pagina > 0) goToPage(mensaje.pagina, 'auto');
}

// Documento cuyo índice ya se pidió.
let outlineDoc: PDFDocumentProxy | null = null;
async function initOutlineWhenReady() {
  const pdfDoc = getPdfDocument();
  if (!pdfDoc || pdfDoc === outlineDoc) return;
  outlineDoc = pdfDoc;

  await loadOutline(
    pdfDoc,
    outlineList,
    document.getElementById('btn-outline') as HTMLButtonElement,
    outlinePanel,
    () => getPdfDocument() === pdfDoc,
  );
}

function showError(msg: string) {
  loader.style.display = 'none';
  errorScreen.style.display = 'flex';
  const msgEl = document.getElementById('error-msg');
  if (msgEl) msgEl.textContent = msg;
}

function showLanding() {
  window.location.replace('/landing.html');
}
