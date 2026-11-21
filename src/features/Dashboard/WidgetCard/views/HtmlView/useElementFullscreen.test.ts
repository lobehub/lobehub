import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useElementFullscreen } from './useElementFullscreen';

describe('useElementFullscreen', () => {
  let current: Element | null;
  let element: HTMLDivElement;

  beforeEach(() => {
    current = null;
    element = document.createElement('div');
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => current,
    });
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    document.exitFullscreen = vi.fn(async () => {
      current = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    element.requestFullscreen = vi.fn(async () => {
      current = element;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('enters full screen on its element and reports it', async () => {
    const { result } = renderHook(() => useElementFullscreen({ current: element }));
    expect(result.current.isFullscreen).toBe(false);

    await act(() => result.current.toggle());

    expect(element.requestFullscreen).toHaveBeenCalled();
    expect(result.current.isFullscreen).toBe(true);
  });

  it('exits when toggled again, and follows an exit made elsewhere (Esc)', async () => {
    const { result } = renderHook(() => useElementFullscreen({ current: element }));
    await act(() => result.current.toggle());
    await act(() => result.current.toggle());
    expect(document.exitFullscreen).toHaveBeenCalled();
    expect(result.current.isFullscreen).toBe(false);

    await act(() => result.current.toggle());
    act(() => {
      current = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(result.current.isFullscreen).toBe(false);
  });

  it('is not active when another element is full screen', () => {
    current = document.createElement('section');
    const { result } = renderHook(() => useElementFullscreen({ current: element }));
    expect(result.current.isFullscreen).toBe(false);
  });
});
