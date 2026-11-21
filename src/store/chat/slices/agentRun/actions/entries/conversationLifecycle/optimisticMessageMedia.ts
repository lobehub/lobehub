import type { ChatAudioItem, ChatFileItem, ChatImageItem, ChatVideoItem } from '@lobechat/types';

import { isSizeUnknownPlaceholder } from '@/store/chat/slices/operation/types';
import type { UploadFileItem } from '@/types/files/upload';
import { rememberLocalImagePreview } from '@/utils/localImagePreview';

/**
 * Image formats the server renders as images (`groupMessageFilesByKind` in
 * `packages/database/src/models/message/attachments.ts`). Any other `image/*`
 * upload (SVG, TIFF, a CAD drawing) comes back as a file card, so the
 * optimistic bubble shows it as one too and nothing moves once the persisted
 * message replaces it.
 */
const MESSAGE_IMAGE_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

/** The type the upload was stored with, else the browser's. */
const fileTypeOf = (file: UploadFileItem) => file.fileType || file.file?.type || '';

const mimeTypeOf = (file: UploadFileItem) => fileTypeOf(file).split(';')[0].trim().toLowerCase();

type MediaKind = 'audio' | 'file' | 'image' | 'video';

const kindOf = (file: UploadFileItem): MediaKind => {
  // A voice recording is an audio message whatever container type it was saved in.
  if (file.audioMetadata) return 'audio';
  const mimeType = mimeTypeOf(file);
  if (MESSAGE_IMAGE_MIME_TYPES.has(mimeType)) return 'image';
  if (mimeType.startsWith('video')) return 'video';
  if (mimeType.startsWith('audio')) return 'audio';
  return 'file';
};

/**
 * The attachments an optimistic user message renders with, built from what the
 * composer already holds (name, size, type, local preview). Grouped and ordered
 * the way the server returns them, so the sent bubble shows every attachment
 * from the first paint and keeps them in place when the persisted row lands.
 */
export const getOptimisticMessageMedia = (files: UploadFileItem[] = []) => {
  const urlOf = (file: UploadFileItem) => file.fileUrl || file.base64Url || file.previewUrl || '';
  const byKind = (kind: MediaKind) => files.filter((file) => kindOf(file) === kind);

  const imageFiles = byKind('image');
  // Persisted images also use the local copy while the remote URL loads.
  for (const file of imageFiles) {
    if (file.status === 'success' && file.previewUrl)
      rememberLocalImagePreview(file.id, file.previewUrl);
  }
  const imageList: ChatImageItem[] = imageFiles.map((file) => ({
    ...file.dimensions,
    alt: file.file?.name || file.id,
    id: file.id,
    url: urlOf(file),
  }));
  const videoList: ChatVideoItem[] = byKind('video').map((file) => ({
    alt: file.file?.name || file.id,
    id: file.id,
    url: urlOf(file),
  }));
  const audioList: ChatAudioItem[] = byKind('audio').map((file) => ({
    ...file.audioMetadata,
    alt: file.file?.name || file.id,
    id: file.id,
    url: urlOf(file),
  }));
  // An id-only entry, or a queued one saved without its size by an older client,
  // has no name or size to show; the persisted message brings its card.
  const fileList: ChatFileItem[] = byKind('file')
    .filter((file) => !!file.file && !isSizeUnknownPlaceholder(file.file))
    .map((file) => ({
      fileType: fileTypeOf(file),
      id: file.id,
      name: file.file.name,
      size: file.file.size,
      url: urlOf(file),
    }));

  return {
    audioList: audioList.length > 0 ? audioList : undefined,
    fileList: fileList.length > 0 ? fileList : undefined,
    imageList: imageList.length > 0 ? imageList : undefined,
    videoList: videoList.length > 0 ? videoList : undefined,
  };
};
