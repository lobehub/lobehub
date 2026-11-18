'use client';

import { useCallback } from 'react';

import { useFileStore } from '@/store/file';

import { useChatInputStore } from '../store';

/**
 * Key of this composer's upload list. Uploads are kept per conversation, like
 * the text draft, so switching conversations never carries them along.
 */
export const useChatInputUploadKey = () =>
  useChatInputStore((s) => s.uploadContextKey ?? s.contextSelectionKey);

/**
 * Upload into this composer's own attachment list. A composer without a key
 * has nowhere to show the files, so the upload is skipped.
 */
export const useChatInputUpload = () => {
  const contextKey = useChatInputUploadKey();
  const uploadChatFiles = useFileStore((s) => s.uploadChatFiles);

  return useCallback(
    async (files: File[], agentId: string) => {
      if (!contextKey) return;
      await uploadChatFiles(contextKey, files, agentId);
    },
    [contextKey, uploadChatFiles],
  );
};
