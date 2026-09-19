import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import { inferImageMimeTypeFromBytes } from '@lobechat/utils/imageMimeType';
import { readBlobWithLimit } from '@lobechat/utils/imageToBase64';
import { TRPCError } from '@trpc/server';

export const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024;

const imageExtensions: Record<string, string> = {
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const downloadRemoteImage = async (url: string) => {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid image URL' });
  }

  const response = await ssrfSafeFetch(
    url,
    { signal: AbortSignal.timeout(30_000) },
    { maxContentLength: MAX_REMOTE_IMAGE_BYTES + 1 },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Failed to download image' });
  }

  const blob = await readBlobWithLimit(response, MAX_REMOTE_IMAGE_BYTES);
  const buffer = Buffer.from(await blob.arrayBuffer());
  const mimeType = await inferImageMimeTypeFromBytes(buffer);
  const extension = mimeType && imageExtensions[mimeType];
  if (!mimeType || !extension) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unsupported image content' });
  }

  return { buffer, extension, mimeType };
};
