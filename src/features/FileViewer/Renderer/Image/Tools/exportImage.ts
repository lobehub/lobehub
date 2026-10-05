import type { NormalizedRect, Size } from '../geometry';
import { type AnnotationShape, drawShapes } from './Annotate/shapes';

export class ImagePixelsUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Image pixels are not readable from this origin');
    this.name = 'ImagePixelsUnavailableError';
    this.cause = cause;
  }
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', () => reject(new Error(`Failed to load image: ${src}`)));
    img.src = src;
  });

/**
 * Load an image whose pixels a canvas may read. Storage URLs are cross-origin
 * and the viewer has usually displayed them already without CORS, so the HTTP
 * cache may hold a response with no `Access-Control-Allow-Origin`; reading the
 * bytes with `cache: 'no-store'` sidesteps that entry. Blob and data URLs are
 * same-origin and load directly.
 */
export const loadReadableImage = async (src: string): Promise<HTMLImageElement> => {
  if (src.startsWith('blob:') || src.startsWith('data:')) return loadImage(src);

  let blob: Blob;
  try {
    const response = await fetch(src, { cache: 'no-store', credentials: 'omit', mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    blob = await response.blob();
  } catch (error) {
    throw new ImagePixelsUnavailableError(error);
  }

  const blobUrl = URL.createObjectURL(blob);
  try {
    return await loadImage(blobUrl);
  } finally {
    // The decoded image keeps its pixels; the blob URL is no longer needed.
    URL.revokeObjectURL(blobUrl);
  }
};

export interface RenderImageOptions {
  /** Region of the source to keep; defaults to the whole image. */
  crop?: NormalizedRect;
  /** Output pixel size; defaults to the cropped region at natural resolution. */
  output?: Size;
  /** Annotations drawn in the source's normalized space. */
  shapes?: AnnotationShape[];
  type?: 'image/png' | 'image/jpeg' | 'image/webp';
}

/**
 * Render the source image (optionally cropped, scaled, and annotated) into a
 * new PNG blob. The original file is never touched.
 */
export const renderImageToBlob = (
  img: CanvasImageSource & { naturalHeight: number; naturalWidth: number },
  {
    crop = { height: 1, width: 1, x: 0, y: 0 },
    output,
    shapes = [],
    type = 'image/png',
  }: RenderImageOptions = {},
): Promise<Blob> => {
  const natural = { height: img.naturalHeight, width: img.naturalWidth };
  const source = {
    height: crop.height * natural.height,
    width: crop.width * natural.width,
    x: crop.x * natural.width,
    y: crop.y * natural.height,
  };
  const size = output ?? {
    height: Math.max(1, Math.round(source.height)),
    width: Math.max(1, Math.round(source.width)),
  };

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas 2D context is unavailable'));

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    img,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    size.width,
    size.height,
  );

  if (shapes.length > 0) {
    // Shapes are normalized to the full image; draw them in full-image pixel
    // space and shift/scale so the crop window lands on the canvas.
    const scaleX = size.width / source.width;
    const scaleY = size.height / source.height;
    ctx.save();
    ctx.setTransform(scaleX, 0, 0, scaleY, -source.x * scaleX, -source.y * scaleY);
    drawShapes(ctx, shapes, natural.width, natural.height);
    ctx.restore();
  }

  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas export produced no data'));
      }, type);
    } catch (error) {
      // A tainted canvas throws SecurityError synchronously.
      reject(new ImagePixelsUnavailableError(error));
    }
  });
};
