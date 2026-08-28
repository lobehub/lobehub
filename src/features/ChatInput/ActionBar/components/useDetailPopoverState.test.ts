import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { closeToolDetailPopovers, useDetailPopoverState } from './useDetailPopoverState';

describe('useDetailPopoverState', () => {
  it('opens on hover by default', () => {
    const { result } = renderHook(() => useDetailPopoverState());

    act(() => result.current.onOpenChange(true));

    expect(result.current.open).toBe(true);
  });

  it('closes and suppresses reopening right after a policy menu takes over', () => {
    const { result } = renderHook(() => useDetailPopoverState());

    act(() => result.current.onOpenChange(true));
    act(() => closeToolDetailPopovers());

    expect(result.current.open).toBe(false);

    act(() => result.current.onOpenChange(true));

    expect(result.current.open).toBe(false);
  });

  // Regression: the "..." policy menu anchors to the same row edge as the detail
  // popover, so a detail card reopening on top of it swallows the click meant for
  // the menu — the uninstall confirm modal never appeared. The suppression window
  // above expires after 600ms, so `disabled` has to hold the interlock on its own
  // for as long as the policy menu stays open.
  it('never reopens while disabled, even after the suppression window expires', () => {
    const { rerender, result } = renderHook(
      ({ disabled }: { disabled: boolean }) => useDetailPopoverState(disabled),
      { initialProps: { disabled: false } },
    );

    act(() => result.current.onOpenChange(true));
    expect(result.current.open).toBe(true);

    rerender({ disabled: true });
    expect(result.current.open).toBe(false);

    act(() => result.current.onOpenChange(true));
    expect(result.current.open).toBe(false);
  });

  it('allows hover again once the policy menu closes', () => {
    const { rerender, result } = renderHook(
      ({ disabled }: { disabled: boolean }) => useDetailPopoverState(disabled),
      { initialProps: { disabled: true } },
    );

    act(() => result.current.onOpenChange(true));
    expect(result.current.open).toBe(false);

    rerender({ disabled: false });
    act(() => result.current.onOpenChange(true));

    expect(result.current.open).toBe(true);
  });
});
