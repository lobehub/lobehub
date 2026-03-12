'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { memo } from 'react';

/**
 * Skeleton loading state for image configuration panel
 * Provides visual feedback during initialization
 */
const ImageConfigSkeleton = memo(() => {
  return (
    <Flexbox gap={32} padding="12px 12px 0 12px" style={{ height: '100%' }}>
      {/* Model Selection */}
      <Flexbox gap={8}>
        <Skeleton.Button active size="small" style={{ width: 100 }} />
        <Skeleton.Button active size="large" style={{ width: '100%' }} />
      </Flexbox>

      {/* Image Upload Area */}
      <Flexbox gap={8}>
        <Skeleton.Button active size="small" style={{ width: 60 }} />
        <Skeleton.Block
          active
          style={{
            borderRadius: 8,
            height: 100,
            width: '100%',
          }}
        />
      </Flexbox>

      {/* Parameter Controls */}
      {Array.from({ length: 2 }, (_, index) => (
        <Flexbox gap={8} key={index}>
          <Skeleton.Button active size="small" style={{ width: 80 }} />
          <Skeleton.Button active size="default" style={{ width: '100%' }} />
        </Flexbox>
      ))}

      {/* Image Number Control (Sticky at bottom) */}
      <Flexbox padding="12px 0" style={{ marginTop: 'auto' }}>
        <Flexbox gap={8}>
          <Skeleton.Button active size="small" style={{ width: 60 }} />
          <Skeleton.Button active size="default" style={{ width: '100%' }} />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

ImageConfigSkeleton.displayName = 'ImageConfigSkeleton';

export default ImageConfigSkeleton;
