/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import type { KeyboardEvent, RefObject, TouchEvent, WheelEvent } from 'react';
import type { VListHandle } from 'virtua';
import { describe, expect, it, vi } from 'vitest';

import { EARLIER_HISTORY_TRIGGER_PX, useEarlierHistoryTrigger } from './useEarlierHistoryTrigger';

const refOf = (scrollOffset: number): RefObject<VListHandle | null> => ({
  current: { scrollOffset } as unknown as VListHandle,
});

const wheel = (deltaY: number) => ({ deltaY }) as WheelEvent<HTMLElement>;
const key = (value: string) => ({ key: value }) as KeyboardEvent<HTMLElement>;
const touchAt = (clientY: number) =>
  ({ touches: [{ clientY }] }) as unknown as TouchEvent<HTMLElement>;

const setup = (scrollOffset: number) => {
  const loadEarlierMessages = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    useEarlierHistoryTrigger({ loadEarlierMessages, virtuaRef: refOf(scrollOffset) }),
  );
  return { loadEarlierMessages, trigger: result.current };
};

describe('useEarlierHistoryTrigger', () => {
  it('loads on a wheel-up over a list too short to scroll', () => {
    // A long topic whose last round collapses into one workflow block renders
    // shorter than the viewport: scrollOffset stays 0 and no scroll event ever
    // fires, so the wheel itself must be the trigger.
    const { loadEarlierMessages, trigger } = setup(0);

    trigger.onWheel(wheel(-120));

    expect(loadEarlierMessages).toHaveBeenCalledTimes(1);
  });

  it('ignores a wheel-down and any gesture away from the top', () => {
    const atTop = setup(0);
    atTop.trigger.onWheel(wheel(120));
    expect(atTop.loadEarlierMessages).not.toHaveBeenCalled();

    const farDown = setup(EARLIER_HISTORY_TRIGGER_PX);
    farDown.trigger.onWheel(wheel(-120));
    farDown.trigger.onUserScroll();
    farDown.trigger.onKeyDown(key('PageUp'));
    expect(farDown.loadEarlierMessages).not.toHaveBeenCalled();
  });

  it('loads on a user scroll that reaches the top region', () => {
    const { loadEarlierMessages, trigger } = setup(EARLIER_HISTORY_TRIGGER_PX - 1);

    trigger.onUserScroll();

    expect(loadEarlierMessages).toHaveBeenCalledTimes(1);
  });

  it('loads on upward navigation keys only', () => {
    const { loadEarlierMessages, trigger } = setup(0);

    trigger.onKeyDown(key('ArrowDown'));
    trigger.onKeyDown(key('End'));
    expect(loadEarlierMessages).not.toHaveBeenCalled();

    trigger.onKeyDown(key('ArrowUp'));
    trigger.onKeyDown(key('PageUp'));
    trigger.onKeyDown(key('Home'));
    expect(loadEarlierMessages).toHaveBeenCalledTimes(3);
  });

  it('loads when a touch drags downward (content scrolls up), not upward', () => {
    const { loadEarlierMessages, trigger } = setup(0);

    trigger.onTouchStart(touchAt(300));
    trigger.onTouchMove(touchAt(250));
    expect(loadEarlierMessages).not.toHaveBeenCalled();

    trigger.onTouchMove(touchAt(360));
    expect(loadEarlierMessages).toHaveBeenCalledTimes(1);
  });
});
