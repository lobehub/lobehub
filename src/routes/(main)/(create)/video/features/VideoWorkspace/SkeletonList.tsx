'use client';

import { Block, Center, Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { memo } from 'react';

import PromptInput from '@/routes/(main)/(create)/video/features/PromptInput';

interface SkeletonListProps {
  embedInput?: boolean;
}

const SkeletonList = memo<SkeletonListProps>(({ embedInput = true }) => {
  return (
    <Flexbox style={{ minHeight: 'calc(100vh - 44px)' }}>
      <Block variant={'borderless'}>
        <Flexbox gap={12}>
          {/* Prompt text skeleton */}
          <Skeleton height={20} width={'95%'} />

          {/* Metadata skeleton (model tag, resolution, aspect ratio) */}
          <Flexbox horizontal gap={4} style={{ marginBottom: 10 }}>
            <Skeleton height={22} width={120} />
            <Skeleton height={22} width={80} />
            <Skeleton height={22} width={60} />
          </Flexbox>

          {/* Video player skeleton */}
          <Skeleton height={'auto'} style={{ aspectRatio: '16/9' }} />

          {/* Timestamp skeleton */}
          <Skeleton height={14} width={140} />
        </Flexbox>
      </Block>
      <div style={{ flex: 1 }} />
      {embedInput && (
        <Center
          style={{
            bottom: 24,
            position: 'sticky',
            width: '100%',
          }}
        >
          <PromptInput disableAnimation={true} showTitle={false} />
        </Center>
      )}
    </Flexbox>
  );
});

SkeletonList.displayName = 'SkeletonList';

export default SkeletonList;
