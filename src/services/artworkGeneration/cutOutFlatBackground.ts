/**
 * Image models cannot hand back a real alpha channel here — Nano Banana returns
 * JPEG, and asking it for "a transparent background" makes it *paint* a
 * checkerboard instead. So the full-body prompt asks for one flat, uniform
 * backdrop color and this module keys that backdrop out afterwards, which is
 * what actually produces the transparent PNG the home surface needs.
 */

export interface RgbaImage {
  data: Uint8ClampedArray;
  height: number;
  width: number;
}

export interface CutOutOptions {
  /** Max squared RGB distance from the sampled backdrop that still counts as backdrop. */
  tolerance?: number;
}

export interface CutOutResult {
  /** False when the result was rejected as untrustworthy and `data` was left untouched. */
  applied: boolean;
  /**
   * Bounding box of what survived, or `undefined` when nothing did. Callers crop
   * to it so the stored artwork's edges are the character's edges — see
   * {@link subjectBounds}.
   */
  bounds?: SubjectBounds;
  /** Share of pixels turned fully transparent, 0–1. */
  removedRatio: number;
}

export interface SubjectBounds {
  height: number;
  left: number;
  top: number;
  width: number;
}

/**
 * Box around every pixel the cut-out kept.
 *
 * A model frames a standing character with whatever margin it likes — measured
 * against the built-in artwork, a generated full body filled only 35% of its
 * canvas width where the catalog's fills 75%. Cropping to this box makes the
 * file's edges mean the same thing every time, so one display rule can size any
 * character instead of guessing per source.
 */
export const subjectBounds = ({ data, height, width }: RgbaImage): SubjectBounds | undefined => {
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= ALPHA_FLOOR) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return;

  return { height: maxY - minY + 1, left: minX, top: minY, width: maxX - minX + 1 };
};

/** Squared distance keeps the hot loop free of `Math.sqrt`. */
const TOLERANCE = 26 * 26 * 3;
/** Alpha at or below this is background as far as the subject box is concerned. */
const ALPHA_FLOOR = 16;
/** Below this the backdrop clearly was not flat; above it the character was eaten. */
const MIN_REMOVED_RATIO = 0.05;
const MAX_REMOVED_RATIO = 0.97;

const distanceSquared = (
  data: Uint8ClampedArray,
  offset: number,
  r: number,
  g: number,
  b: number,
): number => {
  const dr = data[offset] - r;
  const dg = data[offset + 1] - g;
  const db = data[offset + 2] - b;

  return dr * dr + dg * dg + db * db;
};

/**
 * The backdrop color is read from the frame rather than assumed, so the prompt
 * stays free to pick whatever color contrasts with the character. The median of
 * each channel ignores the few border pixels a pose may legitimately touch.
 */
const sampleBackdrop = ({ data, height, width }: RgbaImage): [number, number, number] => {
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];

  const push = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    reds.push(data[offset]);
    greens.push(data[offset + 1]);
    blues.push(data[offset + 2]);
  };

  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }

  const median = (values: number[]) => {
    values.sort((a, b) => a - b);

    return values[Math.floor(values.length / 2)];
  };

  return [median(reds), median(greens), median(blues)];
};

/**
 * Clears the backdrop of an already-decoded image in place.
 *
 * Only backdrop-colored pixels *connected to the frame* are cleared, so the same
 * color inside the character (an eye highlight, a white collar) survives. Pixels
 * that merely sit near the backdrop color get a partial alpha, which keeps the
 * anti-aliased silhouette from turning into a hard jagged edge.
 */
export const cutOutFlatBackground = (image: RgbaImage, options?: CutOutOptions): CutOutResult => {
  const { data, height, width } = image;
  const tolerance = options?.tolerance ?? TOLERANCE;
  const [r, g, b] = sampleBackdrop(image);

  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const stack: number[] = [];

  const push = (pixel: number) => {
    if (visited[pixel]) return;
    visited[pixel] = 1;
    if (distanceSquared(data, pixel * 4, r, g, b) > tolerance * 4) return;
    stack.push(pixel);
  };

  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }

  let removed = 0;

  while (stack.length > 0) {
    const pixel = stack.pop() as number;
    const offset = pixel * 4;
    const distance = distanceSquared(data, offset, r, g, b);

    if (distance <= tolerance) {
      data[offset + 3] = 0;
      removed += 1;
    } else {
      // Feather zone: the closer to the backdrop, the more transparent.
      const ratio = (distance - tolerance) / (tolerance * 3);
      data[offset + 3] = Math.round(data[offset + 3] * Math.min(1, ratio));
      continue;
    }

    const x = pixel % width;
    const y = (pixel - x) / width;

    if (x > 0) push(pixel - 1);
    if (x < width - 1) push(pixel + 1);
    if (y > 0) push(pixel - width);
    if (y < height - 1) push(pixel + width);
  }

  const removedRatio = removed / pixelCount;
  const applied = removedRatio >= MIN_REMOVED_RATIO && removedRatio <= MAX_REMOVED_RATIO;

  return { applied, bounds: applied ? subjectBounds(image) : undefined, removedRatio };
};
