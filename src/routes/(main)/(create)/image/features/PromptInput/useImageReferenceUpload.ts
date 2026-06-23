'use client';

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { usePermission } from '@/hooks/usePermission';
import type { UploadData } from '@/routes/(main)/(create)/features/GenerationInput/UploadCard';
import { useAutoDimensions } from '@/routes/(main)/(create)/image/features/ConfigPanel';
import { useFileStore } from '@/store/file';
import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';
import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';

const isSupportedParamSelector = imageGenerationConfigSelectors.isSupportedParam;

/**
 * Shared image reference upload logic for the image creation page.
 *
 * Centralizes "which params the model supports", the derived upload limits, and
 * the add/remove/batch-upload handlers so both the inline reference cards
 * (PromptInput) and the page-level drag-and-drop zone stay in sync.
 *
 * `handleUploadFiles` lands all dropped files in a single state update to avoid
 * the stale-closure race that calling `handleAddImage` in a loop would cause.
 */
export const useImageReferenceUpload = () => {
  const { t } = useTranslation('image');
  const { allowed: canCreate } = usePermission('create_content');

  const isSupportImageUrl = useImageStore(isSupportedParamSelector('imageUrl'));
  const isSupportImageUrls = useImageStore(isSupportedParamSelector('imageUrls'));

  const {
    value: imageUrl,
    setValue: setImageUrl,
    maxFileSize: imageUrlMaxFileSize,
  } = useGenerationConfigParam('imageUrl');
  const {
    value: imageUrls,
    setValue: setImageUrls,
    maxCount: imageUrlsMaxCount,
    maxFileSize: imageUrlsMaxFileSize,
  } = useGenerationConfigParam('imageUrls');

  const { autoSetDimensions, extractUrlAndDimensions } = useAutoDimensions();
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);

  // Object-URL previews shown with a spinner while a batch upload is in flight,
  // so dropped images appear instantly instead of only on completion. Kept in
  // the store so the inline cards and the page-level drag zone (two separate
  // hook instances) reflect the same in-flight uploads.
  const uploadingPreviews = useImageStore(imageGenerationConfigSelectors.uploadingImagePreviews);
  const addUploadingImagePreviews = useImageStore((s) => s.addUploadingImagePreviews);
  const removeUploadingImagePreviews = useImageStore((s) => s.removeUploadingImagePreviews);

  /** Whether the current model accepts any reference image at all. */
  const canDropImage = isSupportImageUrl || isSupportImageUrls;

  const maxFileSize = imageUrlsMaxFileSize ?? imageUrlMaxFileSize;

  const maxCount = useMemo(() => {
    let count = 0;
    if (isSupportImageUrl) count += 1;
    if (isSupportImageUrls) count += imageUrlsMaxCount ?? 4;
    return count;
  }, [isSupportImageUrl, isSupportImageUrls, imageUrlsMaxCount]);

  const imagePreviewUrls = useMemo(
    () => [imageUrl, ...(imageUrls ?? [])].filter(Boolean) as string[],
    [imageUrl, imageUrls],
  );

  const handleAddImage = useCallback(
    (data: UploadData) => {
      if (!canCreate) return;

      const { url, dimensions } = extractUrlAndDimensions(data);
      if (!url) return;

      if (dimensions) {
        autoSetDimensions(dimensions);
      }

      if (isSupportImageUrl && !imageUrl) {
        setImageUrl(url);
      } else if (isSupportImageUrls) {
        setImageUrls([...(imageUrls ?? []), url] as any);
      } else if (isSupportImageUrl) {
        setImageUrl(url);
      }
    },
    [
      isSupportImageUrl,
      isSupportImageUrls,
      imageUrl,
      imageUrls,
      setImageUrl,
      setImageUrls,
      autoSetDimensions,
      extractUrlAndDimensions,
      canCreate,
    ],
  );

  const handleRemoveImage = useCallback(
    (url: string) => {
      if (!canCreate) return;

      if (url === imageUrl) {
        setImageUrl(null);
      } else {
        setImageUrls((imageUrls ?? []).filter((item) => item !== url) as any);
      }
    },
    [canCreate, imageUrl, imageUrls, setImageUrl, setImageUrls],
  );

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      if (!canCreate) return;

      const imageFiles = files.filter((file) => file.type.startsWith('image/'));
      if (imageFiles.length === 0) return;

      // Account for both landed images and any in-flight uploads.
      const remaining = maxCount - imagePreviewUrls.length - uploadingPreviews.length;
      if (remaining <= 0) {
        message.warning(t('config.imageUpload.maxCountReached', { count: maxCount }));
        return;
      }

      // Only take as many as the model still has room for, and warn when truncating.
      const accepted = imageFiles.slice(0, remaining);
      if (imageFiles.length > remaining) {
        message.warning(t('config.imageUpload.maxCountReached', { count: maxCount }));
      }

      // Show instant local previews (with spinner) for the whole batch.
      const previews = accepted.map((file) => URL.createObjectURL(file));
      addUploadingImagePreviews(previews);

      try {
        const results = await Promise.all(
          accepted.map(async (file): Promise<UploadData | null> => {
            if (maxFileSize && file.size > maxFileSize) return null;

            const result = await uploadWithProgress({
              file,
              onStatusUpdate: () => {},
              skipCheckFileType: true,
            });

            if (!result?.url) return null;
            return result.dimensions
              ? { dimensions: result.dimensions, url: result.url }
              : result.url;
          }),
        );

        // Land all uploads in one state update to avoid a stale-closure race.
        let nextImageUrl = imageUrl;
        const nextImageUrls = [...(imageUrls ?? [])];
        let firstDimensions: { height: number; width: number } | undefined;

        for (const data of results) {
          if (!data) continue;
          const { url, dimensions } = extractUrlAndDimensions(data);
          if (!url) continue;

          if (!firstDimensions && dimensions) firstDimensions = dimensions;

          if (isSupportImageUrl && !nextImageUrl) nextImageUrl = url;
          else if (isSupportImageUrls) nextImageUrls.push(url);
          else if (isSupportImageUrl) nextImageUrl = url;
        }

        if (firstDimensions) autoSetDimensions(firstDimensions);
        if (nextImageUrl !== imageUrl) setImageUrl(nextImageUrl as any);
        if (nextImageUrls.length !== (imageUrls?.length ?? 0)) setImageUrls(nextImageUrls as any);
      } finally {
        // Drop this batch's placeholders, then release the object URLs.
        removeUploadingImagePreviews(previews);
        previews.forEach((url) => URL.revokeObjectURL(url));
      }
    },
    [
      canCreate,
      maxCount,
      maxFileSize,
      imagePreviewUrls,
      uploadingPreviews,
      imageUrl,
      imageUrls,
      isSupportImageUrl,
      isSupportImageUrls,
      setImageUrl,
      setImageUrls,
      uploadWithProgress,
      addUploadingImagePreviews,
      removeUploadingImagePreviews,
      autoSetDimensions,
      extractUrlAndDimensions,
      t,
    ],
  );

  return {
    canDropImage,
    handleAddImage,
    handleRemoveImage,
    handleUploadFiles,
    imagePreviewUrls,
    maxCount,
    maxFileSize,
    uploadingPreviews,
  };
};
