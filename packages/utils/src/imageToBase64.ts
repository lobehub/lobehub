import { Buffer } from 'buffer.js';

import { resolveMimeTypeFromBytes } from './imageMimeType';

export const imageToBase64 = ({
  size,
  img,
  type = 'image/webp',
}: {
  img: HTMLImageElement;
  size: number;
  type?: string;
}) => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  let startX = 0;
  let startY = 0;

  if (img.width > img.height) {
    startX = (img.width - img.height) / 2;
  } else {
    startY = (img.height - img.width) / 2;
  }

  canvas.width = size;
  canvas.height = size;

  ctx.drawImage(
    img,
    startX,
    startY,
    Math.min(img.width, img.height),
    Math.min(img.width, img.height),
    0,
    0,
    size,
    size,
  );

  return canvas.toDataURL(type);
};

export interface ImageUrlToBase64Options {
  /** Abort the download once the response exceeds this many bytes. */
  maxBytes?: number;
}

const sizeLimitError = (maxBytes: number) =>
  new RangeError(`Remote binary exceeds the ${maxBytes}-byte download limit`);

const readBlobWithLimit = async (response: Response, maxBytes: number): Promise<Blob> => {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw sizeLimitError(maxBytes);
  }

  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > maxBytes) throw sizeLimitError(maxBytes);
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      await reader.cancel();
      throw sizeLimitError(maxBytes);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Blob([bytes], { type: response.headers.get('content-type') || '' });
};

/**
 * Convert image URL to base64
 * Uses SSRF-safe fetch on server-side to prevent SSRF attacks
 */
export const imageUrlToBase64 = async (
  imageUrl: string,
  options: ImageUrlToBase64Options = {},
): Promise<{ base64: string; mimeType: string }> => {
  try {
    const isServer = typeof window === 'undefined';

    // Use SSRF-safe fetch on server-side to prevent SSRF attacks
    const res = isServer
      ? await import('@lobechat/ssrf-safe-fetch').then((m) => m.ssrfSafeFetch(imageUrl))
      : await fetch(imageUrl);

    const blob = options.maxBytes
      ? await readBlobWithLimit(res, options.maxBytes)
      : await res.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const mimeType = await resolveMimeTypeFromBytes(blob.type, arrayBuffer);

    // Client-side uses btoa, server-side uses Buffer
    const base64 = isServer
      ? Buffer.from(arrayBuffer).toString('base64')
      : btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
        );

    return { base64, mimeType };
  } catch (error) {
    console.error('Error converting image to base64:', error);
    throw error;
  }
};
