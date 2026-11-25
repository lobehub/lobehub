/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRevealOnExpand } from './useRevealOnExpand';

const setup = (overrides: { atBottom?: boolean; expanded?: boolean; isLastRow?: boolean } = {}) => {
  const scrollToBottom = vi.fn();
  const toggleExpanded = vi.fn();
  const state = { atBottom: overrides.atBottom ?? true, autoScrollDetached: false, scrollToBottom };

  const { result } = renderHook(() =>
    useRevealOnExpand({
      expanded: overrides.expanded ?? false,
      getScrollState: () => state,
      isLastRow: overrides.isLastRow ?? true,
      toggleExpanded,
    }),
  );
  result.current();

  return { scrollToBottom, toggleExpanded };
};

describe('useRevealOnExpand', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('follows the opened summary of the last row for a reader at the bottom', () => {
    const { scrollToBottom, toggleExpanded } = setup();

    expect(toggleExpanded).toHaveBeenCalledTimes(1);
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it('keeps the view when collapsing, mid-list, or scrolled up', () => {
    expect(setup({ expanded: true }).scrollToBottom).not.toHaveBeenCalled();
    expect(setup({ isLastRow: false }).scrollToBottom).not.toHaveBeenCalled();
    expect(setup({ atBottom: false }).scrollToBottom).not.toHaveBeenCalled();
  });
});
