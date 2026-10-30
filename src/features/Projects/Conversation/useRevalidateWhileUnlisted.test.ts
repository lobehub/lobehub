import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRevalidateWhileUnlisted } from './useRevalidateWhileUnlisted';

describe('useRevalidateWhileUnlisted', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** @example Review: the only refetch ran before the send persisted the topic, so the sidebar never showed it. */
  it('keeps refetching while the fresh topic is unlisted, and stops once it is listed', () => {
    const revalidate = vi.fn();
    const { rerender } = renderHook(
      ({ unlisted }) => useRevalidateWhileUnlisted(unlisted, 'tpc_new', revalidate),
      { initialProps: { unlisted: true } },
    );

    expect(revalidate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4000);
    expect(revalidate).toHaveBeenCalledTimes(3);

    rerender({ unlisted: false });
    vi.advanceTimersByTime(10_000);
    expect(revalidate).toHaveBeenCalledTimes(3);
  });

  it('gives up after a bounded number of retries', () => {
    const revalidate = vi.fn();
    renderHook(() => useRevalidateWhileUnlisted(true, 'tpc_new', revalidate));

    vi.advanceTimersByTime(120_000);
    expect(revalidate).toHaveBeenCalledTimes(16);
  });

  it('does nothing for a listed topic', () => {
    const revalidate = vi.fn();
    renderHook(() => useRevalidateWhileUnlisted(false, 'tpc_old', revalidate));

    vi.advanceTimersByTime(10_000);
    expect(revalidate).not.toHaveBeenCalled();
  });
});
