import { useCallback } from 'react';

import { useFileStore } from '@/store/file';
import type { FileUploadState, FileUploadStatus } from '@/types/files/upload';

import { registerAttachment } from './attachmentRegistry';

export type EditorAttachmentUploadProgress = (
  status: FileUploadStatus,
  uploadState?: FileUploadState,
) => void;

export type EditorAttachmentUpload = (
  file: File,
  onProgress?: EditorAttachmentUploadProgress,
) => Promise<{ url: string }>;

/**
 * Upload handler compatible with `@lobehub/editor`'s `ReactImagePlugin` /
 * `ReactFilePlugin` `handleUpload` signature. Side effect: registers the
 * resulting `url → fileId` pair so callers can recover fileIds from the
 * editor state later (see `attachmentRegistry`).
 */
const useEditorAttachmentUpload = (skipCheckFileType: boolean) => {
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);

  return useCallback(
    async (file: File, onProgress?: EditorAttachmentUploadProgress): Promise<{ url: string }> => {
      const result = await uploadWithProgress({
        file,
        onStatusUpdate: (data) => {
          if (data.type !== 'updateFile' || !data.value.status) return;
          onProgress?.(data.value.status, data.value.uploadState);
        },
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
