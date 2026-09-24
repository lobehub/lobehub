/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useApprovalIslandCollapse } from './useApprovalIslandCollapse';

describe('useApprovalIslandCollapse', () => {
  it('starts expanded (not collapsed)', () => {
    const { result } = renderHook(({ count }) => useApprovalIslandCollapse(count), {
      initialProps: { count: 0 },
    });
    expect(result.current[0]).toBe(false);
  });

  it('keeps the island expanded on the idle → active transition', () => {
    const { result, rerender } = renderHook(({ count }) => useApprovalIslandCollapse(count), {
      initialProps: { count: 0 },
    });
    // First approval arrives — auto-expand keeps it open.
    rerender({ count: 1 });
    expect(result.current[0]).toBe(false);
  });

  it('does NOT re-expand when more approvals arrive after the user collapsed', () => {
    const { result, rerender } = renderHook(({ count }) => useApprovalIslandCollapse(count), {
      initialProps: { count: 1 },
    });

    // User collapses the island.
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);

    // A busy run produces a second pending approval (1 → 2). The naive
    // `count > prevCount` logic would flip collapsed back to false here; the
    // idle-transition guard must leave the user's collapse intact.
    rerender({ count: 2 });
    expect(result.current[0]).toBe(true);
  });

  it('auto-expands again only after the island goes fully idle and reactivates', () => {
    const { result, rerender } = renderHook(({ count }) => useApprovalIslandCollapse(count), {
      initialProps: { count: 1 },
    });

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);

    // Drain to idle, then a fresh batch arrives → a legitimate idle → active
    // transition re-opens the island.
    rerender({ count: 0 });
    rerender({ count: 1 });
    expect(result.current[0]).toBe(false);
  });
});
