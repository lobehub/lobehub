import mime from 'mime';

import { decryptWeComMedia } from './crypto';
import type { WeComMedia, WeComMessageBody } from './types';

export type WeComMediaKind = 'file' | 'image' | 'video';

export interface WeComMediaRef extends WeComMedia {
  kind: WeComMediaKind;
}

export interface DownloadedWeComMedia {
  buffer: Buffer;
  mimeType: string;
  name?: string;
}

/** Every downloadable media item on a message (quoted messages' media is not collected). */
export const collectWeComMedia = (body: WeComMessageBody): WeComMediaRef[] => {
  const refs: WeComMediaRef[] = [];
  const add = (kind: WeComMediaKind, media?: WeComMedia) => {
    if (media?.url) refs.push({ ...media, kind });
  };

  add('image', body.image);
  add('file', body.file);
  add('video', body.video);
  for (const item of body.mixed?.msg_item ?? []) {
    if (item.msgtype === 'image') add('image', item.image);
  }
  return refs;
};

const sniffImageMime = (buffer: Buffer): string => {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  return 'image/jpeg';
};

const filenameFromDisposition = (header: string | null): string | undefined => {
  if (!header) return undefined;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replaceAll('"', ''));
    } catch {
      // fall through to the plain form
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim();
};

/**
 * Download one media item and decrypt it. The URL expires 5 minutes after the message arrives,
 * so this must run while the message is being handled, not later from a replay.
 */
export const downloadWeComMedia = async (
  ref: WeComMediaRef,
  fetchImpl: typeof fetch = fetch,
): Promise<DownloadedWeComMedia> => {
  const res = await fetchImpl(ref.url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`WeCom media download failed: ${res.status}`);

  const raw = Buffer.from(await res.arrayBuffer());
  const buffer = ref.aeskey ? decryptWeComMedia(raw, ref.aeskey) : raw;
  const name = filenameFromDisposition(res.headers.get('content-disposition'));

  let mimeType: string;
  if (ref.kind === 'image') mimeType = sniffImageMime(buffer);
  else if (ref.kind === 'video') mimeType = (name && mime.getType(name)) || 'video/mp4';
  else mimeType = (name && mime.getType(name)) || 'application/octet-stream';

  return { buffer, mimeType, name };
};
