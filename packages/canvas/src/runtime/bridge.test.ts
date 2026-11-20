// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';

import { installCanvasBridge } from './bridge';

afterEach(() => {
  window.dispatchEvent(new PageTransitionEvent('pagehide'));
  document.head.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('initializes without secure-context UUID support or an HTTP runtime fallback', () => {
  vi.stubGlobal('crypto', { randomUUID: undefined });
  expect(() => installCanvasBridge()).not.toThrow();
  expect(document.querySelector('script')).toBeNull();
});

it('keeps a BFCache preview alive and disposes only on a final pagehide', () => {
  const disposed = vi.fn();
  window.addEventListener('lobe-canvas-dispose', disposed, { once: true });
  installCanvasBridge();
  const cached = new PageTransitionEvent('pagehide');
  Object.defineProperty(cached, 'persisted', { value: true });
  window.dispatchEvent(cached);
  expect(disposed).not.toHaveBeenCalled();
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  expect(disposed).toHaveBeenCalledOnce();
  expect(document.querySelector('script')).toBeNull();
});
