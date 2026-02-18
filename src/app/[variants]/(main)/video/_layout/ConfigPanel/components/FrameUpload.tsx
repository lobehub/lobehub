import { memo } from 'react';

import ImageUpload from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/ImageUpload';
import { useVideoGenerationConfigParam } from '@/store/video/slices/generationConfig/hooks';

interface FrameUploadProps {
  paramName: 'endImageUrl' | 'imageUrl';
}

const FrameUpload = memo<FrameUploadProps>(({ paramName }) => {
  const { value, setValue, maxFileSize } = useVideoGenerationConfigParam(paramName);

  const handleChange = (
    data?: string | { dimensions?: { height: number; width: number }; url: string },
  ) => {
    const url = typeof data === 'string' ? data : data?.url;
    setValue((url ?? null) as any);
  };

  return (
    <ImageUpload
      maxFileSize={maxFileSize}
      onChange={handleChange}
      placeholderHeight={120}
      value={value}
    />
  );
});

export default FrameUpload;
