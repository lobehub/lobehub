'use client';

import { Block, Center, Flexbox, Skeleton } from '@lobehub/ui';
import { memo } from 'react';

import PromptInput from '@/app/[variants]/(main)/video/features/PromptInput';

const SkeletonList = memo(() => {
  return (
    <Flexbox style={{ minHeight: 'calc(100vh - 44px)' }}>
      <Block variant={'borderless'}>
        <Flexbox gap={12}>
          {/* Prompt text skeleton */}
          <Skeleton.Button active style={{ height: 20, width: '95%' }} />

          {/* Metadata skeleton (model tag, resolution, aspect ratio) */}
          <Flexbox horizontal gap={4} style={{ marginBottom: 10 }}>
            <Skeleton.Button active style={{ height: 22, width: 120 }} />
            <Skeleton.Button active style={{ height: 22, width: 80 }} />
            <Skeleton.Button active style={{ height: 22, width: 60 }} />
          </Flexbox>

          {/* Video player skeleton */}
          <Skeleton.Button active style={{ aspectRatio: '16/9', height: 'auto', width: '100%' }} />

          {/* Timestamp skeleton */}
          <Skeleton.Button active style={{ height: 14, width: 140 }} />
        </Flexbox>
      </Block>
      <div style={{ flex: 1 }} />
      <Center
        style={{
          bottom: 24,
          position: 'sticky',
          width: '100%',
        }}
      >
        <PromptInput disableAnimation={true} showTitle={false} />
      </Center>
    </Flexbox>
  );
});

SkeletonList.displayName = 'SkeletonList';

export default SkeletonList;
