import { useCallback } from 'react';

import { useModelSupportVision } from '@/hooks/useModelSupportVision';
import { useFileStore } from '@/store/file';

interface UseUploadFilesOptions {
  model?: string;
  provider?: string;
}

/**
 * Hook to handle file uploads with vision support filtering.
 * Filters out image files if the model does not support vision.
 *
 * @param options - The model and provider to check for vision support
 * @returns handleUploadFiles - Callback to handle file uploads
 */
export const useUploadFiles = (options: UseUploadFilesOptions = {}) => {
  const { model = '', provider = '' } = options;

  const canUploadImage = useModelSupportVision(model, provider);
  const uploadFiles = useFileStore((s) => s.uploadChatFiles);

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      // Filter out image files if the model does not support vision
      const filteredFiles = files.filter((file) => {
        if (canUploadImage) return true;
        return !file.type.startsWith('image');
      });

      if (filteredFiles.length > 0) {
        uploadFiles(filteredFiles);
      }
    },
    [canUploadImage, uploadFiles],
  );

  return { canUploadImage, handleUploadFiles };
};
