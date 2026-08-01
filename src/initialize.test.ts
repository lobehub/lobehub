import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock('@lobehub/ui/base-ui', () => ({ toast: { error: toastError } }));

describe('chunk-load error listeners', () => {
  beforeAll(async () => {
    (globalThis as any).__REACT_SCAN__ = false;
    await import('./initialize');
  });

  afterEach(() => {
    sessionStorage.clear();
    toastError.mockClear();
  });

  it('keeps vite:preloadError default so the preload helper rethrows to React.lazy', () => {
    sessionStorage.setItem('lobe-chunk-reload', '1');

    const event = new Event('vite:preloadError', { cancelable: true });
    (event as any).payload = new Error('Failed to fetch dynamically imported module');
    window.dispatchEvent(event);

    expect(toastError).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores vite:preloadError events without a chunk-load payload', () => {
    sessionStorage.setItem('lobe-chunk-reload', '1');

    const event = new Event('vite:preloadError', { cancelable: true });
    (event as any).payload = new Error('some unrelated failure');
    window.dispatchEvent(event);

    expect(toastError).not.toHaveBeenCalled();
  });
});
