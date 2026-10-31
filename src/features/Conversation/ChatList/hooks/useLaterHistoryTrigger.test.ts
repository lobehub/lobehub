/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import type { KeyboardEvent, RefObject, TouchEvent, WheelEvent } from 'react';
import type { VListHandle } from 'virtua';
import { describe, expect, it, vi } from 'vitest';

import { LATER_HISTORY_TRIGGER_PX, useLaterHistoryTrigger } from './useLaterHistoryTrigger';

const VIEWPORT = 600;

const refAt = (distanceToEnd: number, scrollSize = 4000): RefObject<VListHandle | null> => ({
  current: {
    scrollOffset: Math.max(0, scrollSize - VIEWPORT - distanceToEnd),
    scrollSize,
    viewportSize: VIEWPORT,
  } as unknown as VListHandle,
});

const wheel = (deltaY: number) => ({ deltaY }) as WheelEvent<HTMLElement>;
const key = (value: string) => ({ key: value }) as KeyboardEvent<HTMLElement>;
const touchAt = (clientY: number) =>
  ({ touches: [{ clientY }] }) as unknown as TouchEvent<HTMLElement>;

const setup = (virtuaRef: RefObject<VListHandle | null>, enabled = true) => {
  const loadLaterMessages = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    useLaterHistoryTrigger({ enabled, loadLaterMessages, virtuaRef }),
  );
  return { loadLaterMessages, trigger: result.current };
};

describe('useLaterHistoryTrigger', () => {
  it('loads on a wheel-down over a first page too short to scroll', () => {
    const { loadLaterMessages, trigger } = setup(refAt(0, 300));

    trigger.onWheel(wheel(120));

    expect(loadLaterMessages).toHaveBeenCalledTimes(1);
  });

  it('ignores a wheel-up and any gesture away from the end', () => {
    const atEnd = setup(refAt(0));
    atEnd.trigger.onWheel(wheel(-120));
    expect(atEnd.loadLaterMessages).not.toHaveBeenCalled();

    const farUp = setup(refAt(LATER_HISTORY_TRIGGER_PX));
    farUp.trigger.onWheel(wheel(120));
    farUp.trigger.onUserScroll();
    farUp.trigger.onKeyDown(key('PageDown'));
    expect(farUp.loadLaterMessages).not.toHaveBeenCalled();
  });

  it('loads on a user scroll that reaches the end region', () => {
    const { loadLaterMessages, trigger } = setup(refAt(LATER_HISTORY_TRIGGER_PX - 1));

    trigger.onUserScroll();

    expect(loadLaterMessages).toHaveBeenCalledTimes(1);
  });

  it('loads on downward navigation keys only', () => {
    const { loadLaterMessages, trigger } = setup(refAt(0));

    trigger.onKeyDown(key('ArrowUp'));
    trigger.onKeyDown(key('Home'));
    expect(loadLaterMessages).not.toHaveBeenCalled();

    trigger.onKeyDown(key('ArrowDown'));
    trigger.onKeyDown(key('PageDown'));
    trigger.onKeyDown(key('End'));
    expect(loadLaterMessages).toHaveBeenCalledTimes(3);
  });

  it('loads when a touch drags upward (content scrolls down), not downward', () => {
    const { loadLaterMessages, trigger } = setup(refAt(0));

    trigger.onTouchStart(touchAt(300));
    trigger.onTouchMove(touchAt(360));
    expect(loadLaterMessages).not.toHaveBeenCalled();

    trigger.onTouchMove(touchAt(250));
    expect(loadLaterMessages).toHaveBeenCalledTimes(1);
  });

  it('never loads on a newest-first list', () => {
    const { loadLaterMessages, trigger } = setup(refAt(0, 300), false);

    trigger.onWheel(wheel(120));
    trigger.onUserScroll();
    trigger.onKeyDown(key('End'));
    trigger.onTouchStart(touchAt(300));
    trigger.onTouchMove(touchAt(250));

    expect(loadLaterMessages).not.toHaveBeenCalled();
  });
});
