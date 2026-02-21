'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { memo } from 'react';

const VideoConfigSkeleton = memo(() => {
  return (
    <Flexbox gap={16} padding={10}>
      {/* ModelSelect */}
      <Skeleton.Button active size="large" style={{ width: '100%' }} />

      {/* FrameUpload: imageUrl */}
      <Flexbox gap={8}>
        <Skeleton.Button active size="small" style={{ width: 60 }} />
        <Skeleton.Block active style={{ borderRadius: 8, height: 120, width: '100%' }} />
      </Flexbox>

      {/* FrameUpload: endImageUrl */}
      <Flexbox gap={8}>
        <Skeleton.Button active size="small" style={{ width: 50 }} />
        <Skeleton.Block active style={{ borderRadius: 8, height: 120, width: '100%' }} />
      </Flexbox>

      {/* AspectRatio */}
      <Flexbox gap={8}>
        <Skeleton.Button active size="small" style={{ width: 70 }} />
        <Skeleton.Block active style={{ borderRadius: 8, height: 64, width: '100%' }} />
      </Flexbox>

      {/* Resolution */}
      <Flexbox gap={8}>
        <Skeleton.Button active size="small" style={{ width: 50 }} />
        <Skeleton.Button active size="default" style={{ width: '100%' }} />
      </Flexbox>

      {/* Duration */}
      <Flexbox gap={8}>
        <Skeleton.Button active size="small" style={{ width: 40 }} />
        <Skeleton.Button active size="default" style={{ width: '100%' }} />
      </Flexbox>

      {/* Seed */}
      <Flexbox gap={8}>
        <Skeleton.Button active size="small" style={{ width: 40 }} />
        <Skeleton.Button active size="default" style={{ width: '100%' }} />
      </Flexbox>

      {/* generateAudio switch */}
      <Flexbox align="center" horizontal justify="space-between">
        <Skeleton.Button active size="small" style={{ width: 70 }} />
        <Skeleton.Button active size="small" style={{ borderRadius: 12, width: 44 }} />
      </Flexbox>

      {/* cameraFixed switch */}
      <Flexbox align="center" horizontal justify="space-between">
        <Skeleton.Button active size="small" style={{ width: 70 }} />
        <Skeleton.Button active size="small" style={{ borderRadius: 12, width: 44 }} />
      </Flexbox>
    </Flexbox>
  );
});

VideoConfigSkeleton.displayName = 'VideoConfigSkeleton';

export default VideoConfigSkeleton;
