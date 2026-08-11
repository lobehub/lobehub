import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useIntentionalHover } from './useIntentionalHover';

describe('useIntentionalHover', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores inherited hover until the pointer leaves and deliberately re-enters', () => {
    const target = document.createElement('button');
    let isHovered = true;
    vi.spyOn(target, 'matches').mockImplementation(() => isHovered);

    const { result } = renderHook(() => useIntentionalHover({ current: target }));

    act(() => result.current.handlePointerEnter('mouse'));
    expect(result.current.isHoverExpanded).toBe(false);

    act(() => result.current.handlePointerLeave('mouse'));
    act(() => result.current.handlePointerEnter('mouse'));
    expect(result.current.isHoverExpanded).toBe(false);

    isHovered = false;
    act(() => result.current.handlePointerLeave('mouse'));
    isHovered = true;
    act(() => result.current.handlePointerEnter('mouse'));
    expect(result.current.isHoverExpanded).toBe(true);

    isHovered = false;
    act(() => result.current.handlePointerLeave('mouse'));
    expect(result.current.isHoverExpanded).toBe(false);
  });

  it('expands on the first deliberate hover when mounted away from the pointer', () => {
    const target = document.createElement('button');
    vi.spyOn(target, 'matches').mockReturnValue(false);

    const { result } = renderHook(() => useIntentionalHover({ current: target }));

    act(() => result.current.handlePointerEnter('mouse'));

    expect(result.current.isHoverExpanded).toBe(true);
  });

  it('does not arm or expand from touch pointer events', () => {
    const target = document.createElement('button');
    vi.spyOn(target, 'matches').mockReturnValue(true);

    const { result } = renderHook(() => useIntentionalHover({ current: target }));

    act(() => result.current.handlePointerLeave('touch'));
    act(() => result.current.handlePointerEnter('touch'));

    expect(result.current.isHoverExpanded).toBe(false);
  });
});
