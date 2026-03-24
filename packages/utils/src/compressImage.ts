const MAX_IMAGE_SIZE = 1920;

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
