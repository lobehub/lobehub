/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useToolExpandState } from './useToolExpandState';

describe('useToolExpandState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts open on the first render when the card needs expanding', () => {
    const { result } = renderHook(() =>
      useToolExpandState({ isAlwaysExpand: false, needExpand: true }),
    );

    expect(result.current.showToolRender).toBe(true);
  });

  it('stays closed when the card is collapsed by default', () => {
    const { result } = renderHook(() =>
      useToolExpandState({ isAlwaysExpand: false, needExpand: false }),
    );

    act(() => {
      vi.runAllTimers();
    });

    expect(result.current.showToolRender).toBe(false);
  });

  it('opens after a delay when the card starts needing expansion later', () => {
    const { rerender, result } = renderHook(
      ({ needExpand }) => useToolExpandState({ isAlwaysExpand: false, needExpand }),
      { initialProps: { needExpand: false } },
    );

    rerender({ needExpand: true });
    expect(result.current.showToolRender).toBe(false);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.showToolRender).toBe(true);
  });

  it('ignores collapse requests on an always-expanded card', () => {
    const { result } = renderHook(() =>
      useToolExpandState({ isAlwaysExpand: true, needExpand: true }),
    );

    act(() => {
      result.current.handleExpand(false);
    });

    expect(result.current.showToolRender).toBe(true);
  });

  it('turns debug off when collapsing', () => {
    const { result } = renderHook(() =>
      useToolExpandState({ isAlwaysExpand: false, needExpand: true }),
    );

    act(() => {
      result.current.setShowDebug(true);
    });
    act(() => {
      result.current.handleExpand(false);
    });

    expect(result.current.showDebug).toBe(false);
    expect(result.current.showToolRender).toBe(false);
  });
});
