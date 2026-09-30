'use client';

import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import {
  type ReferenceUploadSlot,
  useReferenceImageUpload,
} from '@/routes/(main)/(create)/features/GenerationInput/useReferenceImageUpload';
import { useVideoStore } from '@/store/video';
import { videoGenerationConfigSelectors } from '@/store/video/selectors';
import { useVideoGenerationConfigParam } from '@/store/video/slices/generationConfig/hooks';

const isSlotEnabledSelector = videoGenerationConfigSelectors.isImageInputSlotEnabled;

/**
 * Video-page binding for the shared {@link useReferenceImageUpload} core.
 *
 * Describes the video model's reference slots by priority — start frame
 * (`imageUrl`) → reference array (`imageUrls`) → end frame (`endImageUrl`) — so a
 * drop fills them in order. Single-image models accept one; first/end-frame
 * models map a 2-image drop to start + end (the end frame's `requiresImageUrl`
 * is satisfied because the start frame slot fills first). Models accepting both
 * frames and references only expose the active image input mode's slots.
 */
export const useVideoReferenceUpload = () => {
  const { t } = useTranslation('video');
  const { allowed: canCreate } = usePermission('create_content');

  const isSupportImageUrl = useVideoStore(isSlotEnabledSelector('imageUrl'));
  const isSupportImageUrls = useVideoStore(isSlotEnabledSelector('imageUrls'));
  const isSupportEndImageUrl = useVideoStore(isSlotEnabledSelector('endImageUrl'));

  const { value: imageUrl, maxFileSize: imageUrlMaxFileSize } =
    useVideoGenerationConfigParam('imageUrl');
  const {
    value: imageUrls,
    maxCount: imageUrlsMaxCount,
    maxFileSize: imageUrlsMaxFileSize,
  } = useVideoGenerationConfigParam('imageUrls');
  const { value: endImageUrl, maxFileSize: endImageUrlMaxFileSize } =
    useVideoGenerationConfigParam('endImageUrl');
  const imageInputMode = useVideoStore(videoGenerationConfigSelectors.imageInputMode);
  const setImageInputForMode = useVideoStore((s) => s.setImageInputForMode);

  const uploadingPreviews = useVideoStore(videoGenerationConfigSelectors.uploadingImagePreviews);
  const addUploadingImagePreviews = useVideoStore((s) => s.addUploadingImagePreviews);
  const removeUploadingImagePreviews = useVideoStore((s) => s.removeUploadingImagePreviews);

  // Slots are bound to the mode active when the upload starts, so an upload that lands after a
  // mode switch fills the mode it was dropped into rather than the one now shown.
  const slots = useMemo<ReferenceUploadSlot[]>(() => {
    const readParams = () =>
      videoGenerationConfigSelectors.imageInputsOfMode(imageInputMode)(useVideoStore.getState());
    const list: ReferenceUploadSlot[] = [];
    if (isSupportImageUrl) {
      list.push({
        capacity: 1,
        getCurrentValues: () => {
          const v = readParams()?.imageUrl;
          return v ? [v] : [];
        },
        set: (urls) => setImageInputForMode(imageInputMode, 'imageUrl', urls[0] ?? null),
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
        set: (urls) => setImageInputForMode(imageInputMode, 'imageUrls', urls),
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
        set: (urls) => setImageInputForMode(imageInputMode, 'endImageUrl', urls[0] ?? null),
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
    imageInputMode,
    setImageInputForMode,
  ]);

  const onLimitExceeded = useCallback(
    (maxCount: number) => {
      toast.warning(t('config.imageUpload.maxCountReached', { count: maxCount }));
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
