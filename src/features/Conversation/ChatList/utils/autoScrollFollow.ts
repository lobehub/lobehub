/**
 * Distance (px) from the real bottom within which a scroll re-attaches
 * streaming auto-scroll. Kept far tighter than `AT_BOTTOM_THRESHOLD` so a user
 * reading a few lines above the bottom is not grabbed back by the next chunk.
 */
export const AUTO_SCROLL_REATTACH_THRESHOLD = 24;

/**
 * Sub-pixel slack for "the viewport sits on the real bottom". A user scroll-up
 * always leaves at least its own delta below the viewport, so an upward move
 * that still ends here can only be the browser clamping the offset after the
 * content shrank (e.g. collapsing a block near the bottom).
 */
const AT_REAL_BOTTOM_EPSILON = 1;

interface ResolveAutoScrollDetachedParams {
  /** Current detached state */
  detached: boolean;
  /** Remaining distance between the viewport bottom and the content bottom */
  distanceToBottom: number;
  /** Whether a wheel / scroll key / touch move / pointer drag happened just before this scroll */
  hasActiveScrollInput: boolean;
  /** Scroll offset after this scroll event */
  offset: number;
  /** Scroll offset of the previous scroll event, `null` when unknown */
  prevOffset: number | null;
}

/**
 * Decide whether streaming auto-scroll should stay detached after a scroll event.
 *
 * - Sitting on the real bottom always stays attached, including an upward
 *   offset clamp caused by content shrinking there.
 * - A user-initiated upward scroll detaches, even inside the `atBottom` band
 *   and even by a few pixels.
 * - Reaching the bottom again (by the user, BackBottom, or auto-scroll itself)
 *   re-attaches.
 * - Anything else keeps the current state, so content growth or programmatic
 *   corrections never flip it.
 */
export const resolveAutoScrollDetached = ({
  detached,
  distanceToBottom,
  hasActiveScrollInput,
  offset,
  prevOffset,
}: ResolveAutoScrollDetachedParams): boolean => {
  if (distanceToBottom <= AT_REAL_BOTTOM_EPSILON) return false;

  if (hasActiveScrollInput && prevOffset !== null && offset < prevOffset) return true;

  if (distanceToBottom <= AUTO_SCROLL_REATTACH_THRESHOLD) return false;

  return detached;
};
