import { memo } from 'react';

import { ImageUpload } from '@/routes/(main)/(create)/image/features/ConfigPanel';
import { useVideoGenerationConfigParam } from '@/store/video/slices/generationConfig/hooks';

interface VideoFramesUploadProps {
  paramName: 'imageUrl' | 'imageUrls';
}

const VideoFramesUpload = memo<VideoFramesUploadProps>(({ paramName }) => {
  const { value, setValue, maxFileSize, imageConstraints, maxCount } =
    useVideoGenerationConfigParam(paramName);

  if (paramName === 'imageUrl') {
    const handleChange = (
      data?: string | { dimensions?: { height: number; width: number }; url: string },
    ) => {
      const url = typeof data === 'string' ? data : data?.url;
      setValue((url ?? null) as any);
    };

    return (
      <ImageUpload
        imageConstraints={imageConstraints}
        maxFileSize={maxFileSize}
        placeholderHeight={120}
        value={value as string | null | undefined}
        onChange={handleChange}
      />
    );
  }

  // For imageUrls
  const handleChange = (
    data?: string | { dimensions?: { height: number; width: number }; url: string },
  ) => {
    const url = typeof data === 'string' ? data : data?.url;

    if (!url) {
      setValue([] as any);
      return;
    }

    // When maxCount is 1, replace instead of append
    if (maxCount === 1) {
      setValue([url] as any);
    } else {
      // Append to existing array
      const currentArr = Array.isArray(value) ? value : [];
      setValue([...currentArr, url] as any);
    }
  };

  // For imageUrls with maxCount 1, use single image upload
  if (maxCount === 1) {
    const currentValue = Array.isArray(value) ? value[0] : null;
    return (
      <ImageUpload
        imageConstraints={imageConstraints}
        maxFileSize={maxFileSize}
        placeholderHeight={120}
        value={currentValue}
        onChange={handleChange}
      />
    );
  }

  // For imageUrls with maxCount > 1, also use ImageUpload for now
  // (could be upgraded to MultiImagesUpload in future)
  const firstImage = Array.isArray(value) ? value[0] : null;
  return (
    <ImageUpload
      imageConstraints={imageConstraints}
      maxFileSize={maxFileSize}
      placeholderHeight={120}
      value={firstImage}
      onChange={handleChange}
    />
  );
});

export default VideoFramesUpload;
