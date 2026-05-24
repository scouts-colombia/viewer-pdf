import { eventBus } from './viewer.ts';

let active = false;
let currentQuery = '';

export function initSearch(
  inputEl: HTMLInputElement,
  counterEl: HTMLElement,
  prevBtn: HTMLButtonElement,
  nextBtn: HTMLButtonElement,
  closeBtn: HTMLButtonElement,
  panelEl: HTMLElement,
) {
  inputEl.addEventListener('input', () => {
    currentQuery = inputEl.value;
    dispatchFind('');
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      dispatchFind(e.shiftKey ? 'again' : 'again', !e.shiftKey);
      e.preventDefault();
    }
    if (e.key === 'Escape') closeSearch(panelEl, inputEl);
  });

  prevBtn.addEventListener('click', () => dispatchFind('again', false));
  nextBtn.addEventListener('click', () => dispatchFind('again', true));
  closeBtn.addEventListener('click', () => closeSearch(panelEl, inputEl));

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      openSearch(panelEl, inputEl);
    }
  });

  eventBus.on('updatefindmatchescount', ({ matchesCount }: { matchesCount: { current: number; total: number } }) => {
    const { current, total } = matchesCount;
    counterEl.textContent = total > 0 ? `${current} / ${total}` : '';
    counterEl.style.display = total > 0 ? 'inline' : 'none';
  });

  eventBus.on('updatefindcontrolstate', ({ state }: { state: number }) => {
    // 0=found, 1=notfound, 2=wrapped, 3=pending
    if (state === 1) {
      counterEl.textContent = '0 / 0';
      counterEl.style.display = 'inline';
    }
  });
}

function dispatchFind(type: string, findNext = true) {
  eventBus.dispatch('find', {
    source: window,
    type,
    query: currentQuery,
    phraseSearch: true,
    caseSensitive: false,
    matchDiacritics: false,
    entireWord: false,
    highlightAll: true,
    findPrevious: !findNext,
  });
}

export function openSearch(panelEl: HTMLElement, inputEl: HTMLInputElement) {
  active = true;
  panelEl.classList.add('search-open');
  inputEl.focus();
  inputEl.select();
}

export function closeSearch(panelEl: HTMLElement, inputEl: HTMLInputElement) {
  active = false;
  panelEl.classList.remove('search-open');
  inputEl.value = '';
  currentQuery = '';
  eventBus.dispatch('find', { source: window, type: '', query: '', highlightAll: false });
}

export function isSearchOpen() {
  return active;
}
