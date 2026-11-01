import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useLazyActions } from './useLazyActions';

describe('useLazyActions', () => {
  it('passes a plain node straight through', () => {
    const { result } = renderHook(() => useLazyActions('actions'));

    expect(result.current.node).toBe('actions');
  });

  it('does not evaluate a thunk before it is mounted', () => {
    const actions = vi.fn(() => 'actions');
    const { result } = renderHook(() => useLazyActions(actions));

    expect(result.current.node).toBeNull();
    expect(actions).not.toHaveBeenCalled();
  });

  it('evaluates the thunk once mounted', () => {
    const actions = vi.fn(() => 'actions');
    const { result } = renderHook(() => useLazyActions(actions));

    act(() => result.current.mount());

    expect(result.current.node).toBe('actions');
  });

  // The row is reachable by pointer and by keyboard; NavItem calls `mount` from
  // both `pointerenter` and `focus`, so a keyboard user still finds the actions
  // in the tab order instead of them being absent entirely.
  it('stays mounted once mounted, whichever interaction triggered it', () => {
    const actions = vi.fn(() => 'actions');
    const { result, rerender } = renderHook(() => useLazyActions(actions));

    act(() => result.current.mount());
    rerender();

    expect(result.current.node).toBe('actions');
  });

  it('is a no-op for a plain node', () => {
    const { result } = renderHook(() => useLazyActions('actions'));

    act(() => result.current.mount());

    expect(result.current.node).toBe('actions');
  });
});
