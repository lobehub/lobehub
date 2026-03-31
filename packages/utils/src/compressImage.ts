export const MAX_IMAGE_SIZE = 1920;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

export const COMPRESSIBLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

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

  return canvas.toDataURL(type);
};

export default compressImage;

const dataUrlToFile = (dataUrl: string, name: string): File => {
  const binary = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: 'image/png' });
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
        const dataUrl = compressImage({ img, maxSize });
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
