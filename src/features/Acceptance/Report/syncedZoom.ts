/**
 * Zoom math for the full-screen comparison. Both panes share one view, so the
 * same region of the before and after captures stays under each other.
 *
 * Coordinates are pane-local pixels; the content box is the pane itself, scaled
 * from its top-left corner (`transform-origin: 0 0`).
 */
export interface ZoomView {
  scale: number;
  /** Translation of the scaled content, in pane pixels. */
  x: number;
  y: number;
}

/**
 * The pane box and, inside it at scale 1, the part the picture actually covers.
 * An `object-fit: contain` image leaves letterbox bars, so bounding by the box
 * alone would let a wide capture pan into empty space once zoomed.
 */
export interface ZoomFrame {
  content: { height: number; width: number; x: number; y: number };
  height: number;
  width: number;
}

export const FIT_VIEW: ZoomView = { scale: 1, x: 0, y: 0 };
export const MIN_SCALE = 1;
export const MAX_SCALE = 6;
/** Scale a double-click jumps to from the fitted view. */
export const DOUBLE_CLICK_SCALE = 2.5;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A frame whose picture fills the whole box. */
export const fullFrame = (width: number, height: number): ZoomFrame => ({
  content: { height, width, x: 0, y: 0 },
  height,
  width,
});

/**
 * The part of a `width` × `height` box an `object-fit: contain` image of the
 * given natural size covers. Unknown natural size (not loaded yet) covers all.
 */
export const containedFrame = (
  width: number,
  height: number,
  naturalWidth: number,
  naturalHeight: number,
): ZoomFrame => {
  if (!naturalWidth || !naturalHeight) return fullFrame(width, height);
  const ratio = Math.min(width / naturalWidth, height / naturalHeight);
  const w = naturalWidth * ratio;
  const h = naturalHeight * ratio;
  return {
    content: { height: h, width: w, x: (width - w) / 2, y: (height - h) / 2 },
    height,
    width,
  };
};

/** The smallest frame holding both pictures, so neither pane can pan fully blank. */
export const unionFrame = (a: ZoomFrame, b: ZoomFrame): ZoomFrame => {
  const x = Math.min(a.content.x, b.content.x);
  const y = Math.min(a.content.y, b.content.y);
  const right = Math.max(a.content.x + a.content.width, b.content.x + b.content.width);
  const bottom = Math.max(a.content.y + a.content.height, b.content.y + b.content.height);
  return {
    content: { height: bottom - y, width: right - x, x, y },
    height: a.height,
    width: a.width,
  };
};

/**
 * One axis: while the scaled picture is narrower than the box it stays
 * centred, as at fit; once wider, its edges may not move inside the box.
 */
const boundAxis = (offset: number, scale: number, box: number, start: number, size: number) => {
  const scaled = size * scale;
  if (scaled <= box) return (box - scaled) / 2 - start * scale;
  return clamp(offset, box - (start + size) * scale, 0 - start * scale);
};

export const boundView = (view: ZoomView, frame: ZoomFrame): ZoomView => {
  const { content } = frame;
  return {
    scale: view.scale,
    x: boundAxis(view.x, view.scale, frame.width, content.x, content.width),
    y: boundAxis(view.y, view.scale, frame.height, content.y, content.height),
  };
};

/** Zoom to `nextScale` while keeping the pane point (px, py) fixed under the pointer. */
export const zoomViewAt = (
  view: ZoomView,
  nextScale: number,
  px: number,
  py: number,
  frame: ZoomFrame,
): ZoomView => {
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  const ratio = scale / view.scale;
  return boundView({ scale, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio }, frame);
};

export const panView = (view: ZoomView, dx: number, dy: number, frame: ZoomFrame): ZoomView =>
  boundView({ ...view, x: view.x + dx, y: view.y + dy }, frame);
