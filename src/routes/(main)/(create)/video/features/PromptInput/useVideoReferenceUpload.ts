'use client';

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { usePermission } from '@/hooks/usePermission';
import {
  type ReferenceUploadSlot,
  useReferenceImageUpload,
} from '@/routes/(main)/(create)/features/GenerationInput/useReferenceImageUpload';
import { useVideoStore } from '@/store/video';
import { videoGenerationConfigSelectors } from '@/store/video/selectors';
import { useVideoGenerationConfigParam } from '@/store/video/slices/generationConfig/hooks';

const isSupportedParamSelector = videoGenerationConfigSelectors.isSupportedParam;

/**
 * Video-page binding for the shared {@link useReferenceImageUpload} core.
 *
 * Describes the video model's reference slots by priority — start frame
 * (`imageUrl`) → reference array (`imageUrls`) → end frame (`endImageUrl`) — so a
 * drop fills them in order. Single-image models accept one; first/end-frame
 * models map a 2-image drop to start + end (the end frame's `requiresImageUrl`
 * is satisfied because the start frame slot fills first).
 */
export const useVideoReferenceUpload = () => {
  const { t } = useTranslation('video');
  const { allowed: canCreate } = usePermission('create_content');

  const isSupportImageUrl = useVideoStore(isSupportedParamSelector('imageUrl'));
  const isSupportImageUrls = useVideoStore(isSupportedParamSelector('imageUrls'));
  const isSupportEndImageUrl = useVideoStore(isSupportedParamSelector('endImageUrl'));

  const {
    value: imageUrl,
    setValue: setImageUrl,
    maxFileSize: imageUrlMaxFileSize,
  } = useVideoGenerationConfigParam('imageUrl');
  const {
    value: imageUrls,
    setValue: setImageUrls,
    maxCount: imageUrlsMaxCount,
    maxFileSize: imageUrlsMaxFileSize,
  } = useVideoGenerationConfigParam('imageUrls');
  const {
    value: endImageUrl,
    setValue: setEndImageUrl,
    maxFileSize: endImageUrlMaxFileSize,
  } = useVideoGenerationConfigParam('endImageUrl');

  const uploadingPreviews = useVideoStore(videoGenerationConfigSelectors.uploadingImagePreviews);
  const addUploadingImagePreviews = useVideoStore((s) => s.addUploadingImagePreviews);
  const removeUploadingImagePreviews = useVideoStore((s) => s.removeUploadingImagePreviews);

  const slots = useMemo<ReferenceUploadSlot[]>(() => {
    const readParams = () => videoGenerationConfigSelectors.parameters(useVideoStore.getState());
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
    if (isSupportEndImageUrl) {
      list.push({
        capacity: 1,
        getCurrentValues: () => {
          const v = readParams()?.endImageUrl;
          return v ? [v] : [];
        },
        set: (urls) => setEndImageUrl((urls[0] ?? null) as any),
        values: endImageUrl ? [endImageUrl] : [],
      });
    }
    return list;
  }, [
    isSupportImageUrl,
    isSupportImageUrls,
    isSupportEndImageUrl,
    imageUrl,
    imageUrls,
    endImageUrl,
    imageUrlsMaxCount,
    setImageUrl,
    setImageUrls,
    setEndImageUrl,
  ]);

  const onLimitExceeded = useCallback(
    (maxCount: number) => {
      message.warning(t('config.imageUpload.maxCountReached', { count: maxCount }));
    },
    [t],
  );

  const { canDropImage, handleUploadFiles, maxCount, maxFileSize } = useReferenceImageUpload({
    addUploadingPreviews: addUploadingImagePreviews,
    canCreate,
    maxFileSize: imageUrlsMaxFileSize ?? imageUrlMaxFileSize ?? endImageUrlMaxFileSize,
    onLimitExceeded,
    removeUploadingPreviews: removeUploadingImagePreviews,
    slots,
    uploadingPreviews,
  });

  return { canDropImage, handleUploadFiles, maxCount, maxFileSize, uploadingPreviews };
};
