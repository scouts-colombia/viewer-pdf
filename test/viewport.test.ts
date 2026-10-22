import assert from 'node:assert/strict';
import test from 'node:test';
import { isPageInViewport } from '../src/viewport.ts';

test('la página debe cruzar el viewport, aunque el documento sea más alto', () => {
  assert.equal(isPageInViewport({ top: 2400, bottom: 3600 }, 800), false);
  assert.equal(isPageInViewport({ top: -1200, bottom: 0 }, 800), false);
  assert.equal(isPageInViewport({ top: 800, bottom: 2000 }, 800), false);
  assert.equal(isPageInViewport({ top: 100, bottom: 700 }, 800), true);
  assert.equal(isPageInViewport({ top: -1000, bottom: 100 }, 800), true);
  assert.equal(isPageInViewport({ top: 700, bottom: 1900 }, 800), true);
  assert.equal(isPageInViewport({ top: -200, bottom: 1000 }, 800), true);
});
