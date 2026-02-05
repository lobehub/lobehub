import { memo } from 'react';

import { useAutoDimensions } from '@/app/[variants]/(main)/image/_layout/ConfigPanel/hooks/useAutoDimensions';
import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';

import ImageUpload from './ImageUpload';
import MultiImagesUpload from './MultiImagesUpload';

const ImageUrlsUpload = memo(() => {
  const { value, setValue, maxCount, maxFileSize } = useGenerationConfigParam('imageUrls');
  const { autoSetDimensions, extractUrlAndDimensions } = useAutoDimensions();

  // When maxCount is 1, use ImageUpload for single image upload
  if (maxCount === 1) {
    const handleSingleChange = (
      data?:
        | string // Old API: just URL
        | { dimensions?: { height: number; width: number }; url: string }, // New API: URL with dimensions
    ) => {
      const { url, dimensions } = extractUrlAndDimensions(data);

      setValue(url ? [url] : []);

      // Auto-set dimensions if available
      if (dimensions) {
        autoSetDimensions(dimensions);
      }
    };

    return (
      <ImageUpload
        maxFileSize={maxFileSize}
        value={value?.[0] ?? null}
        onChange={handleSingleChange}
      />
    );
  }

  // Otherwise use MultiImagesUpload for multiple images
  const handleChange = (
    data:
      | string[] // Old API: just URLs
      | { dimensions?: { height: number; width: number }; urls: string[] }, // New API: URLs with first image dimensions
  ) => {
    const urls = Array.isArray(data) ? data : data.urls;
    const dimensions = Array.isArray(data) ? undefined : data.dimensions;

    // Directly set the URLs to the store
    // The store will handle URL to path conversion when needed
    setValue(urls);

    // Only auto-set dimensions if no existing images and only uploading one image
    if (!value?.length && urls.length === 1 && dimensions) {
      autoSetDimensions(dimensions);
    }
  };

  return (
    <MultiImagesUpload
      maxCount={maxCount}
      maxFileSize={maxFileSize}
      value={value}
      onChange={handleChange}
    />
  );
});

export default ImageUrlsUpload;
