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
  /**
   * Read this slot's URLs fresh from the store. Used at landing time so a batch
   * that finishes after a concurrent one merges against the latest content
   * instead of overwriting it with a stale render-time snapshot.
   */
  getCurrentValues: () => string[];
  /** Replace this slot's full content with the given URLs (already capped to capacity). */
  set: (urls: string[]) => void;
  /** URLs currently landed in this slot (render-time snapshot for previews/capacity). */
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

  // Gate on permission too: without `create_content` the upload handler bails
  // immediately, so a true flag here would show an active drop zone that
  // silently accepts and discards the drop.
  const canDropImage = canCreate && maxCount > 0;

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      if (!canCreate) return;

      // Keep files whose type is an image OR empty: OS/browser drops of images
      // with uncommon extensions can arrive with an empty `File.type`. Discarding
      // them here would silently drop a valid reference before the upload pipeline
      // (which sniffs the MIME from bytes) gets a chance. Known non-image types
      // (PDF/video/text) still carry a populated `type` and are rejected.
      const imageFiles = files.filter((file) => file.type === '' || file.type.startsWith('image/'));
      if (imageFiles.length === 0) return;

      // Drop files over the model's size limit before consuming capacity, so an
      // oversized file doesn't steal a slot from a valid one later in the drop.
      const uploadableFiles = maxFileSize
        ? imageFiles.filter((file) => file.size <= maxFileSize)
        : imageFiles;
      if (uploadableFiles.length === 0) return;

      // Account for both landed images and any in-flight uploads.
      const remaining = maxCount - imagePreviewUrls.length - uploadingPreviews.length;
      if (remaining <= 0) {
        onLimitExceeded?.(maxCount);
        return;
      }

      // Only take as many as there is still room for, and warn when truncating.
      const accepted = uploadableFiles.slice(0, remaining);
      if (uploadableFiles.length > remaining) {
        onLimitExceeded?.(maxCount);
      }

      // Show instant local previews (with spinner) for the whole batch.
      const previews = accepted.map((file) => URL.createObjectURL(file));
      addUploadingPreviews(previews);

      try {
        // `allSettled` isolates per-file failures: a single rejected upload no
        // longer discards the whole batch, so the images that did land stay.
        const settled = await Promise.allSettled(
          accepted.map(async (file): Promise<UploadData | null> => {
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
        const results = settled.map((outcome) =>
          outcome.status === 'fulfilled' ? outcome.value : null,
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

        // Distribute uploaded URLs across slots by priority, appending to the
        // slot's *current* store content (read fresh, not the render-time
        // snapshot) so a concurrent batch that already landed isn't overwritten.
        // The loop is synchronous, so each batch's landing is atomic.
        let pool = uploadedUrls;
        for (const slot of slots) {
          if (pool.length === 0) break;
          const current = slot.getCurrentValues();
          const room = slot.capacity - current.length;
          if (room <= 0) continue;
          const take = pool.slice(0, room);
          pool = pool.slice(room);
          slot.set([...current, ...take]);
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
