/**
 * Width and offset are driven by springs rather than CSS transitions: both are layout
 * responses — several tabs resize and shift at once whenever one is activated, added,
 * closed or pinned — and a spring both settles more naturally and is interruptible, so
 * rapid switching redirects the motion instead of restarting a fixed ramp.
 *
 * Every animated quantity in the strip shares this one config on purpose. Same-parameter
 * springs superpose, which is what makes a tab's independently sprung x trace the same
 * path as the running sum of its neighbours' sprung widths — see `resolvePlacements`.
 *
 * restDelta of half a pixel: without it the spring keeps ticking rAF long after the
 * motion is visually over (measured still 0.1px short at 425ms), which costs a frame
 * callback per tab for nothing.
 */
export const TAB_SPRING = {
  damping: 26,
  mass: 0.4,
  restDelta: 0.5,
  restSpeed: 2,
  stiffness: 380,
} as const;
