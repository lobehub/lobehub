import type { ChatAudioItem, ChatImageItem, ChatVideoItem } from '@lobechat/types';

import type { UploadFileItem } from '@/types/files/upload';
import { rememberLocalImagePreview } from '@/utils/localImagePreview';

export const getOptimisticMessageMedia = (files: UploadFileItem[] = []) => {
  const urlOf = (file: UploadFileItem) => file.fileUrl || file.base64Url || file.previewUrl || '';
  const imageFiles = files.filter((file) => file.file?.type?.startsWith('image'));
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
  const videoList: ChatVideoItem[] = files
    .filter((file) => file.file?.type?.startsWith('video'))
    .map((file) => ({ alt: file.file?.name || file.id, id: file.id, url: urlOf(file) }));
  const audioList: ChatAudioItem[] = files
    .filter((file) => file.audioMetadata || file.file?.type?.startsWith('audio'))
    .map((file) => ({
      ...file.audioMetadata,
      alt: file.file?.name || file.id,
      id: file.id,
      url: urlOf(file),
    }));

  return {
    audioList: audioList.length > 0 ? audioList : undefined,
    imageList: imageList.length > 0 ? imageList : undefined,
    videoList: videoList.length > 0 ? videoList : undefined,
  };
};
