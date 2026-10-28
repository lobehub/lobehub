'use client';

import { validateVideoFileSize } from '@lobechat/utils/client';
import { toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useLargeFileLocalPath } from '@/features/ChatInput/hooks/useLargeFileLocalPath';
import { useChatInputStore } from '@/features/ChatInput/store';
import { useFileStore } from '@/store/file';

/**
 * File/image picking for the hetero `+` menu.
 *
 * Uploads land in the same chat upload list as the agent composer; the hetero
 * send path forwards images as content blocks and other files as download links
 * in the prompt, so every CLI gets them. There is no model-capability gate: the
 * CLI's model is not a LobeHub model, and every adapter accepts images.
 */
export const useHeteroUpload = (onPicked: () => void) => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const editor = useChatInputStore((s) => s.editor);
  const upload = useFileStore((s) => s.uploadChatFiles);
  // On desktop, big non-media files become local-path tags the CLI reads in place.
  const routeLargeFilesToLocalPaths = useLargeFileLocalPath(agentId, editor);

  const beforeUpload = useCallback(
    (file: File) => {
      const validation = validateVideoFileSize(file);
      if (validation.isValid) return true;

      toast.error(
        t('upload.validation.videoSizeExceeded', {
          actualSize: validation.actualSize,
          maxSize: validation.maxSize,
        }),
      );
      return false;
    },
    [t],
  );

  const onFiles = useCallback(
    async (files: File[]) => {
      onPicked();
      editor?.focus();
      const filesToUpload = routeLargeFilesToLocalPaths(files);
      if (filesToUpload.length > 0) await upload(filesToUpload, agentId);
    },
    [onPicked, editor, routeLargeFilesToLocalPaths, upload, agentId],
  );

  return { beforeUpload, onFiles };
};
