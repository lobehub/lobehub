import { formatSize } from '../format';

/**
 * Upload ceiling for a video attachment, not the provider's inline limit.
 *
 * Do not lower this to match a provider: a video above the inline limit is
 * still usable, because the send path downgrades it to a media ref and the
 * media-analysis tool fetches it instead (see INLINE_VIDEO_SIZE_LIMIT in
 * `@lobechat/const/media`). Rejecting the upload here would take that away.
 */
const VIDEO_SIZE_LIMIT = 100 * 1024 * 1024; // 100MB in bytes

export interface VideoValidationResult {
  actualSize?: string;
  isValid: boolean;
  maxSize?: string;
}

export const validateVideoFileSize = (file: File): VideoValidationResult => {
  if (!file.type.startsWith('video/')) {
    return { isValid: true };
  }

  const isValid = file.size <= VIDEO_SIZE_LIMIT;

  return {
    actualSize: formatSize(file.size),
    isValid,
    maxSize: formatSize(VIDEO_SIZE_LIMIT),
  };
};
