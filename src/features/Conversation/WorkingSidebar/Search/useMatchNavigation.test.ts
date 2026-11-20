import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMatchNavigation } from './useMatchNavigation';

const navigate = vi.fn();

vi.mock('react-router', () => ({
  useLocation: () => ({ pathname: '/agent/a1/tpc_1', search: '?x=1' }),
  useNavigate: () => navigate,
}));

describe('useMatchNavigation', () => {
  beforeEach(() => {
    navigate.mockReset();
  });

  it('starts at the first match going forward and at the last going back', () => {
    const forward = renderHook(() => useMatchNavigation(['m1', 'm2', 'm3']));
    act(() => forward.result.current.step(1));
    expect(forward.result.current.activeId).toBe('m1');

    const backward = renderHook(() => useMatchNavigation(['m1', 'm2', 'm3']));
    act(() => backward.result.current.step(-1));
    expect(backward.result.current.activeId).toBe('m3');
  });

  it('wraps around and jumps through the message deep link without a history entry', () => {
    const { result } = renderHook(() => useMatchNavigation(['m1', 'm2']));

    act(() => result.current.select('m2'));
    act(() => result.current.step(1));

    expect(result.current.activeIndex).toBe(0);
    expect(navigate).toHaveBeenLastCalledWith(
      { hash: 'm1', pathname: '/agent/a1/tpc_1', search: '?x=1' },
      { replace: true },
    );
  });

  it('forgets a match that is no longer in the results', () => {
    const { rerender, result } = renderHook(({ ids }) => useMatchNavigation(ids), {
      initialProps: { ids: ['m1', 'm2'] },
    });

    act(() => result.current.select('m2'));
    rerender({ ids: ['m1'] });

    expect(result.current.activeId).toBeUndefined();
    expect(result.current.activeIndex).toBe(-1);
  });
});
