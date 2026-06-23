'use client';

import { useCallback, useMemo } from 'react';

import { useFileStore } from '@/store/file';

import type { UploadData } from './UploadCard';

/**
 * A single destination for dropped reference images (e.g. start frame, reference
 * array, end frame). Slots are filled in array order: dropped files top up the
 * first slot with remaining room, then overflow into the next.
 */
export interface ReferenceUploadSlot {
  /** Maximum number of image URLs this slot can hold. */
  capacity: number;
  /** Replace this slot's full content with the given URLs (already capped to capacity). */
  set: (urls: string[]) => void;
  /** URLs currently landed in this slot. */
  values: string[];
}

interface UseReferenceImageUploadOptions {
  /** Append object-URL placeholders for in-flight uploads (store-backed, shared). */
  addUploadingPreviews: (urls: string[]) => void;
  /** Whether the user is permitted to add references. */
  canCreate: boolean;
  /** Largest accepted file size in bytes; larger files are skipped. */
  maxFileSize?: number;
  /** Set image dimensions from the first uploaded image (image page only). */
  onFirstDimensions?: (dimensions: { height: number; width: number }) => void;
  /** Called with the effective max count when a drop exceeds the remaining room. */
  onLimitExceeded?: (maxCount: number) => void;
  /** Remove this batch's object-URL placeholders once the upload settles. */
  removeUploadingPreviews: (urls: string[]) => void;
  /** Ordered destination slots; dropped files fill them by priority. */
  slots: ReferenceUploadSlot[];
  /** Object-URL placeholders for in-flight uploads (store-backed, shared). */
  uploadingPreviews: string[];
}

const extractUrlAndDimensions = (data?: UploadData) => {
  const url = typeof data === 'string' ? data : data?.url;
  const dimensions = typeof data === 'object' ? data?.dimensions : undefined;
  return { dimensions, url };
};

/**
 * Store-agnostic core for drag/click reference-image upload, shared by the image
 * and video creation pages.
 *
 * Callers describe their model's accepted reference slots (`slots`) and the
 * store-backed in-flight preview state; this hook owns the tricky parts:
 * filtering, capacity/limit handling, instant object-URL placeholders, the batch
 * upload, single-shot landing across slots (avoiding the stale-closure race a
 * per-file loop would cause), and placeholder cleanup.
 *
 * The page-specific differences (which store, end-frame slot, auto-dimensions)
 * are injected via `slots` / `onFirstDimensions`, so the upload mechanics live
 * in exactly one place.
 */
export const useReferenceImageUpload = ({
  slots,
  canCreate,
  maxFileSize,
  uploadingPreviews,
  addUploadingPreviews,
  removeUploadingPreviews,
  onFirstDimensions,
  onLimitExceeded,
}: UseReferenceImageUploadOptions) => {
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);

  const maxCount = useMemo(() => slots.reduce((sum, slot) => sum + slot.capacity, 0), [slots]);

  const imagePreviewUrls = useMemo(
    () => slots.flatMap((slot) => slot.values).filter(Boolean),
    [slots],
  );

  /** Whether the current model accepts any reference image at all. */
  const canDropImage = maxCount > 0;

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      if (!canCreate) return;

      const imageFiles = files.filter((file) => file.type.startsWith('image/'));
      if (imageFiles.length === 0) return;

      // Account for both landed images and any in-flight uploads.
      const remaining = maxCount - imagePreviewUrls.length - uploadingPreviews.length;
      if (remaining <= 0) {
        onLimitExceeded?.(maxCount);
        return;
      }

      // Only take as many as there is still room for, and warn when truncating.
      const accepted = imageFiles.slice(0, remaining);
      if (imageFiles.length > remaining) {
        onLimitExceeded?.(maxCount);
      }

      // Show instant local previews (with spinner) for the whole batch.
      const previews = accepted.map((file) => URL.createObjectURL(file));
      addUploadingPreviews(previews);

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

        // Collect successful URLs and the first available dimensions.
        const uploadedUrls: string[] = [];
        let firstDimensions: { height: number; width: number } | undefined;
        for (const data of results) {
          if (!data) continue;
          const { url, dimensions } = extractUrlAndDimensions(data);
          if (!url) continue;
          if (!firstDimensions && dimensions) firstDimensions = dimensions;
          uploadedUrls.push(url);
        }

        if (firstDimensions) onFirstDimensions?.(firstDimensions);

        // Distribute uploaded URLs across slots by priority, appending to existing
        // content. Each slot is set once to avoid a stale-closure race.
        let pool = uploadedUrls;
        for (const slot of slots) {
          if (pool.length === 0) break;
          const room = slot.capacity - slot.values.length;
          if (room <= 0) continue;
          const take = pool.slice(0, room);
          pool = pool.slice(room);
          slot.set([...slot.values, ...take]);
        }
      } finally {
        // Drop this batch's placeholders, then release the object URLs.
        removeUploadingPreviews(previews);
        previews.forEach((url) => URL.revokeObjectURL(url));
      }
    },
    [
      slots,
      canCreate,
      maxCount,
      maxFileSize,
      imagePreviewUrls,
      uploadingPreviews,
      uploadWithProgress,
      addUploadingPreviews,
      removeUploadingPreviews,
      onFirstDimensions,
      onLimitExceeded,
    ],
  );

  return {
    canDropImage,
    handleUploadFiles,
    imagePreviewUrls,
    maxCount,
    maxFileSize,
    uploadingPreviews,
  };
};
