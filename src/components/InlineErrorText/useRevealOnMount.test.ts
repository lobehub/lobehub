import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useRevealOnMount } from './useRevealOnMount';

describe('useRevealOnMount', () => {
  it('scrolls the attached element into view once on mount', () => {
    const element = document.createElement('div');
    const scrollIntoView = vi.fn();
    element.scrollIntoView = scrollIntoView;

    const { rerender } = renderHook(() => {
      const ref = useRevealOnMount<HTMLDivElement>();
      ref.current = element;
      return ref;
    });
    rerender();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
  });

  it('does nothing when no element is attached', () => {
    expect(() => renderHook(() => useRevealOnMount<HTMLDivElement>())).not.toThrow();
  });
});
