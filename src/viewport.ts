export function isPageInViewport({ top, bottom }: { top: number; bottom: number }, height: number): boolean {
  return bottom > 0 && top < height;
}
