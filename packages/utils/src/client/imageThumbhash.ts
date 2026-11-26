import { rgbaToThumbHash, thumbHashToDataURL } from 'thumbhash';

/** ThumbHash encodes images up to 100px on the longer side. */
const MAX_SIDE = 100;

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCodePoint(...bytes));

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.codePointAt(0)!);

/**
 * Encodes an image — a File or a base64 data URI — as a base64 ThumbHash: a ~25-byte placeholder
 * that a viewer can paint before the image itself has loaded. Resolves to undefined for non-images
 * and for formats the browser cannot decode into a bitmap; callers treat the hash as best-effort.
 */
export const getImageThumbhash = async (source: File | string): Promise<string | undefined> => {
  if (
    typeof source === 'string'
      ? !source.startsWith('data:image/')
      : !source.type.startsWith('image/')
  )
    return undefined;

  try {
    const blob = typeof source === 'string' ? await (await fetch(source)).blob() : source;
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return undefined;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const { data } = context.getImageData(0, 0, width, height);
    return toBase64(rgbaToThumbHash(width, height, data));
  } catch {
    return undefined;
  }
};

/** Decodes a base64 ThumbHash into a PNG data URL, or undefined when the hash is malformed. */
export const thumbhashToDataUrl = (thumbhash: string): string | undefined => {
  try {
    return thumbHashToDataURL(fromBase64(thumbhash));
  } catch {
    return undefined;
  }
};
