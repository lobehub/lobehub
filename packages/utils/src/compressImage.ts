export const MAX_IMAGE_SIZE = 1920;
// Anthropic enforces a 5MB cap on the base64-encoded image payload. Base64
// inflates binary by ~4/3, so a 3MB binary file maps to ~4MB base64 — gives
// comfortable headroom under the 5MB ceiling.
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3MB binary → ~4MB base64

export const COMPRESSIBLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// JPEG quality for canvas re-encoding (0.85 balances size and quality)
const JPEG_QUALITY = 0.85;

const compressImage = ({
  img,
  type,
  maxSize = MAX_IMAGE_SIZE,
}: {
  img: HTMLImageElement;
  maxSize?: number;
  type?: string;
}) => {
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

  // Preserve JPEG format with lossy compression to avoid inflating small JPEGs;
  // fall back to PNG for other formats (lossless and universally supported).
  if (type === 'image/jpeg') {
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  }
  return canvas.toDataURL('image/png');
};

export default compressImage;

const dataUrlToFile = (dataUrl: string, name: string): File => {
  // Extract the actual MIME type from the data URL to keep content and type consistent
  const mimeType = dataUrl.split(',')[0].split(':')[1].split(';')[0];
  const binary = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mimeType });
};

export const compressImageFile = (file: File): Promise<File> =>
  new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.addEventListener('load', () => {
      URL.revokeObjectURL(objectUrl);

      // skip if image is small enough in both dimensions and file size
      if (
        img.width <= MAX_IMAGE_SIZE &&
        img.height <= MAX_IMAGE_SIZE &&
        file.size <= MAX_IMAGE_BYTES
      ) {
        resolve(file);
        return;
      }

      // progressively shrink until under 5MB
      let maxSize = MAX_IMAGE_SIZE;
      let result: File;
      do {
        const dataUrl = compressImage({ img, maxSize, type: file.type });
        result = dataUrlToFile(dataUrl, file.name);
        maxSize = Math.round(maxSize * 0.8);
      } while (result.size > MAX_IMAGE_BYTES && maxSize > 100);

      resolve(result);
    });

    img.addEventListener('error', () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    });

    img.src = objectUrl;
  });
