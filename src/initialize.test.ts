import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: toastError },
}));

const reload = vi.fn();

const dispatchPreloadError = (error: unknown) => {
  const event = new Event('vite:preloadError', { cancelable: true });
  (event as any).payload = error;
  window.dispatchEvent(event);
  return event;
};

const dispatchRejection = (reason: unknown) => {
  const event = new Event('unhandledrejection', { cancelable: true });
  (event as any).reason = reason;
  window.dispatchEvent(event);
  return event;
};

describe('chunk-load error listeners', () => {
  beforeAll(async () => {
    (globalThis as any).__REACT_SCAN__ = false;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
      writable: true,
    });
    await import('./initialize');
  });

  afterEach(() => {
    sessionStorage.clear();
    toastError.mockClear();
    reload.mockClear();
  });

  it('keeps vite:preloadError default so the preload helper rethrows to React.lazy', () => {
    sessionStorage.setItem('lobe-chunk-reload', '1');

    const event = dispatchPreloadError(new Error('Failed to fetch dynamically imported module'));

    expect(toastError).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores vite:preloadError events without a chunk-load payload', () => {
    sessionStorage.setItem('lobe-chunk-reload', '1');

    dispatchPreloadError(new Error('some unrelated failure'));

    expect(toastError).not.toHaveBeenCalled();
  });

  it('reloads once when the rethrown rejection repeats the preload error', () => {
    const error = new Error('Failed to fetch dynamically imported module');

    dispatchPreloadError(error);
    dispatchRejection(error);

    expect(reload).toHaveBeenCalledOnce();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('toasts once and never re-arms the reload when the chunk is still missing after reloading', () => {
    sessionStorage.setItem('lobe-chunk-reload', '1');
    const error = new Error('Failed to fetch dynamically imported module');

    dispatchPreloadError(error);
    dispatchRejection(error);

    expect(toastError).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('lobe-chunk-reload')).toBe('1');
  });

  it('does not reload again for distinct chunk errors after the guard is armed', () => {
    sessionStorage.setItem('lobe-chunk-reload', '1');

    dispatchRejection(new Error('Failed to fetch dynamically imported module'));
    dispatchRejection(new Error('Failed to fetch dynamically imported module'));

    expect(reload).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(2);
  });
});
