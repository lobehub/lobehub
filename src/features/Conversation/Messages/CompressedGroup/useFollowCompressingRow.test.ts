/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFollowCompressingRow } from './useFollowCompressingRow';

describe('useFollowCompressingRow', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('scrolls the compressing row into view for a reader at the bottom', () => {
    const scrollToBottom = vi.fn();
    const state = { atBottom: true, autoScrollDetached: false, scrollToBottom };

    const { rerender } = renderHook(({ active }) => useFollowCompressingRow(active, () => state), {
      initialProps: { active: false },
    });
    expect(scrollToBottom).not.toHaveBeenCalled();

    rerender({ active: true });
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it('leaves a reader who scrolled up where they are', () => {
    const scrollToBottom = vi.fn();

    renderHook(() =>
      useFollowCompressingRow(true, () => ({
        atBottom: false,
        autoScrollDetached: false,
        scrollToBottom,
      })),
    );
    renderHook(() =>
      useFollowCompressingRow(true, () => ({
        atBottom: true,
        autoScrollDetached: true,
        scrollToBottom,
      })),
    );

    expect(scrollToBottom).not.toHaveBeenCalled();
  });
});
