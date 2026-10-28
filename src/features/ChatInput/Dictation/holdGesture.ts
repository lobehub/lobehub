import type { RealtimeDictationStatus } from './contract';

export const HOLD_TO_DICTATE_DELAY_MS = 450;
// A press that drifts further than this is a text selection drag, not a hold.
export const HOLD_TO_DICTATE_MOVE_TOLERANCE_PX = 6;

export type HoldReleaseAction = 'cancel' | 'none' | 'stop' | 'stopWhenListening';

/**
 * What releasing a hold means for the session at its current status. A release
 * during the microphone permission prompt is the user clicking the prompt, so
 * that run is abandoned; a release while still connecting keeps the buffered
 * speech and ends the session as soon as it is listening.
 */
export const resolveHoldRelease = (status: RealtimeDictationStatus): HoldReleaseAction => {
  if (status === 'listening') return 'stop';
  if (status === 'connecting') return 'stopWhenListening';
  if (status === 'requesting_permission') return 'cancel';

  return 'none';
};

interface HoldGestureOptions {
  canStart: () => boolean;
  delayMs?: number;
  moveTolerancePx?: number;
  onHoldEnd: () => void;
  onHoldStart: () => void;
  /** A qualifying press began; it may still turn out to be a click. */
  onPress?: () => void;
}

/**
 * Turns a primary-button press that stays still on `element` into a hold:
 * `onHoldStart` fires once the press outlasts the delay, `onHoldEnd` when that
 * press is released anywhere in the window. Clicks and selection drags never
 * reach either callback.
 */
export const attachHoldGesture = (
  element: HTMLElement,
  {
    canStart,
    delayMs = HOLD_TO_DICTATE_DELAY_MS,
    moveTolerancePx = HOLD_TO_DICTATE_MOVE_TOLERANCE_PX,
    onHoldEnd,
    onHoldStart,
    onPress,
  }: HoldGestureOptions,
) => {
  const view = element.ownerDocument.defaultView ?? window;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pointerId: number | undefined;
  let origin = { x: 0, y: 0 };
  let holding = false;
  let previousUserSelect = '';

  const detachWindowListeners = () => {
    view.removeEventListener('pointermove', handleMove);
    view.removeEventListener('pointerup', handleRelease);
    view.removeEventListener('pointercancel', handleRelease);
    view.removeEventListener('blur', handleBlur);
  };

  const reset = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    pointerId = undefined;
    detachWindowListeners();
    if (holding) {
      holding = false;
      element.style.userSelect = previousUserSelect;
      onHoldEnd();
    }
  };

  function handleMove(event: PointerEvent) {
    if (event.pointerId !== pointerId || holding) return;
    const distance = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
    if (distance > moveTolerancePx) reset();
  }

  function handleRelease(event: PointerEvent) {
    if (event.pointerId === pointerId) reset();
  }

  function handleBlur() {
    reset();
  }

  const handleDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.pointerType === 'touch' || pointerId !== undefined) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!canStart()) return;

    pointerId = event.pointerId;
    origin = { x: event.clientX, y: event.clientY };
    view.addEventListener('pointermove', handleMove);
    view.addEventListener('pointerup', handleRelease);
    view.addEventListener('pointercancel', handleRelease);
    view.addEventListener('blur', handleBlur);
    onPress?.();
    timer = setTimeout(() => {
      timer = undefined;
      if (!canStart()) {
        reset();
        return;
      }
      holding = true;
      // Moving while holding must not turn into a selection over the draft.
      previousUserSelect = element.style.userSelect;
      element.style.userSelect = 'none';
      onHoldStart();
    }, delayMs);
  };

  element.addEventListener('pointerdown', handleDown);

  return () => {
    element.removeEventListener('pointerdown', handleDown);
    reset();
  };
};
