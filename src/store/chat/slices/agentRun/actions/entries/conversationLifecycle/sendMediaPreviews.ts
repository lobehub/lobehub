import type { ChatAudioItem, ChatImageItem, ChatVideoItem, UploadFileItem } from '@lobechat/types';

import { rememberLocalImagePreview } from '@/utils/localImagePreview';

export const getSendMediaPreviews = (files: UploadFileItem[] | undefined) => {
  // Construct local media preview for server-mode temporary messages (S3 URL takes priority).
  // Use the captured `files` param (not the global file store) so the optimistic preview
  // also works on the queue-drain path, where chatUploadFileList has already been cleared.
  const filesForPreview = files ?? [];
  const imageFiles = filesForPreview.filter((f) => f.file?.type?.startsWith('image'));
  // The message, optimistic and saved alike, shows these from the local copy (see
  // `localImagePreview`); an upload's id is its server file id once it has finished.
  for (const f of imageFiles) {
    if (f.status === 'success' && f.previewUrl) rememberLocalImagePreview(f.id, f.previewUrl);
  }
  const tempImages: ChatImageItem[] = imageFiles.map((f) => ({
    ...f.dimensions,
    id: f.id,
    url: f.fileUrl || f.base64Url || f.previewUrl || '',
    alt: f.file?.name || f.id,
  }));
  const tempVideos: ChatVideoItem[] = filesForPreview
    .filter((f) => f.file?.type?.startsWith('video'))
    .map((f) => ({
      id: f.id,
      url: f.fileUrl || f.base64Url || f.previewUrl || '',
      alt: f.file?.name || f.id,
    }));
  const tempAudios: ChatAudioItem[] = filesForPreview
    .filter((f) => f.audioMetadata || f.file?.type?.startsWith('audio'))
    .map((f) => ({
      ...f.audioMetadata,
      id: f.id,
      url: f.fileUrl || f.base64Url || f.previewUrl || '',
      alt: f.file?.name || f.id,
    }));
  return { tempAudios, tempImages, tempVideos };
};
