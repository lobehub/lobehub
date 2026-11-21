// Scroll speed of the marquee, in px per second.
const SCROLL_SPEED = 40;
// Share of one loop spent on each of the three holds (tail, head, tail), so
// both ends stay readable.
export const HOLD_RATIO = 0.2;
const MIN_DURATION = 3;

/** Seconds for one tail → head → tail loop over `overflow` hidden pixels. */
export const getMarqueeDuration = (overflow: number): number =>
  Math.max(MIN_DURATION, (overflow * 2) / SCROLL_SPEED / (1 - HOLD_RATIO * 3));

/**
 * Touch screens have no hover, so a tap plays one loop instead. Skipped when
 * nothing is hidden, and under reduced motion, where no animation would end
 * the reveal.
 */
export const shouldRevealOnPointerDown = ({
  overflow,
  pointerType,
  reducedMotion,
}: {
  overflow: number;
  pointerType: string;
  reducedMotion: boolean;
}): boolean => pointerType === 'touch' && overflow > 0 && !reducedMotion;
