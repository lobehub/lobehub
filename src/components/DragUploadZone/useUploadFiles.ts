import { toast } from '@lobehub/ui/base-ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useMediaUploadAbility } from '@/hooks/useMediaUploadAbility';
import { usePermission } from '@/hooks/usePermission';
import { useFileStore } from '@/store/file';

interface UseUploadFilesOptions {
  /** The conversation's agent id. Decides whether the chat-only file-type whitelist applies. */
  agentId: string;
  model?: string;
  provider?: string;
}

interface MediaUploadAbilityFlags {
  canUploadAudio: boolean;
  canUploadImage: boolean;
  canUploadVideo: boolean;
}

interface PartitionedMediaFiles {
  accepted: File[];
  rejected: File[];
}

/**
 * Split files into uploadable ones and media the model cannot receive directly
 * or via the multimodal-understanding fallback. Non-media files always pass.
 */
export const partitionFilesByMediaAbility = (
  files: File[],
  { canUploadAudio, canUploadImage, canUploadVideo }: MediaUploadAbilityFlags,
): PartitionedMediaFiles => {
  const accepted: File[] = [];
  const rejected: File[] = [];

  for (const file of files) {
    const allowed = file.type.startsWith('image')
      ? canUploadImage
      : file.type.startsWith('video')
        ? canUploadVideo
        : file.type.startsWith('audio')
          ? canUploadAudio
          : true;
    (allowed ? accepted : rejected).push(file);
  }

  return { accepted, rejected };
};

/**
 * Hook to handle file uploads with multimodal media support filtering.
 * Filters out image/video files if the model cannot receive them directly or via fallback.
 *
 * @param options - The agent id (for upload validation scope) plus model/provider for vision support
 * @returns handleUploadFiles - Callback to handle file uploads
 */
export const useUploadFiles = (options: UseUploadFilesOptions) => {
  const { agentId, model = '', provider = '' } = options;
  const { t } = useTranslation('chat');

  const { canUploadImage, canUploadVideo, canUploadAudio } = useMediaUploadAbility(
    model,
    provider,
    agentId,
  );
  const uploadFiles = useFileStore((s) => s.uploadChatFiles);
  const { allowed: canUpload } = usePermission('create_content');

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      if (!canUpload) return;

      // Filter out media files if the model cannot receive them directly or via fallback.
      const { accepted, rejected } = partitionFilesByMediaAbility(files, {
        canUploadAudio,
        canUploadImage,
        canUploadVideo,
      });

      // Dropping a pasted/dragged file with no feedback reads as "the app ate
      // my file" — surface which ones the model cannot receive.
      if (rejected.length > 0) {
        toast.warning(
          t('upload.validation.mediaNotSupported', {
            files: rejected.map((file) => file.name).join(', '),
          }),
        );
      }

      if (accepted.length > 0) {
        uploadFiles(accepted, agentId);
      }
    },
    [agentId, canUpload, canUploadImage, canUploadVideo, canUploadAudio, t, uploadFiles],
  );

  return { canUploadImage, canUploadVideo, canUploadAudio, handleUploadFiles };
};
