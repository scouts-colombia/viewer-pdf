import './styles.css';
import { validatePdfUrl } from './security.ts';
import { initViewer, loadDocument, getPdfDocument } from './viewer.ts';
import { bindToolbar, updateToolbar } from './ui.ts';
import { initSearch, openSearch } from './search.ts';
import { loadOutline } from './outline.ts';
import type { ViewerState } from './viewer.ts';

const params = new URLSearchParams(window.location.search);
const rawUrl = params.get('file') ?? '';
const pdfUrl = validatePdfUrl(rawUrl);

const container = document.getElementById('viewer-container')!;
const errorScreen = document.getElementById('error-screen')!;
const loader = document.getElementById('loader')!;

if (!pdfUrl) {
  showError(rawUrl ? 'URL de documento no permitida.' : 'No se especificó un documento.');
} else {
  start(pdfUrl);
}

async function start(url: URL) {
  loader.style.display = 'flex';
  errorScreen.style.display = 'none';

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

  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const toolbar = document.getElementById('toolbar') as HTMLElement;

  initSearch(
    searchInput,
    document.getElementById('search-counter') as HTMLElement,
    document.getElementById('btn-search-prev') as HTMLButtonElement,
    document.getElementById('btn-search-next') as HTMLButtonElement,
    document.getElementById('btn-search-close') as HTMLButtonElement,
    toolbar,
  );

  document.getElementById('btn-search')?.addEventListener('click', () => {
    openSearch(toolbar, searchInput);
  });

  document.getElementById('btn-outline-close')?.addEventListener('click', () => {
    document.getElementById('outline-panel')?.classList.remove('open');
  });

  // En dev, reescribir URLs de cdnscout.org al proxy de Vite para evitar CORS
  const loadUrl: URL =
    import.meta.env.DEV && url.hostname.endsWith('cdnscout.org')
      ? new URL('/cdn-proxy' + url.pathname + url.search, window.location.origin)
      : url;

  try {
    await loadDocument(loadUrl);
  } catch (err) {
    console.error('[viewer]', err);
    showError('No se pudo cargar el documento. Verifica que la URL sea válida y que el archivo exista.');
  }
}

let outlineInitialized = false;
async function initOutlineWhenReady() {
  if (outlineInitialized) return;
  const pdfDoc = getPdfDocument();
  if (!pdfDoc) return;
  outlineInitialized = true;

  await loadOutline(
    pdfDoc,
    document.getElementById('outline-list') as HTMLElement,
    document.getElementById('btn-outline') as HTMLButtonElement,
    document.getElementById('outline-panel') as HTMLElement,
  );
}

function showError(msg: string) {
  loader.style.display = 'none';
  errorScreen.style.display = 'flex';
  const msgEl = document.getElementById('error-msg');
  if (msgEl) msgEl.textContent = msg;
}
