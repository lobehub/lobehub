/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useArmOnInteraction } from './useArmOnInteraction';

describe('useArmOnInteraction', () => {
  /** @example Hover-only row actions were most of each row's DOM in a 500-step workflow. */
  it('starts unarmed until the row is pointed at', () => {
    const { result } = renderHook(() => useArmOnInteraction());

    expect(result.current.armed).toBe(false);

    act(() => result.current.armProps.onPointerEnter?.());

    expect(result.current.armed).toBe(true);
  });

  it('arms on keyboard focus too', () => {
    const { result } = renderHook(() => useArmOnInteraction());

    act(() => result.current.armProps.onFocus?.());

    expect(result.current.armed).toBe(true);
  });

  it('stays armed and stops listening once armed', () => {
    const { result } = renderHook(() => useArmOnInteraction());

    act(() => result.current.armProps.onPointerEnter?.());

    expect(result.current.armProps).toEqual({});
    expect(result.current.armed).toBe(true);
  });
});
