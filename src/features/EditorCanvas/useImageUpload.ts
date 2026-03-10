import { useCallback } from 'react';

import { useFileStore } from '@/store/file';

/**
 * Shared hook for editor image upload.
 * Returns a handler compatible with ReactImagePlugin's `handleUpload` signature.
 */
export const useImageUpload = () => {
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);

  return useCallback(
    async (file: File): Promise<{ url: string }> => {
      try {
        const result = await uploadWithProgress({
          file,
          skipCheckFileType: false,
          source: 'page-editor',
        });
        if (!result) throw new Error('Upload returned empty result');
        return { url: result.url };
      } catch (error) {
        throw new Error('Image upload failed', { cause: error });
      }
    },
    [uploadWithProgress],
  );
};
