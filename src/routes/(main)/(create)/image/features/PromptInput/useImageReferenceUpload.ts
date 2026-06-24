'use client';

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { usePermission } from '@/hooks/usePermission';
import type { UploadData } from '@/routes/(main)/(create)/features/GenerationInput/UploadCard';
import {
  type ReferenceUploadSlot,
  useReferenceImageUpload,
} from '@/routes/(main)/(create)/features/GenerationInput/useReferenceImageUpload';
import { useAutoDimensions } from '@/routes/(main)/(create)/image/features/ConfigPanel';
import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';
import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';

const isSupportedParamSelector = imageGenerationConfigSelectors.isSupportedParam;

/**
 * Image-page binding for the shared {@link useReferenceImageUpload} core.
 *
 * Describes the image model's reference slots (`imageUrl` then `imageUrls`),
 * wires the store-backed in-flight preview state, and auto-sets dimensions from
 * the first dropped image. Also keeps the single add/remove handlers used by the
 * inline reference cards.
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

  const uploadingPreviews = useImageStore(imageGenerationConfigSelectors.uploadingImagePreviews);
  const addUploadingImagePreviews = useImageStore((s) => s.addUploadingImagePreviews);
  const removeUploadingImagePreviews = useImageStore((s) => s.removeUploadingImagePreviews);

  const slots = useMemo<ReferenceUploadSlot[]>(() => {
    const readParams = () => imageGenerationConfigSelectors.parameters(useImageStore.getState());
    const list: ReferenceUploadSlot[] = [];
    if (isSupportImageUrl) {
      list.push({
        capacity: 1,
        getCurrentValues: () => {
          const v = readParams()?.imageUrl;
          return v ? [v] : [];
        },
        set: (urls) => setImageUrl((urls[0] ?? null) as any),
        values: imageUrl ? [imageUrl] : [],
      });
    }
    if (isSupportImageUrls) {
      list.push({
        capacity: imageUrlsMaxCount ?? 4,
        getCurrentValues: () => {
          const v = readParams()?.imageUrls;
          return Array.isArray(v) ? v : [];
        },
        set: (urls) => setImageUrls(urls as any),
        values: imageUrls ?? [],
      });
    }
    return list;
  }, [
    isSupportImageUrl,
    isSupportImageUrls,
    imageUrl,
    imageUrls,
    imageUrlsMaxCount,
    setImageUrl,
    setImageUrls,
  ]);

  const onLimitExceeded = useCallback(
    (maxCount: number) => {
      message.warning(t('config.imageUpload.maxCountReached', { count: maxCount }));
    },
    [t],
  );

  const { canDropImage, handleUploadFiles, imagePreviewUrls, maxCount, maxFileSize } =
    useReferenceImageUpload({
      addUploadingPreviews: addUploadingImagePreviews,
      canCreate,
      maxFileSize: imageUrlsMaxFileSize ?? imageUrlMaxFileSize,
      onFirstDimensions: autoSetDimensions,
      onLimitExceeded,
      removeUploadingPreviews: removeUploadingImagePreviews,
      slots,
      uploadingPreviews,
    });

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
