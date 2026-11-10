import type { ChatAudioItem, ChatImageItem, ChatVideoItem, UploadFileItem } from '@lobechat/types';

/**
 * Local bytes first: the blob/base64 preview is already in memory, while the
 * uploaded URL has to be downloaded again before the image can paint.
 */
const localFirstUrl = (f: UploadFileItem) => f.previewUrl || f.base64Url || f.fileUrl || '';

/**
 * Build the media lists of the optimistic user message from the attached files.
 * The server-confirmed message keeps the same local copy through
 * `withLocalMediaPreview`, filled when the upload succeeds.
 */
export const buildOptimisticMediaLists = (files: UploadFileItem[]) => {
  const imageList: ChatImageItem[] = files
    .filter((f) => f.file?.type?.startsWith('image'))
    .map((f) => ({ ...f.dimensions, alt: f.file?.name || f.id, id: f.id, url: localFirstUrl(f) }));
  const videoList: ChatVideoItem[] = files
    .filter((f) => f.file?.type?.startsWith('video'))
    .map((f) => ({ alt: f.file?.name || f.id, id: f.id, url: localFirstUrl(f) }));
  const audioList: ChatAudioItem[] = files
    .filter((f) => f.audioMetadata || f.file?.type?.startsWith('audio'))
    .map((f) => ({
      ...f.audioMetadata,
      alt: f.file?.name || f.id,
      id: f.id,
      url: f.fileUrl || f.base64Url || f.previewUrl || '',
    }));

  return { audioList, imageList, videoList };
};
