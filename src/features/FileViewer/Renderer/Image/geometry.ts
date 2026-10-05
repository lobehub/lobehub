export interface Size {
  height: number;
  width: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A rectangle in image space, normalized to 0–1 against the natural size. */
export interface NormalizedRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

/** Quarter turns only; the viewer rotates in 90° steps. */
export type Rotation = 0 | 90 | 180 | 270;

/** Zoom is relative to the "fit" size, so 1 always means the whole image is visible. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;
export const ZOOM_STEP = 1.25;

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const clampZoom = (zoom: number) => clamp(zoom, MIN_ZOOM, MAX_ZOOM);

export const zoomIn = (zoom: number) => clampZoom(zoom * ZOOM_STEP);

export const zoomOut = (zoom: number) => clampZoom(zoom / ZOOM_STEP);

export const nextRotation = (rotation: Rotation): Rotation => ((rotation + 90) % 360) as Rotation;

export const isQuarterTurn = (rotation: Rotation) => rotation === 90 || rotation === 270;

/**
 * Size of the (unrotated) image box that fits the container at zoom 1. A
 * quarter-turned image swaps its footprint, so the fit is computed against the
 * swapped natural size and the box keeps the image's own aspect.
 */
export const fitSize = (natural: Size, container: Size, rotation: Rotation = 0): Size => {
  if (natural.width <= 0 || natural.height <= 0 || container.width <= 0 || container.height <= 0)
    return { height: 0, width: 0 };

  const footprint = isQuarterTurn(rotation)
    ? { height: natural.width, width: natural.height }
    : natural;
  // Never upscale past 100% at fit: a small image stays crisp at its real size.
  const scale = Math.min(1, container.width / footprint.width, container.height / footprint.height);

  return { height: natural.height * scale, width: natural.width * scale };
};

/**
 * Map a pointer position to a normalized point on the image. `rect` is the
 * on-screen bounding box of the rotated image element (what
 * `getBoundingClientRect` returns); CSS rotates clockwise around the center, so
 * the pointer offset is turned back counter-clockwise before normalizing.
 */
export const clientToImagePoint = (
  client: Point,
  rect: { height: number; left: number; top: number; width: number },
  rotation: Rotation = 0,
): Point => {
  const dx = client.x - (rect.left + rect.width / 2);
  const dy = client.y - (rect.top + rect.height / 2);

  let local: Point;
  switch (rotation) {
    case 90: {
      local = { x: dy, y: -dx };
      break;
    }
    case 180: {
      local = { x: -dx, y: -dy };
      break;
    }
    case 270: {
      local = { x: -dy, y: dx };
      break;
    }
    default: {
      local = { x: dx, y: dy };
    }
  }

  const box = isQuarterTurn(rotation)
    ? { height: rect.width, width: rect.height }
    : { height: rect.height, width: rect.width };

  if (box.width <= 0 || box.height <= 0) return { x: 0, y: 0 };

  return {
    x: clamp(local.x / box.width + 0.5, 0, 1),
    y: clamp(local.y / box.height + 0.5, 0, 1),
  };
};

/**
 * Where a normalized image point lands within the rotated image's on-screen
 * box (also 0–1). Used to keep popovers on the side of a point that has room.
 */
export const imagePointToScreenFraction = (point: Point, rotation: Rotation = 0): Point => {
  switch (rotation) {
    case 90: {
      return { x: 1 - point.y, y: point.x };
    }
    case 180: {
      return { x: 1 - point.x, y: 1 - point.y };
    }
    case 270: {
      return { x: point.y, y: 1 - point.x };
    }
    default: {
      return point;
    }
  }
};

/** `photo.jpeg` + `annotated` → `photo-annotated.png` */
export const buildDerivedFileName = (name: string | undefined, suffix: string, ext = 'png') => {
  const base = (name || 'image').replace(/\.[^./\\]+$/, '') || 'image';
  return `${base}-${suffix}.${ext}`;
};

export type DerivedImageOperation = 'annotate' | 'erase' | 'removeBackground' | 'resize';

export const DERIVED_FILE_SUFFIX: Record<DerivedImageOperation, string> = {
  annotate: 'annotated',
  erase: 'erased',
  removeBackground: 'no-bg',
  resize: 'resized',
};

/** Lineage recorded on a derived file; the original is never overwritten. */
export const buildDerivedFileMetadata = (
  sourceFileId: string,
  operation: DerivedImageOperation,
) => ({
  derivedFrom: { fileId: sourceFileId, operation },
});
