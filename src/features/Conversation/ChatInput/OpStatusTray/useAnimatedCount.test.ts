import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnimatedCount } from './useAnimatedCount';

const mocks = vi.hoisted(() => ({
  animate: vi.fn(),
  reduceMotion: false,
  stop: vi.fn(),
}));

vi.mock('motion/react', () => ({
  animate: mocks.animate,
  useReducedMotion: () => mocks.reduceMotion,
}));

const format = (n: number) => `${n}t`;
const render = (value: number) =>
  renderHook(({ value }) => useAnimatedCount(value, format), { initialProps: { value } });

describe('useAnimatedCount', () => {
  beforeEach(() => {
    mocks.animate.mockReset().mockReturnValue({ stop: mocks.stop });
    mocks.reduceMotion = false;
    mocks.stop.mockClear();
  });

  it('starts at its value without animating', () => {
    const { result } = render(100);

    expect(result.current).toBe('100t');
    expect(mocks.animate).not.toHaveBeenCalled();
  });

  /** @example The token total jumped from 120.0k to 194.0k with no growth in between. */
  it('counts up from the shown number instead of jumping to a new value', () => {
    const { result, rerender } = render(100);
    rerender({ value: 200 });

    expect(result.current).toBe('100t');
    expect(mocks.animate).toHaveBeenCalledWith(100, 200, expect.anything());

    const { onUpdate } = mocks.animate.mock.calls[0][2];
    act(() => onUpdate(149.6));
    expect(result.current).toBe('150t');
    act(() => onUpdate(200));
    expect(result.current).toBe('200t');
  });

  it('continues from the interrupted number when the value moves again', () => {
    const { rerender } = render(100);
    rerender({ value: 200 });
    act(() => mocks.animate.mock.calls[0][2].onUpdate(150));

    rerender({ value: 300 });

    expect(mocks.stop).toHaveBeenCalled();
    expect(mocks.animate).toHaveBeenLastCalledWith(150, 300, expect.anything());
  });

  it('jumps straight to the value for reduced-motion users', () => {
    mocks.reduceMotion = true;
    const { result, rerender } = render(100);
    rerender({ value: 200 });

    expect(result.current).toBe('200t');
    expect(mocks.animate).not.toHaveBeenCalled();
  });
});
