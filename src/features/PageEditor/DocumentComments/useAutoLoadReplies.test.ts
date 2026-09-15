import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAutoLoadReplies } from './useAutoLoadReplies';

describe('useAutoLoadReplies', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('waits for the thread to approach the viewport before loading replies', async () => {
    let callback: IntersectionObserverCallback | undefined;
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(next: IntersectionObserverCallback) {
          callback = next;
        }

        disconnect = disconnect;
        observe = observe;
        unobserve = vi.fn();
      },
    );
    const { result } = renderHook(() => useAutoLoadReplies(true));
    const container = document.createElement('div');

    act(() => result.current.containerRef(container));
    expect(observe).toHaveBeenCalledWith(container);
    expect(result.current.shouldLoad).toBe(false);

    act(() =>
      callback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    await waitFor(() => expect(result.current.shouldLoad).toBe(true));
    expect(disconnect).toHaveBeenCalled();
  });

  it('does not observe threads without replies', () => {
    const observe = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        disconnect = vi.fn();
        observe = observe;
        unobserve = vi.fn();
      },
    );
    const { result } = renderHook(() => useAutoLoadReplies(false));

    act(() => result.current.containerRef(document.createElement('div')));
    expect(observe).not.toHaveBeenCalled();
    expect(result.current.shouldLoad).toBe(false);
  });
});
