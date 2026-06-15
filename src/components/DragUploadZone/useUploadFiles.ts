import { useCallback } from 'react';

import { usePermission } from '@/hooks/usePermission';
import { useVisualMediaUploadAbility } from '@/hooks/useVisualMediaUploadAbility';
import { useFileStore } from '@/store/file';

interface UseUploadFilesOptions {
  /** The conversation's agent id. Decides whether the chat-only file-type whitelist applies. */
  agentId: string;
  model?: string;
  provider?: string;
}

/**
 * Hook to handle file uploads with visual media support filtering.
 * Filters out image/video files if the model cannot receive them directly or via fallback.
 *
 * @param options - The agent id (for upload validation scope) plus model/provider for vision support
 * @returns handleUploadFiles - Callback to handle file uploads
 */
export const useUploadFiles = (options: UseUploadFilesOptions) => {
  const { agentId, model = '', provider = '' } = options;

  const { canUploadImage, canUploadVideo } = useVisualMediaUploadAbility(model, provider);
  const uploadFiles = useFileStore((s) => s.uploadChatFiles);
  const { allowed: canUpload } = usePermission('create_content');

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      if (!canUpload) return;

      // Filter out visual files if the model cannot receive them directly or via fallback.
      const filteredFiles = files.filter((file) => {
        if (file.type.startsWith('image')) return canUploadImage;
        if (file.type.startsWith('video')) return canUploadVideo;
        return true;
      });

      if (filteredFiles.length > 0) {
        uploadFiles(filteredFiles, agentId);
      }
    },
    [agentId, canUpload, canUploadImage, canUploadVideo, uploadFiles],
  );

  return { canUploadImage, canUploadVideo, handleUploadFiles };
};
