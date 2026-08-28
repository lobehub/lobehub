import { act, renderHook } from '@testing-library/react';
import { type RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCollapsible } from './useCollapsible';

const originalResizeObserver = globalThis.ResizeObserver;

// jsdom lays nothing out, so drive the measurement directly: `useNaturalHeight`
// reads `scrollHeight` on mount, which is all these cases need.
const contentRef = (scrollHeight: number) =>
  ({ current: { scrollHeight } as unknown as HTMLElement }) as RefObject<HTMLElement | null>;

// jsdom is 768px tall, so the 35% viewport cap clamps a 280px limit to 269px:
// 900 overflows past the 32px threshold, 100 comfortably fits.
const OVERFLOWING = 900;
const FITS = 100;
const MAX_HEIGHT_LIMIT = 280;
const CLAMPED = 269;

const options = (extra: Partial<Parameters<typeof useCollapsible>[0]> = {}) => ({
  contentRef: contentRef(OVERFLOWING),
  maxHeightLimit: MAX_HEIGHT_LIMIT,
  overflowThreshold: 32,
  ...extra,
});

const click = { stopPropagation: () => {} } as Parameters<
  ReturnType<typeof useCollapsible>['toggle']
>[0];

beforeEach(() => {
  globalThis.ResizeObserver = class {
    disconnect() {}
    observe() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});

describe('useCollapsible', () => {
  it('caps the clamp at the viewport, not just the caller limit', () => {
    const { result } = renderHook(() => useCollapsible(options()));

    expect(result.current.maxHeight).toBe(CLAMPED);
  });

  it('leaves short content alone — nothing to collapse', () => {
    const onOverflowChange = vi.fn();

    const { result } = renderHook(() =>
      useCollapsible(options({ contentRef: contentRef(FITS), onOverflowChange })),
    );

    expect(result.current.shouldCollapse).toBe(false);
    expect(result.current.isCollapsed).toBe(false);
    expect(onOverflowChange).toHaveBeenCalledWith(false);
  });

  it('collapses long content by default and reports the overflow', () => {
    const onOverflowChange = vi.fn();

    const { result } = renderHook(() => useCollapsible(options({ onOverflowChange })));

    expect(result.current.shouldCollapse).toBe(true);
    expect(result.current.isCollapsed).toBe(true);
    expect(onOverflowChange).toHaveBeenCalledWith(true);
  });

  it('toggles itself when uncontrolled', () => {
    const onCollapsedChange = vi.fn();
    const { result } = renderHook(() => useCollapsible(options({ onCollapsedChange })));

    act(() => result.current.toggle(click));

    expect(result.current.isCollapsed).toBe(false);
    expect(result.current.showAsCollapsed).toBe(false);
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it('defers to the host when controlled', () => {
    const onCollapsedChange = vi.fn();
    const { rerender, result } = renderHook(
      ({ collapsed }) => useCollapsible(options({ collapsed, onCollapsedChange })),
      { initialProps: { collapsed: true } },
    );

    act(() => result.current.toggle(click));

    // The host owns the state: the toggle only reports the intent.
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
    expect(result.current.isCollapsed).toBe(true);

    rerender({ collapsed: false });

    expect(result.current.isCollapsed).toBe(false);
  });

  it('reports the overflow once — not per render, and never before measuring', () => {
    const onOverflowChange = vi.fn();
    const { rerender } = renderHook(() =>
      // Fresh inline callback identity on every render, as a JSX host would pass.
      useCollapsible(options({ onOverflowChange: (v) => onOverflowChange(v) })),
    );

    rerender();
    rerender();

    expect(onOverflowChange).toHaveBeenCalledTimes(1);
  });
});
