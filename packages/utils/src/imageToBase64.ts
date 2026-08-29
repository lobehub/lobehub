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
  /** Abort the download when the caller's deadline or cancellation fires. */
  signal?: AbortSignal;
}

const sizeLimitError = (maxBytes: number) =>
  new RangeError(`Remote binary exceeds the ${maxBytes}-byte download limit`);

/**
 * Apply the byte ceiling at the SSRF fetch boundary before its server adapter buffers the body.
 * The adapter uses a soft truncation cap, so one extra byte lets the outer reader detect overflow.
 */
const fetchServerBinary = async (
  imageUrl: string,
  { maxBytes, signal }: ImageUrlToBase64Options,
) => {
  const { ssrfSafeFetch } = await import('@lobechat/ssrf-safe-fetch');
  const requestOptions = signal ? { signal } : undefined;

  return maxBytes
    ? ssrfSafeFetch(imageUrl, requestOptions, { maxContentLength: maxBytes + 1 })
    : ssrfSafeFetch(imageUrl, requestOptions);
};

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
      ? await fetchServerBinary(imageUrl, options)
      : options.signal
        ? await fetch(imageUrl, { signal: options.signal })
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
    /** Raw fetch errors can contain presigned URL query credentials. */
    console.error('Error converting image to base64:', {
      name: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }
};
