export interface Point {
  x: number;
  y: number;
}

export interface Size {
  height: number;
  width: number;
}

/** Gap the floating recorder keeps from every viewport edge. */
export const VIEWPORT_MARGIN = 12;

/** Keep a box of `size` fully inside the viewport. */
export const clampPosition = (position: Point, size: Size, viewport: Size): Point => ({
  x: Math.min(
    Math.max(VIEWPORT_MARGIN, position.x),
    Math.max(VIEWPORT_MARGIN, viewport.width - size.width - VIEWPORT_MARGIN),
  ),
  y: Math.min(
    Math.max(VIEWPORT_MARGIN, position.y),
    Math.max(VIEWPORT_MARGIN, viewport.height - size.height - VIEWPORT_MARGIN),
  ),
});
