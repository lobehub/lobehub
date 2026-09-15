export type MessengerAttachmentType = 'image' | 'file' | 'video' | 'audio';

const IMAGE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'heic',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
]);
const VIDEO_EXTENSIONS = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'webm']);
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'opus', 'wav']);

/**
 * Map a file to the messenger attachment type the platform senders expect.
 * `fileType` on a resource row is usually a MIME type (`application/pdf`,
 * `image/png`, …) but legacy rows may carry a bare extension, so the MIME
 * prefix, the raw value, and the filename extension are all consulted;
 * anything unknown is a generic document.
 */
export const resolveAttachmentType = (
  filename: string,
  fileType?: string,
): MessengerAttachmentType => {
  const mime = fileType?.toLowerCase();
  if (mime?.startsWith('image/')) return 'image';
  if (mime?.startsWith('video/')) return 'video';
  if (mime?.startsWith('audio/')) return 'audio';

  // `split('.').pop()` returns the whole string when there is no dot, which
  // would read an extension-less file named e.g. `png` as an image — only take
  // the tail when the name actually carries an extension.
  const dot = filename.lastIndexOf('.');
  const extension = dot > 0 ? filename.slice(dot + 1).toLowerCase() : undefined;

  const candidates = [mime, extension].filter(Boolean) as string[];
  for (const ext of candidates) {
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    if (VIDEO_EXTENSIONS.has(ext)) return 'video';
    if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  }
  return 'file';
};
