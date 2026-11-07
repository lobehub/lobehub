import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useIsPrinting } from './useIsPrinting';

describe('useIsPrinting', () => {
  it('is false until the page prints', () => {
    const { result } = renderHook(() => useIsPrinting());

    expect(result.current).toBe(false);
  });

  it('turns true synchronously inside beforeprint', () => {
    const { result } = renderHook(() => useIsPrinting());

    // No act(): the browser lays out the printed pages right after the event,
    // so the update must already be committed when dispatchEvent returns.
    window.dispatchEvent(new Event('beforeprint'));

    expect(result.current).toBe(true);
  });

  it('turns false again after printing', () => {
    const { result } = renderHook(() => useIsPrinting());

    window.dispatchEvent(new Event('beforeprint'));
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });

    expect(result.current).toBe(false);
  });

  it('stops listening once unmounted', () => {
    const { result, unmount } = renderHook(() => useIsPrinting());
    unmount();

    window.dispatchEvent(new Event('beforeprint'));

    expect(result.current).toBe(false);
  });
});
