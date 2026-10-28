import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attachHoldGesture,
  HOLD_TO_DICTATE_DELAY_MS,
  HOLD_TO_DICTATE_MOVE_TOLERANCE_PX,
  resolveHoldRelease,
} from './holdGesture';

const pointer = (
  target: EventTarget,
  type: string,
  init: Partial<{
    button: number;
    clientX: number;
    clientY: number;
    pointerId: number;
    pointerType: string;
    shiftKey: boolean;
  }> = {},
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: init.button ?? 0,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    shiftKey: init.shiftKey ?? false,
  });
  Object.assign(event, {
    pointerId: init.pointerId ?? 1,
    pointerType: init.pointerType ?? 'mouse',
  });
  target.dispatchEvent(event);
};

describe('resolveHoldRelease', () => {
  it('maps the session status at release to the action that ends the hold', () => {
    expect(resolveHoldRelease('listening')).toBe('stop');
    expect(resolveHoldRelease('connecting')).toBe('stopWhenListening');
    expect(resolveHoldRelease('requesting_permission')).toBe('cancel');
    expect(resolveHoldRelease('finalizing')).toBe('none');
    expect(resolveHoldRelease('idle')).toBe('none');
    expect(resolveHoldRelease('error')).toBe('none');
  });
});

describe('attachHoldGesture', () => {
  let element: HTMLDivElement;
  let detach: () => void;
  const onHoldStart = vi.fn();
  const onHoldEnd = vi.fn();
  const onPress = vi.fn();
  let canStart = true;

  beforeEach(() => {
    vi.useFakeTimers();
    canStart = true;
    element = document.createElement('div');
    document.body.append(element);
    detach = attachHoldGesture(element, {
      canStart: () => canStart,
      onHoldEnd,
      onHoldStart,
      onPress,
    });
  });

  afterEach(() => {
    detach();
    element.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('starts after the press outlasts the delay and ends on release anywhere', () => {
    pointer(element, 'pointerdown');
    expect(onPress).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(HOLD_TO_DICTATE_DELAY_MS - 1);
    expect(onHoldStart).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onHoldStart).toHaveBeenCalledTimes(1);
    expect(element.style.userSelect).toBe('none');

    pointer(document.body, 'pointerup');
    expect(onHoldEnd).toHaveBeenCalledTimes(1);
    expect(element.style.userSelect).toBe('');
  });

  it('treats a short press as a click', () => {
    pointer(element, 'pointerdown');
    vi.advanceTimersByTime(HOLD_TO_DICTATE_DELAY_MS / 2);
    pointer(element, 'pointerup');
    vi.advanceTimersByTime(HOLD_TO_DICTATE_DELAY_MS);

    expect(onHoldStart).not.toHaveBeenCalled();
    expect(onHoldEnd).not.toHaveBeenCalled();
  });

  it('treats a press that drifts as a selection drag', () => {
    pointer(element, 'pointerdown', { clientX: 10, clientY: 10 });
    pointer(window, 'pointermove', {
      clientX: 10 + HOLD_TO_DICTATE_MOVE_TOLERANCE_PX + 1,
      clientY: 10,
    });
    vi.advanceTimersByTime(HOLD_TO_DICTATE_DELAY_MS);

    expect(onHoldStart).not.toHaveBeenCalled();
  });

  it('keeps holding when the pointer moves after the hold started', () => {
    pointer(element, 'pointerdown', { clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(HOLD_TO_DICTATE_DELAY_MS);
    pointer(window, 'pointermove', { clientX: 200, clientY: 10 });

    expect(onHoldEnd).not.toHaveBeenCalled();
  });

  it('ignores touch, secondary-button and modified presses', () => {
    pointer(element, 'pointerdown', { pointerType: 'touch' });
    pointer(element, 'pointerdown', { button: 2 });
    pointer(element, 'pointerdown', { shiftKey: true });
    vi.advanceTimersByTime(HOLD_TO_DICTATE_DELAY_MS);

    expect(onPress).not.toHaveBeenCalled();
    expect(onHoldStart).not.toHaveBeenCalled();
  });

  it('does not start when dictation becomes unavailable during the press', () => {
    pointer(element, 'pointerdown');
    canStart = false;
    vi.advanceTimersByTime(HOLD_TO_DICTATE_DELAY_MS);

    expect(onHoldStart).not.toHaveBeenCalled();
  });

  it('ends an active hold when the window loses focus or the gesture is detached', () => {
    pointer(element, 'pointerdown');
    vi.advanceTimersByTime(HOLD_TO_DICTATE_DELAY_MS);
    window.dispatchEvent(new Event('blur'));
    expect(onHoldEnd).toHaveBeenCalledTimes(1);

    pointer(element, 'pointerdown', { pointerId: 2 });
    vi.advanceTimersByTime(HOLD_TO_DICTATE_DELAY_MS);
    detach();
    expect(onHoldEnd).toHaveBeenCalledTimes(2);
  });
});
