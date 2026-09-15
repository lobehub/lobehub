import { toolsEnv } from '@/envs/tools';

export const getMediaAvailabilityFromFileTypes = (fileTypes: string[]) => ({
  hasAudios: fileTypes.some((fileType) => fileType.startsWith('audio')),
  hasImages: fileTypes.some((fileType) => fileType.startsWith('image')),
  hasVideos: fileTypes.some((fileType) => fileType.startsWith('video')),
});

export interface MediaAvailabilityMessage {
  audioList?: unknown[];
  imageList?: unknown[];
  role?: string;
  videoList?: unknown[];
}

export const getMediaAvailabilityFromMessages = (messages: MediaAvailabilityMessage[]) => ({
  hasAudios: messages.some(
    (message) => message.role === 'user' && (message.audioList?.length ?? 0) > 0,
  ),
  hasImages: messages.some(
    (message) => message.role === 'user' && (message.imageList?.length ?? 0) > 0,
  ),
  hasVideos: messages.some(
    (message) => message.role === 'user' && (message.videoList?.length ?? 0) > 0,
  ),
});

export const isMultimodalUnderstandingConfigured = () => {
  try {
    return (
      !!toolsEnv.MULTIMODAL_UNDERSTANDING_PROVIDER && !!toolsEnv.MULTIMODAL_UNDERSTANDING_MODEL
    );
  } catch {
    // The env proxy rejects server-only keys in client-like runtimes; treat that as disabled.
    return false;
  }
};
