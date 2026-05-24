import type { ViewerState } from './viewer.ts';
import { goToPage, setFitMode, getState } from './viewer.ts';
import { zoomIn, zoomOut } from './zoom.ts';

const WHEEL_ZOOM_THRESHOLD = 80;
let wheelZoomDelta = 0;

export function bindToolbar() {
  // Navigation
  q<HTMLButtonElement>('#btn-prev')!.addEventListener('click', () => {
    goToPage(getState().currentPage - 1);
  });
  q<HTMLButtonElement>('#btn-next')!.addEventListener('click', () => {
    goToPage(getState().currentPage + 1);
  });

  const pageInput = q<HTMLInputElement>('#page-input')!;
  pageInput.addEventListener('change', () => {
    const val = parseInt(pageInput.value, 10);
    if (!isNaN(val)) goToPage(val);
  });
  pageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pageInput.blur();
  });

  // Zoom
  q<HTMLButtonElement>('#btn-zoom-out')!.addEventListener('click', zoomOut);
  q<HTMLButtonElement>('#btn-zoom-in')!.addEventListener('click', zoomIn);
  q<HTMLButtonElement>('#btn-fit-width')!.addEventListener('click', () => setFitMode('width'));
  q<HTMLButtonElement>('#btn-fit-page')!.addEventListener('click', () => setFitMode('page'));
  window.addEventListener('wheel', handleWheelZoom, { passive: false });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goToPage(getState().currentPage - 1);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goToPage(getState().currentPage + 1);
    if (e.key === 'Home') goToPage(1);
    if (e.key === 'End') goToPage(getState().totalPages);
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
    if (e.key === '-') { e.preventDefault(); zoomOut(); }
  });

  // Outline toggle
  const outlinePanel = q<HTMLElement>('#outline-panel')!;
  q('#btn-outline')?.addEventListener('click', () => {
    outlinePanel.classList.toggle('open');
  });
}

function handleWheelZoom(e: WheelEvent) {
  if (!e.ctrlKey && !e.metaKey) return;

  e.preventDefault();
  if (e.deltaY === 0) return;

  if (Math.sign(wheelZoomDelta) !== Math.sign(e.deltaY)) {
    wheelZoomDelta = 0;
  }

  wheelZoomDelta += e.deltaY;
  if (Math.abs(wheelZoomDelta) < WHEEL_ZOOM_THRESHOLD) return;

  if (wheelZoomDelta < 0) {
    zoomIn();
  } else {
    zoomOut();
  }

  wheelZoomDelta = 0;
}

export function updateToolbar(state: ViewerState) {
  const pageInput = q<HTMLInputElement>('#page-input');
  const pageTotal = q('#page-total');
  const zoomDisplay = q('#zoom-display');
  const btnPrev = q<HTMLButtonElement>('#btn-prev');
  const btnNext = q<HTMLButtonElement>('#btn-next');
  const btnFitWidth = q<HTMLButtonElement>('#btn-fit-width');
  const btnFitPage = q<HTMLButtonElement>('#btn-fit-page');

  if (pageInput && document.activeElement !== pageInput) {
    pageInput.value = String(state.currentPage);
  }
  if (pageTotal) pageTotal.textContent = String(state.totalPages);
  if (btnPrev) btnPrev.disabled = state.currentPage <= 1;
  if (btnNext) btnNext.disabled = state.currentPage >= state.totalPages;

  if (zoomDisplay) {
    if (state.fitMode === 'width') {
      zoomDisplay.textContent = 'Ancho';
    } else if (state.fitMode === 'page') {
      zoomDisplay.textContent = 'Página';
    } else {
      zoomDisplay.textContent = Math.round(state.scale * 100) + '%';
    }
  }

  btnFitWidth?.classList.toggle('active', state.fitMode === 'width');
  btnFitPage?.classList.toggle('active', state.fitMode === 'page');
}

function q<T extends Element = Element>(sel: string): T | null {
  return document.querySelector<T>(sel);
}
