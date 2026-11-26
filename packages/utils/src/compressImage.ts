import { inferImageMimeTypeFromBytes } from './imageMimeType';

export const MAX_IMAGE_SIZE = 1920;
// Anthropic enforces a 5MB cap on the base64-encoded image payload. Base64
// inflates binary by ~4/3, so a 3MB binary file maps to ~4MB base64 — gives
// comfortable headroom under the 5MB ceiling.
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3MB binary → ~4MB base64

export const COMPRESSIBLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// JPEG quality for canvas re-encoding (0.85 balances size and quality)
const JPEG_QUALITY = 0.85;
// Lossy WebP at this quality keeps screenshot text crisp at a fraction of the PNG size.
const WEBP_QUALITY = 0.9;
/** Below this, re-encoding as WebP costs more time than the bytes it saves. */
export const WEBP_MIN_BYTES = 200 * 1024;

/** Draws the image scaled down to fit `maxSize` on its longer side. */
const drawResized = (img: HTMLImageElement, maxSize: number) => {
  let width = img.width;
  let height = img.height;

  if (width > maxSize || height > maxSize) {
    if (width >= height) {
      height = Math.round((maxSize / width) * height);
      width = maxSize;
    } else {
      width = Math.round((maxSize / height) * width);
      height = maxSize;
    }
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  canvas.width = width;
  canvas.height = height;

  ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, width, height);

  return canvas;
};

// Preserve JPEG format with lossy compression to avoid inflating small JPEGs;
// fall back to PNG for other formats (lossless and universally supported).
const encoding = (type?: string): [string, number?] => {
  if (type === 'image/jpeg') return ['image/jpeg', JPEG_QUALITY];
  if (type === 'image/webp') return ['image/webp', WEBP_QUALITY];
  return ['image/png'];
};

const compressImage = ({
  img,
  type,
  maxSize = MAX_IMAGE_SIZE,
}: {
  img: HTMLImageElement;
  maxSize?: number;
  type?: string;
}) => drawResized(img, maxSize).toDataURL(...encoding(type === 'image/webp' ? undefined : type));

export default compressImage;

const dataUrlToFile = (dataUrl: string, name: string): File => {
  // Extract the actual MIME type from the data URL to keep content and type consistent
  const mimeType = dataUrl.split(',')[0].split(':')[1].split(';')[0];
  const binary = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mimeType });
};

/**
 * Encodes off the main thread where the browser can: a large PNG through `toDataURL` plus
 * `atob` freezes the page for seconds, which reads as a stuck upload.
 */
const encodeFile = async (canvas: HTMLCanvasElement, type: string | undefined, name: string) => {
  const [mimeType, quality] = encoding(type);
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, mimeType, quality);
    } catch {
      resolve(null);
    }
  });
  if (blob) return new File([blob], name, { type: blob.type || mimeType });
  return dataUrlToFile(canvas.toDataURL(mimeType, quality), name);
};

const correctImageFileType = async (file: File): Promise<File> => {
  const detectedMimeType = await inferImageMimeTypeFromBytes(await file.arrayBuffer());

  if (!detectedMimeType || detectedMimeType === file.type) return file;

  return new File([file], file.name, {
    lastModified: file.lastModified,
    type: detectedMimeType,
  });
};

/** Draws at shrinking sizes until the encoding fits {@link MAX_IMAGE_BYTES}. */
const encodeWithinLimit = async (img: HTMLImageElement, type: string, name: string) => {
  let maxSize = MAX_IMAGE_SIZE;
  let result: File;
  do {
    result = await encodeFile(drawResized(img, maxSize), type, name);
    maxSize = Math.round(maxSize * 0.8);
  } while (result.size > MAX_IMAGE_BYTES && maxSize > 100);
  return result;
};

const webpName = (name: string) => `${name.replace(/\.[^./]+$/, '') || name}.webp`;

export interface CompressImageOptions {
  /**
   * Re-encode as lossy WebP, which keeps transparency and is far smaller than PNG for
   * screenshots. Kept only when the browser can encode WebP and the result is smaller.
   */
  webp?: boolean;
}

export const compressImageFile = (file: File, options: CompressImageOptions = {}): Promise<File> =>
  new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.addEventListener('load', async () => {
      URL.revokeObjectURL(objectUrl);

      try {
        const normalizedFile = await correctImageFileType(file);
        const outputType = normalizedFile.type;
        const fits =
          img.width <= MAX_IMAGE_SIZE &&
          img.height <= MAX_IMAGE_SIZE &&
          normalizedFile.size <= MAX_IMAGE_BYTES;

        if (
          options.webp &&
          !(fits && (outputType === 'image/webp' || normalizedFile.size <= WEBP_MIN_BYTES))
        ) {
          const webp = await encodeWithinLimit(img, 'image/webp', webpName(normalizedFile.name));
          // A browser without a WebP encoder hands back PNG; fall through to the usual path.
          if (
            webp.type === 'image/webp' &&
            webp.size <= MAX_IMAGE_BYTES &&
            (!fits || webp.size < normalizedFile.size)
          ) {
            resolve(webp);
            return;
          }
        }

        // skip if image is small enough in both dimensions and file size
        if (fits) {
          resolve(normalizedFile);
          return;
        }

        resolve(
          await encodeWithinLimit(
            img,
            // WebP isn't encodable everywhere, so the default path keeps PNG for it.
            outputType === 'image/jpeg' ? outputType : 'image/png',
            normalizedFile.name,
          ),
        );
      } catch {
        resolve(file);
      }
    });

    img.addEventListener('error', () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    });

    img.src = objectUrl;
  });
