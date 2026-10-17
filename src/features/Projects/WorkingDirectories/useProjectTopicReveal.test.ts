import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useProjectTopicReveal } from './useProjectTopicReveal';

describe('useProjectTopicReveal', () => {
  it('reveals more rows on each call', () => {
    const { result } = renderHook(() => useProjectTopicReveal('project-a'));

    act(() => result.current.revealMore());
    act(() => result.current.revealMore());

    expect(result.current.extraRows).toBe(40);
  });

  // The sidebar stays mounted across project switches, so returning to a
  // project used to restore its old expansion instead of the first page.
  it('starts from the first page again after switching away and back', () => {
    const { result, rerender } = renderHook(({ id }) => useProjectTopicReveal(id), {
      initialProps: { id: 'project-a' },
    });

    act(() => result.current.revealMore());
    expect(result.current.extraRows).toBe(20);

    rerender({ id: 'project-b' });
    expect(result.current.extraRows).toBe(0);

    rerender({ id: 'project-a' });
    expect(result.current.extraRows).toBe(0);
  });
});
