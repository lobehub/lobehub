import { memo } from 'react';

import { useAutoDimensions } from '@/app/[variants]/(main)/image/_layout/ConfigPanel/hooks/useAutoDimensions';
import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';

import ImageUpload from './ImageUpload';

const ImageUrl = memo(() => {
  const { value: imageUrl, setValue, maxFileSize } = useGenerationConfigParam('imageUrl');
  const { autoSetDimensions, extractUrlAndDimensions } = useAutoDimensions();

  const handleChange = (
    data?:
      | string // Old API: just URL
      | { dimensions?: { height: number; width: number }; url: string }, // New API: URL with dimensions
  ) => {
    const { url, dimensions } = extractUrlAndDimensions(data);

    setValue(url ?? null);

    // Auto-set dimensions if available
    if (dimensions) {
      autoSetDimensions(dimensions);
    }
  };

  return <ImageUpload maxFileSize={maxFileSize} value={imageUrl} onChange={handleChange} />;
});

export default ImageUrl;
