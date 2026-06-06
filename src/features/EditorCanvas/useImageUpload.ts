import { useCallback } from 'react';

import { useFileStore } from '@/store/file';

import { registerAttachment } from './attachmentRegistry';

/**
 * Upload handler compatible with `@lobehub/editor`'s `ReactImagePlugin` /
 * `ReactFilePlugin` `handleUpload` signature. Side effect: registers the
 * resulting `url → fileId` pair so callers can recover fileIds from the
 * editor state later (see `attachmentRegistry`).
 */
const useEditorAttachmentUpload = (skipCheckFileType: boolean) => {
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);

  return useCallback(
    async (file: File): Promise<{ url: string }> => {
      const result = await uploadWithProgress({
        file,
        skipCheckFileType,
        source: 'page-editor',
      });
      if (!result) throw new Error('Upload returned empty result');
      registerAttachment(result.url, result.id);
      return { url: result.url };
    },
    [uploadWithProgress, skipCheckFileType],
  );
};

export const useImageUpload = () => useEditorAttachmentUpload(false);
export const useFileUpload = () => useEditorAttachmentUpload(true);
