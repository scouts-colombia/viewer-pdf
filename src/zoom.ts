import { setScale, setFitMode, getCurrentScale } from './viewer.ts';

const ZOOM_STEP = 0.25;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

export function zoomIn() {
  const current = getCurrentScale();
  setScale(Math.min(MAX_ZOOM, snapZoom(current + ZOOM_STEP)));
}

export function zoomOut() {
  const current = getCurrentScale();
  setScale(Math.max(MIN_ZOOM, snapZoom(current - ZOOM_STEP)));
}

export function fitWidth() {
  setFitMode('width');
}

export function fitPage() {
  setFitMode('page');
}

function snapZoom(val: number): number {
  return Math.round(val * 100) / 100;
}

export function zoomPercent(): number {
  return Math.round(getCurrentScale() * 100);
}
