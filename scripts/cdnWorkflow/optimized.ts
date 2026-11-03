import sharp from 'sharp';

const WIDTH = 1600;

export const opimized = async (
  inputBuffer: ArrayBuffer,
  width: number = WIDTH,
): Promise<Buffer> => {
  return await sharp(inputBuffer)
    .resize({ width: width, withoutEnlargement: true })
    .webp()
    .toBuffer();
};

export const opimizedGif = async (inputBuffer: ArrayBuffer): Promise<Buffer> => {
  try {
    return await sharp(inputBuffer, { animated: true }).webp().toBuffer();
  } catch {
    return await sharp(inputBuffer, { animated: true, limitInputPixels: false }).webp().toBuffer();
  }
};
