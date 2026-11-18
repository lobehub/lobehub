/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { clampWindowStart, useStepWindow } from './useStepWindow';

const steps = (count: number) => Array.from({ length: count }, (_, i) => i);

describe('clampWindowStart', () => {
  it('keeps the start while it still leaves the initial tail loaded', () => {
    expect(clampWindowStart(20, 100, 50)).toBe(20);
  });

  it('moves the start down when the list shrinks below it', () => {
    expect(clampWindowStart(70, 100, 50)).toBe(50);
    expect(clampWindowStart(70, 30, 50)).toBe(0);
  });
});

describe('useStepWindow', () => {
  it('loads only the tail of a long list', () => {
    const { result } = renderHook(() => useStepWindow(steps(120), 50, 100));

    expect(result.current.visible).toEqual(steps(120).slice(70));
    expect(result.current.hiddenCount).toBe(70);
  });

  it('loads a short list whole, with nothing hidden', () => {
    const items = steps(30);
    const { result } = renderHook(() => useStepWindow(items, 50, 100));

    expect(result.current.visible).toBe(items);
    expect(result.current.hiddenCount).toBe(0);
  });

  it('grows the window upward by one batch per click', () => {
    const { result } = renderHook(() => useStepWindow(steps(300), 50, 100));

    act(() => result.current.showEarlier());
    expect(result.current.hiddenCount).toBe(150);
    expect(result.current.visible[0]).toBe(150);

    act(() => result.current.showEarlier());
    act(() => result.current.showEarlier());
    expect(result.current.hiddenCount).toBe(0);
    expect(result.current.visible).toHaveLength(300);
  });

  /** @example A streaming turn appends steps; the oldest loaded step must not slide out. */
  it('appends steps that stream in after it opened', () => {
    const { result, rerender } = renderHook(({ items }) => useStepWindow(items, 50, 100), {
      initialProps: { items: steps(120) },
    });

    rerender({ items: steps(125) });

    expect(result.current.hiddenCount).toBe(70);
    expect(result.current.visible).toHaveLength(55);
    expect(result.current.visible.at(-1)).toBe(124);
  });
});
