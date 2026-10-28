'use client';

import {
  getHeterogeneousTypeLabel,
  heteroAgentSupportsImageInput,
} from '@lobechat/heterogeneous-agents';
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
 * in the prompt. The gate is the adapter, not a LobeHub model: text-only CLIs
 * (e.g. Cursor) fail the whole run on an image block, so images are refused at
 * pick time for them.
 */
export const useHeteroUpload = (providerType: string | undefined, onPicked: () => void) => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const editor = useChatInputStore((s) => s.editor);
  const upload = useFileStore((s) => s.uploadChatFiles);
  // On desktop, big non-media files become local-path tags the CLI reads in place.
  const routeLargeFilesToLocalPaths = useLargeFileLocalPath(agentId, editor);

  const beforeUpload = useCallback(
    (file: File) => {
      if (file.type.startsWith('image') && !heteroAgentSupportsImageInput(providerType)) {
        toast.error(
          t('upload.validation.heteroImageNotSupported', {
            file: file.name,
            name: getHeterogeneousTypeLabel(providerType),
          }),
        );
        return false;
      }

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
    [providerType, t],
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
