/**
 * The arithmetic of a two-finger zoom, kept apart from the touch plumbing so
 * it can be checked without a browser.
 */

export interface Point {
  x: number;
  y: number;
}

export const touchDistance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export const touchMidpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

/**
 * The zoom a pinch has reached: the zoom at the moment the second finger
 * landed, scaled by how far the fingers have spread since, clamped to the
 * range the zoom buttons can reach.
 */
export const pinchedZoom = (
  startZoom: number,
  startDistance: number,
  distance: number,
  min: number,
  max: number,
) => {
  if (startDistance <= 0) return startZoom;
  return Math.min(Math.max(startZoom * (distance / startDistance), min), max);
};

/**
 * Keep the point under the fingers where it was after the content grew by
 * `ratio`: the anchor's distance from the content origin scales, the anchor's
 * place on screen must not.
 */
export const anchoredScroll = (scroll: number, anchor: number, ratio: number) =>
  Math.max((scroll + anchor) * ratio - anchor, 0);
