import './styles.css';
import { validatePdfUrl } from './security.ts';
import { initViewer, loadDocument, getPdfDocument, goToPage, setCitas } from './viewer.ts';
import { bindToolbar, updateToolbar } from './ui.ts';
import { initSearch, openSearch } from './search.ts';
import { loadOutline } from './outline.ts';
import type { ViewerState } from './viewer.ts';

const params = new URLSearchParams(window.location.search);
// ?tema=zulu pinta el visor con los colores de Zulú (styles.css).
if (params.get('tema') === 'zulu') document.documentElement.dataset.tema = 'zulu';
const rawUrl = params.get('file') ?? '';
const pdfUrl = validatePdfUrl(rawUrl);

const ORIGEN_CITAS = /^https:\/\/([a-z0-9-]+\.)*scout\.org\.co$|^http:\/\/localhost:\d+$/;
const MAX_CITAS = 200;
const MAX_LARGO_CITA = 5000;

const container = document.getElementById('viewer-container')!;
const errorScreen = document.getElementById('error-screen')!;
const loader = document.getElementById('loader')!;

if (!pdfUrl) {
  if (rawUrl) {
    // Hay un ?file= pero la URL no pasa la validación
    showError('URL de documento no permitida.');
  } else {
    // No se pasó ningún parámetro → mostrar landing
    showLanding();
  }
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

  window.addEventListener('message', recibirCitas);
  // ?page=N abre el documento en esa página. Antes de que existan las páginas,
  // goToPage solo la guarda como página inicial.
  const paginaInicial = paginaValida(params.get('page'));
  if (paginaInicial > 0) goToPage(paginaInicial, 'auto');

  try {
    // En cuanto el documento abre, avisa a la página que embebe el visor (Zulú)
    // que ya puede mandar citas: llegan mientras se pinta la página inicial.
    await loadDocument(loadUrl, () => {
      if (window.parent !== window) window.parent.postMessage({ tipo: 'visor:listo' }, '*');
    });
  } catch (err) {
    console.error('[viewer]', err);
    showError('No se pudo cargar el documento. Verifica que la URL sea válida y que el archivo exista.');
  }
}

// Las teclas pulsadas dentro del iframe no llegan a la página que lo embebe:
// Escape le avisa para que cierre el panel. En un campo (búsqueda, página)
// Escape es de ese campo.
if (window.parent !== window) {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) {
      window.parent.postMessage({ tipo: 'visor:escape' }, '*');
    }
  });
}

// Zulú embebe el visor y le manda los fragmentos citados de este documento:
// { tipo: 'zulu:citas', citas: [{ pagina, texto }], pagina? }. Subraya cada
// fragmento en su página y salta a `pagina`, o a la primera página citada.
function recibirCitas(e: MessageEvent) {
  if (e.source !== window.parent || !ORIGEN_CITAS.test(e.origin) || e.data?.tipo !== 'zulu:citas') return;
  const citas = (Array.isArray(e.data.citas) ? e.data.citas : [])
    .slice(0, MAX_CITAS)
    .flatMap((c: { pagina?: unknown; texto?: unknown }) => {
      const pagina = paginaValida(c?.pagina);
      return pagina > 0 && typeof c.texto === 'string' && c.texto.length <= MAX_LARGO_CITA
        ? [{ pagina, texto: c.texto }]
        : [];
    });
  setCitas(citas);

  const pagina = paginaValida(e.data.pagina) || Math.min(...citas.map((c: { pagina: number }) => c.pagina));
  if (!Number.isFinite(pagina) || pagina <= 0) return;
  goToPage(pagina, 'auto');
}

function paginaValida(valor: unknown): number {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : 0;
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

function showLanding() {
  window.location.replace('/landing.html');
}
