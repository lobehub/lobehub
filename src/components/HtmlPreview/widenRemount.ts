/** How much wider the container must get before the frame is measured again. */
export const WIDEN_REMOUNT_THRESHOLD = 24;

/**
 * The preview's auto-height reports `documentElement.scrollHeight`, which never
 * drops below the frame's current height: a frame first measured in a narrow
 * container keeps that tall height after the container widens. Track the
 * narrowest width since the frame mounted and ask for a fresh frame once the
 * container is clearly wider than that. Narrowing needs nothing — the frame
 * grows on its own.
 */
export const nextWidenBaseline = (
  baseline: number,
  width: number,
): { baseline: number; remount: boolean } => {
  if (width <= baseline) return { baseline: width, remount: false };
  if (width - baseline >= WIDEN_REMOUNT_THRESHOLD) return { baseline: width, remount: true };
  return { baseline, remount: false };
};
