import type { PDFDocumentProxy } from 'pdfjs-dist';
import { goToPage } from './viewer.ts';

export interface OutlineItem {
  title: string;
  dest: string | unknown[] | null;
  items: OutlineItem[];
}

export async function loadOutline(
  pdfDoc: PDFDocumentProxy,
  containerEl: HTMLElement,
  toggleBtn: HTMLButtonElement,
  panelEl: HTMLElement,
) {
  const outline = (await pdfDoc.getOutline()) as OutlineItem[] | null;

  if (!outline || outline.length === 0) {
    toggleBtn.disabled = true;
    toggleBtn.title = 'Este documento no tiene índice';
    panelEl.style.display = 'none';
    return;
  }

  toggleBtn.disabled = false;
  containerEl.innerHTML = '';
  containerEl.appendChild(buildTree(outline, pdfDoc));
}

function buildTree(items: OutlineItem[], pdfDoc: PDFDocumentProxy): HTMLElement {
  const ul = document.createElement('ul');
  ul.className = 'outline-list';

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'outline-item';

    const row = document.createElement('div');
    row.className = 'outline-row';

    if (item.items?.length) {
      const chevron = document.createElement('span');
      chevron.className = 'outline-chevron';
      chevron.innerHTML = svgChevron();
      row.appendChild(chevron);

      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        li.classList.toggle('open');
      });
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'outline-spacer';
      row.appendChild(spacer);
    }

    const label = document.createElement('span');
    label.className = 'outline-label';
    label.textContent = item.title || '(sin título)';
    row.appendChild(label);

    row.addEventListener('click', async () => {
      if (!item.dest) return;
      try {
        const rawDest = typeof item.dest === 'string'
          ? await pdfDoc.getDestination(item.dest)
          : item.dest;
        if (rawDest && Array.isArray(rawDest)) {
          const ref = rawDest[0] as { num: number; gen: number };
          const pageIndex = await pdfDoc.getPageIndex(ref);
          goToPage(pageIndex + 1);
        }
      } catch {
        // destination could not be resolved
      }
    });

    li.appendChild(row);

    if (item.items?.length) {
      li.appendChild(buildTree(item.items, pdfDoc));
    }

    ul.appendChild(li);
  }

  return ul;
}

function svgChevron() {
  return `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
    <path d="M3 2l4 3-4 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
