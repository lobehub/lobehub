/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useViewTransition } from './useViewTransition';

describe('useViewTransition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Regression: completion used to wait for list rows, so after a failed first
  // fetch (no rows ever) a view switch left a permanent skeleton over the
  // network error.
  it('settles a view switch without waiting for list rows', async () => {
    const { result, rerender } = renderHook(({ viewMode }) => useViewTransition(viewMode), {
      initialProps: { viewMode: 'list' },
    });

    act(() => result.current.startTransition());
    rerender({ viewMode: 'masonry' });
    expect(result.current.isTransitioning).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.isTransitioning).toBe(false);
  });
});
