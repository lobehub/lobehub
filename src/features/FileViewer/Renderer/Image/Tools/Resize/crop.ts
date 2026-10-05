import { clamp, type NormalizedRect, type Size } from '../../geometry';

export type AspectPreset = 'free' | 'original' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16';

export const ASPECT_PRESETS: AspectPreset[] = [
  'free',
  'original',
  '1:1',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
];

/** Largest output edge we will render, to keep the canvas inside browser limits. */
export const MAX_OUTPUT_EDGE = 8192;

/** Smallest crop edge, as a fraction of the image, so handles never collapse. */
const MIN_CROP = 0.02;

/** Pixel aspect (width / height) for a preset, or `undefined` when unconstrained. */
export const aspectRatioOf = (preset: AspectPreset, natural: Size): number | undefined => {
  if (preset === 'free') return undefined;
  if (preset === 'original') return natural.width / natural.height;
  const [w, h] = preset.split(':').map(Number);
  return w / h;
};

/** The largest centered crop with the given pixel aspect. */
export const centeredCrop = (natural: Size, aspect: number | undefined): NormalizedRect => {
  if (!aspect) return { height: 1, width: 1, x: 0, y: 0 };

  const imageAspect = natural.width / natural.height;
  if (aspect > imageAspect) {
    const height = imageAspect / aspect;
    return { height, width: 1, x: 0, y: (1 - height) / 2 };
  }
  const width = aspect / imageAspect;
  return { height: 1, width, x: (1 - width) / 2, y: 0 };
};

export type CropHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

/**
 * Apply a drag delta (normalized) to a crop rect. Corners resize against the
 * opposite, fixed corner; a locked aspect drives height from width. The result
 * always stays inside the image.
 */
export const dragCrop = (
  start: NormalizedRect,
  handle: CropHandle,
  delta: { x: number; y: number },
  natural: Size,
  aspect?: number,
): NormalizedRect => {
  if (handle === 'move') {
    return {
      ...start,
      x: clamp(start.x + delta.x, 0, 1 - start.width),
      y: clamp(start.y + delta.y, 0, 1 - start.height),
    };
  }

  const west = handle === 'nw' || handle === 'sw';
  const north = handle === 'nw' || handle === 'ne';
  const anchorX = west ? start.x + start.width : start.x;
  const anchorY = north ? start.y + start.height : start.y;

  const maxWidth = west ? anchorX : 1 - anchorX;
  const maxHeight = north ? anchorY : 1 - anchorY;

  let width = clamp(start.width + (west ? -delta.x : delta.x), MIN_CROP, maxWidth);
  let height = clamp(start.height + (north ? -delta.y : delta.y), MIN_CROP, maxHeight);

  if (aspect) {
    // Normalized height for a normalized width at this pixel aspect.
    const ratio = natural.width / natural.height / aspect;
    height = width * ratio;
    if (height > maxHeight) {
      height = maxHeight;
      width = height / ratio;
    }
  }

  return {
    height,
    width,
    x: west ? anchorX - width : anchorX,
    y: north ? anchorY - height : anchorY,
  };
};

/** Pixel size of a crop at the image's natural resolution. */
export const cropPixelSize = (crop: NormalizedRect, natural: Size): Size => ({
  height: Math.max(1, Math.round(crop.height * natural.height)),
  width: Math.max(1, Math.round(crop.width * natural.width)),
});

/**
 * Resolve the output size from the user's width/height entry. With the ratio
 * locked, the edited side wins and the other follows the crop's aspect.
 */
export const resolveOutputSize = (
  crop: Size,
  input: { edited: 'height' | 'width'; height: number; width: number },
  locked: boolean,
): Size => {
  const safe = (value: number) => clamp(Math.round(value) || 1, 1, MAX_OUTPUT_EDGE);
  if (!locked) return { height: safe(input.height), width: safe(input.width) };

  const aspect = crop.width / crop.height;
  if (input.edited === 'width') {
    const width = safe(input.width);
    return { height: safe(width / aspect), width };
  }
  const height = safe(input.height);
  return { height, width: safe(height * aspect) };
};
